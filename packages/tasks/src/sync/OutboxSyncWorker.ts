/**
 * OutboxSyncWorker
 *
 * A durable background task handler that drains the sync outbox by dispatching
 * pending `SyncEnvelope` rows over the provided `SyncTransport`.
 *
 * Architecture note:
 *   This worker is registered with a `TaskWorker` instance, wiring the
 *   background task subsystem to the replication pipeline. It is deliberately
 *   not coupled to `@platform/sync` at import time; instead the caller
 *   supplies narrow service interfaces via dependency injection (constructor
 *   parameters) to avoid a circular package dependency.
 *
 * Sync worker steps (from docs/architecture/BACKGROUND_TASKS.md):
 *   1. Load a bounded outbox batch.
 *   2. Verify device/session/revocation state (delegated to transport / auth layer).
 *   3. Establish / reuse native transport.
 *   4. Perform authenticated handshake (handled by transport).
 *   5. Exchange only authorised namespaces.
 *   6. Mark outbound operations acknowledged.
 *   7. Persist diagnostics (last_sync_at cursor).
 *   8. Schedule / retry according to policy (handled by TaskWorker/TaskQueueService).
 */

import type { Logger } from "@platform/core";
import { ConsoleLogger, getUtcIsoTimestamp, generateCorrelationId } from "@platform/core";
import type { DatabaseConnection } from "@platform/database";
import type { TaskExecutionContext } from "../types.js";
import type { TaskQueueService } from "../queue/TaskQueueService.js";
import { DEFAULT_RETRY_POLICY } from "../types.js";

// ---------------------------------------------------------------------------
// Narrow outbox record shape (decoupled from @platform/sync to avoid circular deps)
// ---------------------------------------------------------------------------

export interface OutboxEntry {
  readonly id: string;
  readonly envelopeId: string;
  readonly organisationId: string;
  readonly syncGroupId: string;
  readonly payloadJson: string;
  readonly signerPublicKey: string;
  readonly signature: string;
}

// ---------------------------------------------------------------------------
// Narrow transport interface expected by the sync worker
// ---------------------------------------------------------------------------

