/**
 * TaskWorker Tests
 *
 * Covers: handler registration, execution loop, successful dispatch,
 * timeout/abort signal, non-retryable error handling, graceful shutdown,
 * and fallback for unregistered task types.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { TaskQueueService } from "../queue/TaskQueueService.js";
import { TaskWorker } from "../worker/TaskWorker.js";
import type { TaskDefinition, TaskExecutionContext } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
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

function makeDefinition(
  overrides: Partial<TaskDefinition> = {},
): TaskDefinition {
  return {
    taskType: "test.work",
    payload: { n: 1 },
    organisationId: "org-123",
    correlationId: "corr-abc",
    ...overrides,
  };
}

/**
 * Wait for a condition to become true with polling, up to maxMs.
 * Uses longer default timeout (8s) since vitest test timeout is 10s.
 */
async function waitFor(
  condition: () => Promise<boolean> | boolean,
  maxMs = 8_000,
  intervalMs = 50,
): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor: condition never became true within timeout");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TaskWorker", () => {
  let db: MemoryDatabaseConnection;
  let queue: TaskQueueService;
  let worker: TaskWorker;

  beforeEach(async () => {
    db = new MemoryDatabaseConnection("test");
    await applySchema(db);
    queue = new TaskQueueService(db);
    // Short poll interval so tests don't wait long
    worker = new TaskWorker(db, { pollIntervalMs: 50, concurrency: 3 });
  });

  // -------------------------------------------------------------------------
  // Handler dispatch → COMPLETED
  // -------------------------------------------------------------------------

  it("executes a registered handler and marks the task COMPLETED", async () => {
    const executed: string[] = [];

    worker.register<{ n: number }, void>("test.work", async (payload, ctx) => {
      executed.push(ctx.taskId);
      expect(payload.n).toBe(1);
    });

    const task = await queue.enqueue(makeDefinition());
    worker.start();

    try {
      await waitFor(async () => {
        const t = await queue.findById(task.id);
        return t?.state === "COMPLETED";
      });
    } finally {
      await worker.stop();
    }

    expect(executed).toContain(task.id);
  }, 15_000);

  // -------------------------------------------------------------------------
  // Unregistered handler → CANCELLED
  // -------------------------------------------------------------------------

  it("cancels tasks for which no handler is registered", async () => {
    // Enqueue a task type for which NO handler is registered
    const task = await queue.enqueue(makeDefinition({ taskType: "unknown.type" }));

    // Register a dummy handler so the worker claims tasks at all (it filters by registered types)
    // — we need the worker to be willing to claim "unknown.type", so register a handler for it
    // but immediately remove it to simulate the no-handler path.
    // Actually: if no handlers are registered, claimNextBatch uses undefined (all types).
    // So we don't register any handler — the worker will claim the task and then cancel it.
    worker.start();

    try {
      await waitFor(async () => {
        const t = await queue.findById(task.id);
        return t?.state === "CANCELLED";
      });
    } finally {
      await worker.stop();
    }

    const updated = await queue.findById(task.id);
    expect(updated?.lastError).toContain("No handler registered");
  }, 15_000);

  // -------------------------------------------------------------------------
  // Handler throws → FAILED (maxAttempts=1)
  // -------------------------------------------------------------------------

  it("marks task FAILED when handler throws and maxAttempts is exhausted", async () => {
    worker.register("test.work", async () => {
      throw new Error("handler blew up");
    });

    const task = await queue.enqueue(
      makeDefinition({ retryPolicy: { maxAttempts: 1 } }),
    );
    worker.start();

    try {
      await waitFor(async () => {
        const t = await queue.findById(task.id);
        // With maxAttempts=1, after 1 attempt the task is FAILED
        return t?.state === "FAILED";
      });
    } finally {
      await worker.stop();
    }

    const updated = await queue.findById(task.id);
    expect(updated?.state).toBe("FAILED");
  }, 15_000);

  // -------------------------------------------------------------------------
  // Abort signal on timeout
  // -------------------------------------------------------------------------

  it("fires the AbortSignal when the task times out", async () => {
    let signalAborted = false;

    worker.register(
      "test.work",
      async (_payload, ctx: TaskExecutionContext) => {
        await new Promise<void>((resolve) => {
          ctx.signal.addEventListener("abort", () => {
            signalAborted = true;
            resolve();
          });
          // Safety valve: also resolve after 2s even if abort doesn't fire
          setTimeout(resolve, 2_000);
        });
      },
    );

    // Very short timeout so the AbortController fires quickly
    const task = await queue.enqueue(makeDefinition({ timeoutMs: 100 }));
    worker.start();

    try {
      await waitFor(() => signalAborted, 8_000);
    } finally {
      await worker.stop();
    }

    expect(signalAborted).toBe(true);
    const updated = await queue.findById(task.id);
    // After abort: if handler exits cleanly → COMPLETED; if it throws → PENDING (retry) or FAILED
    expect(["PENDING", "FAILED", "COMPLETED"]).toContain(updated?.state);
  }, 15_000);

  // -------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------

  it("waits for in-flight tasks before resolving stop()", async () => {
    let completed = false;

    worker.register("test.work", async () => {
      await new Promise((r) => setTimeout(r, 200));
      completed = true;
    });

    await queue.enqueue(makeDefinition());
    worker.start();

    // Give the worker enough time to claim and start the task
    await new Promise((r) => setTimeout(r, 150));

    // stop() should wait until the in-flight task finishes
    await worker.stop();
    expect(completed).toBe(true);
  }, 15_000);

  // -------------------------------------------------------------------------
  // Concurrency limit
  // -------------------------------------------------------------------------

  it("executes up to `concurrency` tasks simultaneously", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    let completedCount = 0;

    worker.register("test.work", async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 80));
      concurrent--;
      completedCount++;
    });

    const totalTasks = 5;
    for (let i = 0; i < totalTasks; i++) await queue.enqueue(makeDefinition());
    worker.start();

    try {
      await waitFor(async () => {
        const done = await queue.listByState("org-123", "COMPLETED");
        return done.length === totalTasks;
      }, 10_000);
    } finally {
      await worker.stop();
    }

    expect(completedCount).toBe(totalTasks);
    // concurrency limit is 3, max simultaneous should be <= 3
    expect(maxConcurrent).toBeLessThanOrEqual(3);
    expect(maxConcurrent).toBeGreaterThan(0);
  }, 20_000);

  // -------------------------------------------------------------------------
  // Idempotent start
  // -------------------------------------------------------------------------

  it("start() is idempotent", async () => {
    worker.register("test.work", async () => {});
    worker.start();
    worker.start(); // should not throw or double-poll
    await worker.stop();
  }, 5_000);
});
