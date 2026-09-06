/**
 * TaskWorker
 *
 * Background execution supervisor for durable tasks.
 *
 * Responsibilities:
 *   • Polls `TaskQueueService.claimNextBatch` on a configurable interval.
 *   • Dispatches claimed tasks to registered handlers concurrently (up to `concurrency`).
 *   • Arms an `AbortController` per task, triggering it on `timeoutMs` expiry.
 *   • Handles completion, retryable failure, and non-retryable failure paths.
 *   • Supports graceful shutdown via `stop()` — waits for in-flight handlers
 *     before resolving, up to `gracefulShutdownTimeoutMs`.
 *
 * The worker does NOT assume the Tauri webview is alive; it is safe to
 * instantiate and drive from the Tauri backend event loop or a Rust sidecar.
 */

import type { Logger } from "@platform/core";
import { ConsoleLogger } from "@platform/core";
import type { DatabaseConnection } from "@platform/database";
import type {
  TaskExecutionContext,
  TaskHandler,
  TaskRecord,
  TaskWorkerOptions,
} from "../types.js";
import { TaskQueueService } from "../queue/TaskQueueService.js";

export class TaskWorker {
  private readonly queue: TaskQueueService;
  private readonly logger: Logger;
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly gracefulShutdownTimeoutMs: number;
  private readonly onNonRetryableError: (taskId: string, taskType: string, error: unknown) => void;
  private readonly onPollComplete: (claimed: number) => void;

  private readonly handlers = new Map<string, TaskHandler<unknown, unknown>>();

  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  /** Active execution promises keyed by task id */
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    db: DatabaseConnection,
    options: TaskWorkerOptions = {},
    logger?: Logger,
  ) {
    this.queue = new TaskQueueService(db);
    this.logger = logger ?? new ConsoleLogger("info");
    this.concurrency = options.concurrency ?? 3;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.gracefulShutdownTimeoutMs = options.gracefulShutdownTimeoutMs ?? 30_000;
    this.onNonRetryableError = options.onNonRetryableError ?? (() => {});
    this.onPollComplete = options.onPollComplete ?? (() => {});
  }

  // -------------------------------------------------------------------------
  // Handler registration
  // -------------------------------------------------------------------------

  /**
   * Registers an async handler for a task type.
   * Replaces any previously registered handler for the same type.
   */
  register<TPayload, TResult>(
    taskType: string,
    handler: TaskHandler<TPayload, TResult>,
  ): void {
    this.handlers.set(taskType, handler as TaskHandler<unknown, unknown>);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Starts the poll loop. Idempotent — calling `start()` multiple times is safe.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.logger.info("[TaskWorker] Starting poll loop.");
    this.schedulePoll(0);
  }

  /**
   * Signals the worker to stop accepting new work and waits for in-flight
   * tasks to finish (up to `gracefulShutdownTimeoutMs`).
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    this.logger.info(
      `[TaskWorker] Stopping — waiting for ${this.inFlight.size} in-flight task(s).`,
    );

    if (this.inFlight.size > 0) {
      const allSettled = Promise.allSettled([...this.inFlight.values()]);
      const timeout = new Promise<void>((resolve) =>
        setTimeout(resolve, this.gracefulShutdownTimeoutMs),
      );
      await Promise.race([allSettled, timeout]);
    }

    this.logger.info("[TaskWorker] Shutdown complete.");
  }

  // -------------------------------------------------------------------------
  // Poll cycle
  // -------------------------------------------------------------------------

  private schedulePoll(delayMs: number): void {
    this.pollTimer = setTimeout(() => {
      void this.poll();
    }, delayMs);
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      const available = this.concurrency - this.inFlight.size;
      if (available > 0) {
        // Only claim task types we have handlers for
        const registeredTypes =
          this.handlers.size > 0 ? [...this.handlers.keys()] : undefined;

        const claimed = await this.queue.claimNextBatch(available, registeredTypes);
        this.onPollComplete(claimed.length);

        for (const task of claimed) {
          if (!this.inFlight.has(task.id)) {
            const execution = this.executeTask(task).finally(() => {
              this.inFlight.delete(task.id);
            });
            this.inFlight.set(task.id, execution);
          }
        }
      } else {
        this.onPollComplete(0);
      }
    } catch (err) {
      this.logger.error("[TaskWorker] Poll error:", err);
    }

    if (this.running) {
      this.schedulePoll(this.pollIntervalMs);
    }
  }

  // -------------------------------------------------------------------------
  // Task execution
  // -------------------------------------------------------------------------

  private async executeTask(task: TaskRecord): Promise<void> {
    const handler = this.handlers.get(task.taskType);

    if (!handler) {
      this.logger.warn(
        `[TaskWorker] No handler registered for task type "${task.taskType}" (id=${task.id}). Cancelling task.`,
      );
      await this.queue.cancel(
        task.id,
        `No handler registered for "${task.taskType}".`,
      );
      return;
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort();
    }, task.timeoutMs);

    const ctx: TaskExecutionContext = {
      taskId: task.id,
      attempt: task.attemptCount,
      correlationId: task.correlationId,
      organisationId: task.organisationId,
      userId: task.userId ?? undefined,
      signal: controller.signal,
    };

    try {
      this.logger.info(
        `[TaskWorker] Executing task ${task.id} (type=${task.taskType}, attempt=${task.attemptCount}).`,
      );
      await handler(task.payload, ctx);
      await this.queue.markCompleted(task.id);
      this.logger.info(`[TaskWorker] Task ${task.id} completed.`);
    } catch (err) {
      if (controller.signal.aborted) {
        this.logger.warn(
          `[TaskWorker] Task ${task.id} timed out after ${task.timeoutMs}ms.`,
        );
      } else {
        this.logger.error(`[TaskWorker] Task ${task.id} failed:`, err);
      }

      await this.queue.markFailed(task.id, err);
      this.onNonRetryableError(task.id, task.taskType, err);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
