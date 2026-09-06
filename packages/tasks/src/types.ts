/**
 * @platform/tasks — Core type definitions for the durable background task subsystem.
 *
 * All task interactions are expressed through these types. The schema mirrors
 * `core_background_tasks` but uses camelCase and typed enums rather than raw SQL strings.
 */

// ---------------------------------------------------------------------------
// Task State
// ---------------------------------------------------------------------------

export type TaskState =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

// ---------------------------------------------------------------------------
// Retry Policy
// ---------------------------------------------------------------------------

export interface TaskRetryPolicy {
  /** Maximum number of execution attempts (including the first). */
  readonly maxAttempts: number;
  /** Delay before the first retry, in milliseconds. */
  readonly initialDelayMs: number;
  /** Exponential growth factor applied on each retry. */
  readonly backoffMultiplier: number;
  /** Upper bound on any computed delay, in milliseconds. */
  readonly maxDelayMs: number;
  /**
   * Randomisation fraction applied to each computed delay.
   * A value of 0.25 means ±25% jitter.
   */
  readonly jitter: number;
}

export const DEFAULT_RETRY_POLICY: TaskRetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 1_000,
  backoffMultiplier: 2.0,
  maxDelayMs: 60_000,
  jitter: 0.25,
};

// ---------------------------------------------------------------------------
// Task Definition — used when enqueueing
// ---------------------------------------------------------------------------

export interface TaskDefinition<TPayload = unknown> {
  /** Discriminator used to route the task to a registered handler. */
  readonly taskType: string;
  /**
   * Optional deduplication key. If another PENDING or RUNNING task with the
   * same `uniqueKey` already exists, `enqueue` will return that task rather
   * than creating a duplicate.
   */
  readonly uniqueKey?: string;
  /** Opaque payload serialised to JSON in the database row. */
  readonly payload: TPayload;
  /** ISO-8601 UTC timestamp at which the task becomes eligible for execution. Defaults to now. */
  readonly scheduledAt?: string;
  /** Retry policy for this task. Merged over `DEFAULT_RETRY_POLICY`. */
  readonly retryPolicy?: Partial<TaskRetryPolicy>;
  /** Maximum wall-clock execution time before a timeout `AbortSignal` fires. */
  readonly timeoutMs?: number;
  /** Identifier for the owning organisation. */
  readonly organisationId: string;
  /** Identifier of the user who initiated the task (optional for system tasks). */
  readonly userId?: string;
  /** Tracing / correlation identifier. */
  readonly correlationId: string;
}

// ---------------------------------------------------------------------------
// Task Record — as persisted in the database
// ---------------------------------------------------------------------------

export interface TaskRecord<TPayload = unknown> {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly taskType: string;
  readonly uniqueKey: string | null;
  readonly organisationId: string;
  readonly userId: string | null;
  readonly payload: TPayload;
  readonly state: TaskState;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly backoffMultiplier: number;
  readonly maxRetryDelayMs: number;
  readonly scheduledAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly failedAt: string | null;
  readonly lastError: string | null;
  readonly timeoutMs: number;
  readonly correlationId: string;
}

// ---------------------------------------------------------------------------
// Task Execution Context — passed to each handler invocation
// ---------------------------------------------------------------------------

export interface TaskExecutionContext {
  /** Unique task row id. */
  readonly taskId: string;
  /** 1-based attempt counter. */
  readonly attempt: number;
  /** Correlation id carried through from the enqueue call. */
  readonly correlationId: string;
  /** Owning organisation. */
  readonly organisationId: string;
  /** Optional user who triggered the task. */
  readonly userId: string | undefined;
  /**
   * AbortSignal bound to the task's `timeoutMs`. Handlers SHOULD honour
   * this signal and terminate cleanly when it fires.
   */
  readonly signal: AbortSignal;
}

// ---------------------------------------------------------------------------
// Task Handler
// ---------------------------------------------------------------------------

/**
 * An async function that executes a specific task type.
 * Must be idempotent and honour `ctx.signal` for cancellation/timeout.
 */
export type TaskHandler<TPayload = unknown, TResult = void> = (
  payload: TPayload,
  ctx: TaskExecutionContext,
) => Promise<TResult>;

// ---------------------------------------------------------------------------
// Task Worker Options
// ---------------------------------------------------------------------------

export interface TaskWorkerOptions {
  /**
   * Maximum number of tasks executing concurrently in a single worker.
   * @default 3
   */
  readonly concurrency?: number;
  /**
   * How often the worker polls the database for new tasks (ms).
   * @default 5_000
   */
  readonly pollIntervalMs?: number;
  /**
   * How long to wait for in-flight tasks to finish when `stop()` is called,
   * before forcibly abandoning them (ms).
   * @default 30_000
   */
  readonly gracefulShutdownTimeoutMs?: number;
  /**
   * Called when a task handler throws a non-retryable error.
   * Useful for alerting / observability.
   */
  readonly onNonRetryableError?: (
    taskId: string,
    taskType: string,
    error: unknown,
  ) => void;
  /**
   * Called after each poll cycle even if no tasks were found. Useful for
   * heartbeat monitoring.
   */
  readonly onPollComplete?: (claimed: number) => void;
}
