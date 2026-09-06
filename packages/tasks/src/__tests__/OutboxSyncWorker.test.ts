/**
 * OutboxSyncWorker Tests
 *
 * Covers: successful dispatch of pending outbox entries, abort on signal,
 * markFailed on dispatch error, cursor persistence, and on-demand enqueueSync deduplication.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { generateCorrelationId } from "@platform/core";
import { TaskQueueService } from "../queue/TaskQueueService.js";
import {
  OutboxSyncWorker,
  OUTBOX_SYNC_TASK_TYPE,
  type OutboxBatchLoader,
  type OutboxEntry,
  type OutboxSyncPayload,
  type SyncDispatcher,
} from "../sync/OutboxSyncWorker.js";
import type { TaskExecutionContext } from "../types.js";

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

async function applySchema(db: MemoryDatabaseConnection): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS core_background_tasks (
      id                  TEXT PRIMARY KEY,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL,
      task_type           TEXT NOT NULL,
      unique_key          TEXT,
      organisation_id     TEXT NOT NULL,
      user_id             TEXT,
      payload_json        TEXT NOT NULL,
      state               TEXT NOT NULL DEFAULT 'PENDING'
                          CHECK (state IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
      attempt_count       INTEGER NOT NULL DEFAULT 0,
      max_attempts        INTEGER NOT NULL DEFAULT 3,
      retry_delay_ms      INTEGER NOT NULL DEFAULT 1000,
      backoff_multiplier  REAL NOT NULL DEFAULT 2.0,
      max_retry_delay_ms  INTEGER NOT NULL DEFAULT 60000,
      scheduled_at        TEXT NOT NULL,
      started_at          TEXT,
      completed_at        TEXT,
      failed_at           TEXT,
      last_error          TEXT,
      timeout_ms          INTEGER NOT NULL DEFAULT 30000,
      correlation_id      TEXT NOT NULL
    )
  `);
}

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: generateCorrelationId("entry"),
    envelopeId: generateCorrelationId("env"),
    organisationId: "org-123",
    syncGroupId: "grp-abc",
    payloadJson: JSON.stringify({ op: "INSERT" }),
    signerPublicKey: "pk",
    signature: "sig",
    ...overrides,
  };
}

function makeCtx(overrides: Partial<TaskExecutionContext> = {}): TaskExecutionContext {
  const controller = new AbortController();
  return {
    taskId: "task-001",
    attempt: 1,
    correlationId: "corr-001",
    organisationId: "org-123",
    userId: undefined,
    signal: controller.signal,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OutboxSyncWorker", () => {
  let db: MemoryDatabaseConnection;
  let taskQueue: TaskQueueService;

  beforeEach(async () => {
    db = new MemoryDatabaseConnection("test");
    await applySchema(db);
    taskQueue = new TaskQueueService(db);
  });

  // -------------------------------------------------------------------------
  // Successful dispatch
  // -------------------------------------------------------------------------

  it("calls dispatch for each pending outbox entry and marks them sent", async () => {
    const entries = [makeEntry(), makeEntry()];

    const markSentSpy = vi.fn().mockResolvedValue(undefined);
    const markFailedSpy = vi.fn().mockResolvedValue(undefined);
    const dispatchSpy = vi.fn().mockResolvedValue(undefined);

    const outbox: OutboxBatchLoader = {
      pendingBatch: vi.fn().mockResolvedValue(entries),
      markSent: markSentSpy,
      markFailed: markFailedSpy,
    };

    const dispatcher: SyncDispatcher = { dispatch: dispatchSpy };

    const worker = new OutboxSyncWorker({ outbox, dispatcher, taskQueue, db });
    const payload: OutboxSyncPayload = { organisationId: "org-123" };

    await worker.handle(payload, makeCtx());

    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    expect(markSentSpy).toHaveBeenCalledTimes(2);
    expect(markFailedSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Empty outbox
  // -------------------------------------------------------------------------

  it("exits cleanly when the outbox is empty", async () => {
    const dispatchSpy = vi.fn();

    const outbox: OutboxBatchLoader = {
      pendingBatch: vi.fn().mockResolvedValue([]),
      markSent: vi.fn(),
      markFailed: vi.fn(),
    };

    const worker = new OutboxSyncWorker({
      outbox,
      dispatcher: { dispatch: dispatchSpy },
      taskQueue,
      db,
    });

    await worker.handle({ organisationId: "org-123" }, makeCtx());
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Partial failure
  // -------------------------------------------------------------------------

  it("calls markFailed for envelopes that fail to dispatch", async () => {
    const goodEntry = makeEntry();
    const badEntry = makeEntry();

    const markSentSpy = vi.fn().mockResolvedValue(undefined);
    const markFailedSpy = vi.fn().mockResolvedValue(undefined);

    const outbox: OutboxBatchLoader = {
      pendingBatch: vi.fn().mockResolvedValue([goodEntry, badEntry]),
      markSent: markSentSpy,
      markFailed: markFailedSpy,
    };

    let callCount = 0;
    const dispatcher: SyncDispatcher = {
      dispatch: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 2) throw new Error("Network down");
      }),
    };

    const worker = new OutboxSyncWorker({ outbox, dispatcher, taskQueue, db });
    await worker.handle({ organisationId: "org-123" }, makeCtx());

    expect(markSentSpy).toHaveBeenCalledOnce();
    expect(markFailedSpy).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // All failed → throws
  // -------------------------------------------------------------------------

  it("throws when ALL envelopes fail to dispatch", async () => {
    const entries = [makeEntry()];

    const outbox: OutboxBatchLoader = {
      pendingBatch: vi.fn().mockResolvedValue(entries),
      markSent: vi.fn(),
      markFailed: vi.fn().mockResolvedValue(undefined),
    };

    const dispatcher: SyncDispatcher = {
      dispatch: vi.fn().mockRejectedValue(new Error("total failure")),
    };

    const worker = new OutboxSyncWorker({ outbox, dispatcher, taskQueue, db });

    await expect(
      worker.handle({ organisationId: "org-123" }, makeCtx()),
    ).rejects.toThrow("All");
  });

  // -------------------------------------------------------------------------
  // AbortSignal — stops dispatch loop early
  // -------------------------------------------------------------------------

  it("stops dispatching when the AbortSignal fires", async () => {
    const controller = new AbortController();
    const ctx = makeCtx({ signal: controller.signal });

    const entries = [makeEntry(), makeEntry(), makeEntry()];
    const dispatchSpy = vi.fn().mockImplementation(async () => {
      // Abort after the first dispatch
      controller.abort();
    });

    const outbox: OutboxBatchLoader = {
      pendingBatch: vi.fn().mockResolvedValue(entries),
      markSent: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    };

    const worker = new OutboxSyncWorker({
      outbox,
      dispatcher: { dispatch: dispatchSpy },
      taskQueue,
      db,
    });

    await worker.handle({ organisationId: "org-123" }, ctx);

    // Only the first dispatch ran before abort
    expect(dispatchSpy).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // enqueueSync deduplication
  // -------------------------------------------------------------------------

  it("enqueueSync creates a task with the correct uniqueKey and type", async () => {
    const outbox: OutboxBatchLoader = {
      pendingBatch: vi.fn().mockResolvedValue([]),
      markSent: vi.fn(),
      markFailed: vi.fn(),
    };
    const dispatcher: SyncDispatcher = { dispatch: vi.fn() };

    const worker = new OutboxSyncWorker({ outbox, dispatcher, taskQueue, db });

    await worker.enqueueSync("org-XYZ");

    const tasks = await taskQueue.listByState("org-XYZ", "PENDING");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.taskType).toBe(OUTBOX_SYNC_TASK_TYPE);
    expect(tasks[0]!.uniqueKey).toBe("sync:outbox:org-XYZ");
  });

  it("enqueueSync is idempotent for the same organisation", async () => {
    const outbox: OutboxBatchLoader = {
      pendingBatch: vi.fn().mockResolvedValue([]),
      markSent: vi.fn(),
      markFailed: vi.fn(),
    };
    const dispatcher: SyncDispatcher = { dispatch: vi.fn() };

    const worker = new OutboxSyncWorker({ outbox, dispatcher, taskQueue, db });

    await worker.enqueueSync("org-XYZ");
    await worker.enqueueSync("org-XYZ"); // second call should deduplicate

    const tasks = await taskQueue.listByState("org-XYZ", "PENDING");
    expect(tasks).toHaveLength(1);
  });
});