export interface SyncDispatcher {
  /**
   * Sends a serialised sync envelope payload to all peers in the given sync group.
   * The dispatcher is responsible for establishing/reusing the transport session.
   *
   * @returns A list of envelope ids that were successfully dispatched.
   */
  dispatch(
    organisationId: string,
    syncGroupId: string,
    payloadJson: string,
    signal: AbortSignal,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Outbox batch loader interface (narrow slice of OutboxService)
// ---------------------------------------------------------------------------

export interface OutboxBatchLoader {
  pendingBatch(limit?: number): Promise<OutboxEntry[]>;
  markSent(envelopeId: string): Promise<void>;
  markFailed(envelopeId: string, maxAttempts?: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Sync task payload
// ---------------------------------------------------------------------------

export interface OutboxSyncPayload {
  readonly organisationId: string;
  readonly batchLimit?: number;
}

export const OUTBOX_SYNC_TASK_TYPE = "platform.sync.outbox" as const;

// ---------------------------------------------------------------------------
// OutboxSyncWorker
// ---------------------------------------------------------------------------

export class OutboxSyncWorker {
  static readonly TASK_TYPE = OUTBOX_SYNC_TASK_TYPE;

  private readonly outbox: OutboxBatchLoader;
  private readonly dispatcher: SyncDispatcher;
  private readonly taskQueue: TaskQueueService;
  private readonly db: DatabaseConnection;
  private readonly logger: Logger;

  constructor(options: {
    outbox: OutboxBatchLoader;
    dispatcher: SyncDispatcher;
    taskQueue: TaskQueueService;
    db: DatabaseConnection;
    logger?: Logger;
  }) {
    this.outbox = options.outbox;
    this.dispatcher = options.dispatcher;
    this.taskQueue = options.taskQueue;
    this.db = options.db;
    this.logger = options.logger ?? new ConsoleLogger("info");
  }

  // -------------------------------------------------------------------------
  // Handler — registered with TaskWorker
  // -------------------------------------------------------------------------

  /**
   * Executes one sync batch cycle.
   * Should be registered via `taskWorker.register(OutboxSyncWorker.TASK_TYPE, worker.handle)`.
   */
  handle = async (
    payload: OutboxSyncPayload,
    ctx: TaskExecutionContext,
  ): Promise<void> => {
    const { organisationId, batchLimit = 50 } = payload;

    this.logger.info(
      `[OutboxSyncWorker] Starting outbox sync (org=${organisationId}, attempt=${ctx.attempt}, correlation=${ctx.correlationId}).`,
    );

    // Step 1: Load pending batch
    const batch = await this.outbox.pendingBatch(batchLimit);
    if (batch.length === 0) {
      this.logger.info("[OutboxSyncWorker] Outbox empty — nothing to sync.");
      await this.persistCursor(organisationId);
      return;
    }

    this.logger.info(
      `[OutboxSyncWorker] Dispatching ${batch.length} envelope(s).`,
    );

    // Steps 3–6: Dispatch each envelope, honour abort signal
    let dispatched = 0;
    let failed = 0;

    for (const entry of batch) {
      if (ctx.signal.aborted) {
        this.logger.warn(
          "[OutboxSyncWorker] AbortSignal fired — stopping dispatch loop early.",
        );
        break;
      }

      try {
        await this.dispatcher.dispatch(
          entry.organisationId,
          entry.syncGroupId,
          entry.payloadJson,
          ctx.signal,
        );
        await this.outbox.markSent(entry.envelopeId);
        dispatched++;
      } catch (err) {
        this.logger.error(
          `[OutboxSyncWorker] Failed to dispatch envelope ${entry.envelopeId}:`,
          err,
        );
        await this.outbox.markFailed(entry.envelopeId);
        failed++;
      }
    }

    // Step 7: Persist diagnostics cursor
    await this.persistCursor(organisationId);

    this.logger.info(
      `[OutboxSyncWorker] Sync complete: dispatched=${dispatched}, failed=${failed}.`,
    );

    // If all envelopes failed to dispatch, propagate as an error so the
    // TaskWorker/TaskQueueService retry logic is engaged.
    if (failed > 0 && dispatched === 0) {
      throw new Error(
        `[OutboxSyncWorker] All ${failed} envelopes failed to dispatch.`,
      );
    }
  };

  // -------------------------------------------------------------------------
  // On-demand enqueue helper
  // -------------------------------------------------------------------------

  /**
   * Enqueues a sync task for the given organisation.
   *
   * Uses a unique key per organisation so that concurrent requests do not
   * create duplicate running sync tasks.
   *
   * @param organisationId - Organisation to sync.
   * @param batchLimit     - Max envelopes to process per cycle.
   */
  async enqueueSync(
    organisationId: string,
    batchLimit = 50,
  ): Promise<void> {
    await this.taskQueue.enqueue<OutboxSyncPayload>({
      taskType: OUTBOX_SYNC_TASK_TYPE,
      uniqueKey: `sync:outbox:${organisationId}`,
      organisationId,
      payload: { organisationId, batchLimit },
      correlationId: generateCorrelationId("sync-worker"),
      retryPolicy: DEFAULT_RETRY_POLICY,
    });
  }

  // -------------------------------------------------------------------------
  // Cursor persistence
  // -------------------------------------------------------------------------

  private async persistCursor(organisationId: string): Promise<void> {
    const now = getUtcIsoTimestamp();
    try {
      // Upsert a sync cursor row (best-effort — does not fail the task if missing)
      await this.db.execute(
        `INSERT INTO core_sync_cursors (organisation_id, last_sync_at)
           VALUES (?, ?)
           ON CONFLICT(organisation_id) DO UPDATE SET last_sync_at = excluded.last_sync_at`,
        [organisationId, now],
      );
    } catch {
      // core_sync_cursors may not exist in all deployment contexts; log and continue
      this.logger.warn(
        "[OutboxSyncWorker] Could not persist sync cursor (table may not exist).",
      );
    }
  }
}
