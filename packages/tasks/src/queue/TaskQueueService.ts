/**
 * TaskQueueService
 *
 * Manages the lifecycle of durable background tasks persisted in
 * `core_background_tasks`. All mutations are expressed as SQL so that
 * callers can optionally participate in an outer transaction.
 *
 * Concurrency guarantees:
 *   • `claimNextBatch` issues an atomic UPDATE … RETURNING so that two workers
 *     racing on the same database never pick the same row.
 *   • `enqueue` respects the partial unique index on `unique_key` and returns
 *     the existing record when deduplication applies.
 */

import {
  generateCorrelationId,
  getUtcIsoTimestamp,
  DatabaseError,
  ValidationError,
} from "@platform/core";
import type { DatabaseConnection, TransactionClient } from "@platform/database";
import {
  DEFAULT_RETRY_POLICY,
  type TaskDefinition,
  type TaskRecord,
  type TaskRetryPolicy,
  type TaskState,
} from "../types.js";
import { TaskRetryCalculator } from "../retry/TaskRetryCalculator.js";

export const MAX_TASK_LIST_SIZE = 100;

// ---------------------------------------------------------------------------
// Internal DB row type (snake_case mirrors SQL schema)
// ---------------------------------------------------------------------------
interface TaskRow {
  id: string;
  created_at: string;
  updated_at: string;
  task_type: string;
  unique_key: string | null;
  organisation_id: string;
  user_id: string | null;
  payload_json: string;
  state: TaskState;
  attempt_count: number;
  max_attempts: number;
  retry_delay_ms: number;
  backoff_multiplier: number;
  max_retry_delay_ms: number;
  retry_jitter: number;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  last_error: string | null;
  timeout_ms: number;
  correlation_id: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToRecord<TPayload>(row: TaskRow): TaskRecord<TPayload> {
  let payload: TPayload;
  try {
    payload = JSON.parse(row.payload_json) as TPayload;
  } catch {
    throw new DatabaseError({
      message: `Task '${row.id}' contains malformed persisted payload JSON`,
      userMessage: "A background task contains invalid stored data.",
      correlationId: row.correlation_id,
    });
  }

  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    taskType: row.task_type,
    uniqueKey: row.unique_key,
    organisationId: row.organisation_id,
    userId: row.user_id,
    payload,
    state: row.state,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    retryDelayMs: row.retry_delay_ms,
    backoffMultiplier: row.backoff_multiplier,
    maxRetryDelayMs: row.max_retry_delay_ms,
    retryJitter: row.retry_jitter,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    lastError: row.last_error,
    timeoutMs: row.timeout_ms,
    correlationId: row.correlation_id,
  };
}

type Executor = Pick<DatabaseConnection, "query" | "execute"> | TransactionClient;

// ---------------------------------------------------------------------------
// TaskQueueService
// ---------------------------------------------------------------------------

export class TaskQueueService {
  private readonly db: DatabaseConnection;
  private readonly retryCalculator = new TaskRetryCalculator();

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  // -------------------------------------------------------------------------
  // enqueue
  // -------------------------------------------------------------------------

  /**
   * Persists a new task definition to `core_background_tasks`.
   *
   * If `definition.uniqueKey` is set and a PENDING or RUNNING task with the
   * same key already exists, that existing task record is returned unchanged
   * (idempotent / deduplication behaviour).
   *
   * @param definition - Task parameters.
   * @param tx         - Optional transaction client for atomic composition.
   */
  async enqueue<TPayload>(
    definition: TaskDefinition<TPayload>,
    tx?: TransactionClient,
  ): Promise<TaskRecord<TPayload>> {
    const executor: Executor = tx ?? this.db;
    const policy: TaskRetryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      ...definition.retryPolicy,
    };

    const invalid = (field: string, value: unknown): never => {
      throw new ValidationError({
        message: `Invalid task definition field ${field}: ${String(value)}`,
        userMessage: "The background task definition is invalid.",
        correlationId: definition.correlationId || "task_definition",
      });
    };

