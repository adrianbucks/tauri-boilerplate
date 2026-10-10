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
import { ConsoleLogger, ValidationError } from "@platform/core";
import type { DatabaseConnection } from "@platform/database";
import type { TaskExecutionContext, TaskHandler, TaskRecord, TaskWorkerOptions } from "../types.js";
import { TaskQueueService } from "../queue/TaskQueueService.js";

export class TaskWorker {
  private readonly queue: TaskQueueService;
  private readonly logger: Logger;
  private concurrency: number;
  private pollIntervalMs: number;
  private gracefulShutdownTimeoutMs: number;
  private onNonRetryableError: (taskId: string, taskType: string, error: unknown) => void;
  private onPollComplete: (claimed: number) => void;

  private readonly handlers = new Map<string, TaskHandler<unknown, unknown>>();

  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private polling: Promise<void> | null = null;
  /** Active execution promises keyed by task id */
  private readonly inFlight = new Map<string, Promise<void>>();

  private static validateOptions(options: TaskWorkerOptions): void {
    const invalid = (field: string, value: number): never => {
      throw new ValidationError({
        message: `TaskWorker option ${field} must be a positive safe integer; received ${value}`,
        userMessage: "The background worker configuration is invalid.",
        correlationId: `task_worker_${field}`,
      });
    };

    for (const [field, value] of [
      ["concurrency", options.concurrency],
      ["pollIntervalMs", options.pollIntervalMs],
      ["gracefulShutdownTimeoutMs", options.gracefulShutdownTimeoutMs],
    ] as const) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
        invalid(field, value);
      }
    }
  }

  constructor(db: DatabaseConnection, options: TaskWorkerOptions = {}, logger?: Logger) {
    TaskWorker.validateOptions(options);
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
  register<TPayload, TResult>(taskType: string, handler: TaskHandler<TPayload, TResult>): void {
    this.handlers.set(taskType, handler as TaskHandler<unknown, unknown>);
  }

  /**
   * Updates worker options without re-creating the instance or losing registered
   * handlers. Changes take effect from the next poll cycle.
   *
   * Call this instead of creating a new TaskWorker when you need to adjust
   * polling behaviour after construction.
   */
  reconfigure(options: TaskWorkerOptions): void {
    TaskWorker.validateOptions(options);
    if (options.concurrency !== undefined) {
      this.concurrency = options.concurrency;
    }
    if (options.pollIntervalMs !== undefined) {
      this.pollIntervalMs = options.pollIntervalMs;
    }
    if (options.gracefulShutdownTimeoutMs !== undefined) {
      this.gracefulShutdownTimeoutMs = options.gracefulShutdownTimeoutMs;
    }
    if (options.onNonRetryableError !== undefined) {
      this.onNonRetryableError = options.onNonRetryableError;
    }
    if (options.onPollComplete !== undefined) {
      this.onPollComplete = options.onPollComplete;
    }
    this.logger.info(
      "[TaskWorker] Options reconfigured. Changes take effect from next poll cycle.",
    );
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

    // A poll may already have claimed tasks but not yet registered their
    // execution promises. Let it finish dispatching before taking the
    // shutdown snapshot, otherwise stop() can resolve while work is running.
    await this.polling;

    if (this.inFlight.size > 0) {
      const allSettled = Promise.allSettled([...this.inFlight.values()]);
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(resolve, this.gracefulShutdownTimeoutMs);
      });
      try {
        await Promise.race([allSettled, timeout]);
      } finally {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      }
    }

    this.logger.info("[TaskWorker] Shutdown complete.");
  }

  // -------------------------------------------------------------------------
  // Poll cycle
  // -------------------------------------------------------------------------

  private schedulePoll(delayMs: number): void {
    this.pollTimer = setTimeout(() => {
      const polling = this.poll();
      this.polling = polling;
      void polling.finally(() => {
        if (this.polling === polling) this.polling = null;
      });
    }, delayMs);
  }

  private notifyPollComplete(claimed: number): void {
    try {
      this.onPollComplete(claimed);
    } catch (error) {
      this.logger.error("[TaskWorker] onPollComplete callback failed:", error);
    }
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      const available = this.concurrency - this.inFlight.size;
      if (available > 0 && this.handlers.size > 0) {
        // Never claim tasks before a handler has been registered. This keeps
        // startup ordering from cancelling work that the application can handle.
        const registeredTypes = [...this.handlers.keys()];

        const claimed = await this.queue.claimNextBatch(available, registeredTypes);

        for (const task of claimed) {
          if (!this.inFlight.has(task.id)) {
            const execution = this.executeTask(task)
              .finally(() => {
                this.inFlight.delete(task.id);
              })
              .catch((error: unknown) => {
                this.logger.error(
                  `[TaskWorker] Unexpected execution failure for ${task.id}:`,
                  error,
                );
              });
            this.inFlight.set(task.id, execution);
          }
        }
        this.notifyPollComplete(claimed.length);
      } else {
        this.notifyPollComplete(0);
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
      await this.queue.cancel(task.id, `No handler registered for "${task.taskType}".`);
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
      if (controller.signal.aborted) {
        throw new Error(`Task timed out after ${task.timeoutMs}ms`);
      }
      await this.queue.markCompleted(task.id);
      this.logger.info(`[TaskWorker] Task ${task.id} completed.`);
    } catch (err) {
      if (controller.signal.aborted) {
        this.logger.warn(`[TaskWorker] Task ${task.id} timed out after ${task.timeoutMs}ms.`);
      } else {
        this.logger.error(`[TaskWorker] Task ${task.id} failed:`, err);
      }

      const { willRetry } = await this.queue.markFailed(task.id, err);
      if (!willRetry) {
        try {
          this.onNonRetryableError(task.id, task.taskType, err);
        } catch (callbackError) {
          this.logger.error("[TaskWorker] onNonRetryableError callback failed:", callbackError);
        }
      }
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