    if (typeof definition.taskType !== "string" || !definition.taskType.trim()) {
      invalid("taskType", definition.taskType);
    }
    if (typeof definition.organisationId !== "string" || !definition.organisationId.trim()) {
      invalid("organisationId", definition.organisationId);
    }
    if (typeof definition.correlationId !== "string" || !definition.correlationId.trim()) {
      invalid("correlationId", definition.correlationId);
    }
    if (
      !Number.isSafeInteger(policy.maxAttempts) ||
      policy.maxAttempts <= 0 ||
      !Number.isFinite(policy.initialDelayMs) ||
      policy.initialDelayMs < 0 ||
      !Number.isFinite(policy.backoffMultiplier) ||
      policy.backoffMultiplier <= 0 ||
      !Number.isFinite(policy.maxDelayMs) ||
      policy.maxDelayMs < 0 ||
      !Number.isFinite(policy.jitter) ||
      policy.jitter < 0 ||
      policy.jitter > 1
    ) {
      invalid("retryPolicy", policy);
    }

    const timeoutMs = definition.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) invalid("timeoutMs", timeoutMs);

    let payloadJson = "";
    try {
      const serialized = JSON.stringify(definition.payload);
      if (serialized === undefined) invalid("payload", definition.payload);
      payloadJson = serialized;
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      invalid("payload", error instanceof Error ? error.message : error);
    }

    // Deduplication: check for existing PENDING/RUNNING task with same unique_key
    if (definition.uniqueKey) {
      const existing = await executor.query<TaskRow>(
        `SELECT * FROM core_background_tasks
           WHERE unique_key = ? AND state IN ('PENDING', 'RUNNING')
           LIMIT 1`,
        [definition.uniqueKey],
      );
      if (existing.length > 0) {
        return rowToRecord<TPayload>(existing[0]!);
      }
    }

    const id = generateCorrelationId("task");
    const now = getUtcIsoTimestamp();
    const scheduledAt = definition.scheduledAt ?? now;

    try {
      await executor.execute(
        `INSERT INTO core_background_tasks (
        id, created_at, updated_at, task_type, unique_key,
        organisation_id, user_id, payload_json, state,
        attempt_count, max_attempts, retry_delay_ms, backoff_multiplier, max_retry_delay_ms,
        retry_jitter, scheduled_at, timeout_ms, correlation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          now,
          now,
          definition.taskType,
          definition.uniqueKey ?? null,
          definition.organisationId,
          definition.userId ?? null,
          payloadJson,
          policy.maxAttempts,
          policy.initialDelayMs,
          policy.backoffMultiplier,
          policy.maxDelayMs,
          policy.jitter,
          scheduledAt,
          timeoutMs,
          definition.correlationId,
        ],
      );
    } catch (insertError) {
      // The pre-insert lookup is only an optimization. The partial unique
      // index is the concurrency boundary, so resolve a competing insert by
      // reading its winner after the database rejects our duplicate.
      if (definition.uniqueKey) {
        const winner = await executor.query<TaskRow>(
          `SELECT * FROM core_background_tasks
             WHERE unique_key = ? AND state IN ('PENDING', 'RUNNING')
             LIMIT 1`,
          [definition.uniqueKey],
        );
        if (winner.length > 0) return rowToRecord<TPayload>(winner[0]!);
      }
      throw insertError;
    }

    const rows = await executor.query<TaskRow>(`SELECT * FROM core_background_tasks WHERE id = ?`, [
      id,
    ]);

    if (rows.length === 0) {
      throw new DatabaseError({
        message: `TaskQueueService.enqueue: failed to retrieve task after insert (id=${id})`,
        userMessage: "Failed to create background task.",
        correlationId: definition.correlationId,
      });
    }

    return rowToRecord<TPayload>(rows[0]!);
  }

  // -------------------------------------------------------------------------
  // claimNextBatch
  // -------------------------------------------------------------------------

  /**
   * Atomically claims up to `limit` PENDING tasks that are due (scheduled_at ≤ now).
   * Claimed tasks transition to RUNNING and have `started_at` set.
   *
   * @param limit      - Maximum number of tasks to claim.
   * @param taskTypes  - Optional allow-list of task_type values to restrict the query.
   * @param tx         - Optional transaction client.
   */
  async claimNextBatch(
    limit = 10,
    taskTypes?: readonly string[],
    tx?: TransactionClient,
  ): Promise<TaskRecord[]> {
    const executor: Executor = tx ?? this.db;
    const now = getUtcIsoTimestamp();

    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new ValidationError({
        message: `Task batch limit must be a positive safe integer; received ${limit}`,
        userMessage: "The task batch size is invalid.",
        correlationId: "task_claim_limit",
      });
    }

    const typeFilter =
      taskTypes && taskTypes.length > 0
        ? `AND task_type IN (${taskTypes.map(() => "?").join(",")})`
        : "";

    const params: unknown[] =
      taskTypes && taskTypes.length > 0 ? [now, ...taskTypes, limit] : [now, limit];

    const rows = await executor.query<TaskRow>(
      `UPDATE core_background_tasks
         SET state = 'RUNNING',
             started_at = ?,
             updated_at = ?,
             attempt_count = attempt_count + 1
       WHERE id IN (
         SELECT id FROM core_background_tasks
         WHERE state = 'PENDING' AND scheduled_at <= ? ${typeFilter}
         ORDER BY scheduled_at ASC
         LIMIT ?
       )
         AND state = 'PENDING'
       RETURNING *`,
      [now, now, ...params],
    );

    const tasks: TaskRecord[] = [];
    for (const row of rows.sort((left, right) =>
      left.scheduled_at.localeCompare(right.scheduled_at),
    )) {
      try {
        tasks.push(rowToRecord(row));
      } catch (error) {
        if (!(error instanceof DatabaseError)) throw error;

        // The claim already transitioned this row to RUNNING. Quarantine only
        // the corrupt task so it cannot poison the whole batch or await crash
        // recovery indefinitely; valid claimed rows remain available to work.
        const now = getUtcIsoTimestamp();
        await executor.execute(
          `UPDATE core_background_tasks
             SET state = 'FAILED', failed_at = ?, last_error = ?, updated_at = ?
           WHERE id = ? AND state = 'RUNNING'`,
          [now, "Task payload contains malformed JSON", now, row.id],
        );
      }
    }
    return tasks;
  }

  // -------------------------------------------------------------------------
  // markCompleted
  // -------------------------------------------------------------------------

  /**
   * Transitions a RUNNING task to COMPLETED.
   *
   * @param taskId - The task row id.
   * @param tx     - Optional transaction client.
   */
  async markCompleted(taskId: string, tx?: TransactionClient): Promise<void> {
    const executor: Executor = tx ?? this.db;
    const now = getUtcIsoTimestamp();
    await executor.execute(
      `UPDATE core_background_tasks
         SET state = 'COMPLETED', completed_at = ?, updated_at = ?
       WHERE id = ? AND state = 'RUNNING'`,
      [now, now, taskId],
    );
  }

  // -------------------------------------------------------------------------
  // markFailed
  // -------------------------------------------------------------------------

  /**
   * Records a failure for a RUNNING task.
   *
   * If the error is retryable and attempts remain, the task is rescheduled
   * back to PENDING with the next computed delay applied to `scheduled_at`.
   * Otherwise the task transitions to FAILED.
   *
   * @param taskId    - The task row id.
   * @param error     - The thrown error from the handler.
   * @param tx        - Optional transaction client.
   */
  async markFailed(
    taskId: string,
    error: unknown,
    tx?: TransactionClient,
  ): Promise<{ willRetry: boolean }> {
    const executor: Executor = tx ?? this.db;
    const now = getUtcIsoTimestamp();

    // Fetch current task state to determine retry eligibility
    const rows = await executor.query<TaskRow>(`SELECT * FROM core_background_tasks WHERE id = ?`, [
      taskId,
    ]);

    if (rows.length === 0 || rows[0]!.state !== "RUNNING") {
      return { willRetry: false };
    }

    const row = rows[0]!;
    const policy: TaskRetryPolicy = {
      maxAttempts: row.max_attempts,
      initialDelayMs: row.retry_delay_ms,
      backoffMultiplier: row.backoff_multiplier,
      maxDelayMs: row.max_retry_delay_ms,
      jitter: row.retry_jitter,
    };

    const decision = this.retryCalculator.decide(error, row.attempt_count, policy);
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (decision.retryable && decision.delayMs !== undefined) {
      // Reschedule: push scheduled_at forward by delayMs from now
      const nextScheduledAt = new Date(Date.now() + decision.delayMs).toISOString();

      const updated = await executor.query<{ id: string }>(
        `UPDATE core_background_tasks
           SET state = 'PENDING',
               scheduled_at = ?,
               last_error = ?,
               failed_at = NULL,
               updated_at = ?
         WHERE id = ? AND state = 'RUNNING' AND attempt_count = ?
         RETURNING id`,
        [nextScheduledAt, errorMessage, now, taskId, row.attempt_count],
      );
      return { willRetry: updated.length > 0 };
    } else {
      await executor.query<{ id: string }>(
        `UPDATE core_background_tasks
           SET state = 'FAILED',
               failed_at = ?,
               last_error = ?,
               updated_at = ?
         WHERE id = ? AND state = 'RUNNING' AND attempt_count = ?
         RETURNING id`,
        [now, errorMessage, now, taskId, row.attempt_count],
      );
      return { willRetry: false };
    }
  }

  // -------------------------------------------------------------------------
  // cancel
  // -------------------------------------------------------------------------

  /**
   * Cancels a PENDING or RUNNING task, recording the reason in `last_error`.
   *
   * @param taskId - The task row id.
   * @param reason - Human-readable cancellation reason.
   * @param tx     - Optional transaction client.
   */
  async cancel(taskId: string, reason: string, tx?: TransactionClient): Promise<void> {
    const executor: Executor = tx ?? this.db;
    const now = getUtcIsoTimestamp();
    await executor.execute(
      `UPDATE core_background_tasks
         SET state = 'CANCELLED', last_error = ?, updated_at = ?
       WHERE id = ? AND state IN ('PENDING', 'RUNNING')`,
      [reason, now, taskId],
    );
  }

  // -------------------------------------------------------------------------
  // recoverHangingTasks
  // -------------------------------------------------------------------------

  /**
   * Resets tasks that have been RUNNING longer than `timeoutMs` without
   * completing. This handles the crash-recovery scenario where the process
   * died mid-execution and the row was never updated.
   *
   * Recovered tasks are rescheduled to PENDING with immediate `scheduled_at`
   * so that the next poll cycle picks them up.
   *
   * @param timeoutMs - Wall-clock threshold (default: 60 000 ms / 1 minute).
   */
  async recoverHangingTasks(timeoutMs = 60_000): Promise<number> {
    const now = Date.now();
    const cutoff = new Date(now - timeoutMs).toISOString();
    const nowIso = new Date(now).toISOString();

    const result = await this.db.execute(
      `UPDATE core_background_tasks
         SET state = 'PENDING',
             started_at = NULL,
             last_error = 'Recovered after process crash or timeout',
             updated_at = ?,
             scheduled_at = ?
       WHERE state = 'RUNNING' AND started_at <= ?`,
      [nowIso, nowIso, cutoff],
    );

    return result.rowsAffected;
  }

  // -------------------------------------------------------------------------
  // Diagnostic queries
  // -------------------------------------------------------------------------

  /**
   * Returns all tasks for an organisation in a given state.
   */
  async listByState(
    organisationId: string,
    state: TaskState,
    limit = MAX_TASK_LIST_SIZE,
  ): Promise<TaskRecord[]> {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_TASK_LIST_SIZE) {
      throw new ValidationError({
        message: `Task list limit must be a positive safe integer no greater than ${MAX_TASK_LIST_SIZE}`,
        userMessage: "The task list size is invalid.",
        correlationId: "task_list_limit",
      });
    }

    const rows = await this.db.query<TaskRow>(
      `SELECT * FROM core_background_tasks
         WHERE organisation_id = ? AND state = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      [organisationId, state, limit],
    );
    return rows.map((r) => rowToRecord(r));
  }

  /**
   * Finds a single task by id.
   */
  async findById<TPayload = unknown>(taskId: string): Promise<TaskRecord<TPayload> | null> {
    const rows = await this.db.query<TaskRow>(`SELECT * FROM core_background_tasks WHERE id = ?`, [
      taskId,
    ]);
    return rows.length > 0 ? rowToRecord<TPayload>(rows[0]!) : null;
  }
}
