/**
 * TaskQueueService Tests
 *
 * Covers: enqueue, deduplication, atomic claiming, markCompleted,
 * markFailed (retry reschedule + exhaustion), cancel, and crash recovery.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { TaskQueueService } from "../queue/TaskQueueService.js";
import type { TaskDefinition } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function applySchema(db: MemoryDatabaseConnection): Promise<void> {
  // Minimal DDL matching the migration (tasks-schema.sql)
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
    taskType: "test.task",
    payload: { value: 42 },
    organisationId: "org-123",
    correlationId: "corr-abc",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TaskQueueService", () => {
  let db: MemoryDatabaseConnection;
  let service: TaskQueueService;

  beforeEach(async () => {
    db = new MemoryDatabaseConnection("test");
    await applySchema(db);
    service = new TaskQueueService(db);
  });

  // -------------------------------------------------------------------------
  // enqueue
  // -------------------------------------------------------------------------

  describe("enqueue", () => {
    it("creates a PENDING task and returns a TaskRecord", async () => {
      const task = await service.enqueue(makeDefinition());

      expect(task.state).toBe("PENDING");
      expect(task.taskType).toBe("test.task");
      expect(task.payload).toEqual({ value: 42 });
      expect(task.organisationId).toBe("org-123");
      expect(task.attemptCount).toBe(0);
      expect(task.id).toBeTruthy();
    });

    it("persists payload as JSON round-trip", async () => {
      const payload = { nested: { a: 1, b: [2, 3] } };
      const task = await service.enqueue(makeDefinition({ payload }));
      expect(task.payload).toEqual(payload);
    });

    it("applies custom retry policy overrides", async () => {
      const task = await service.enqueue(
        makeDefinition({
          retryPolicy: { maxAttempts: 7, initialDelayMs: 500 },
        }),
      );
      expect(task.maxAttempts).toBe(7);
      expect(task.retryDelayMs).toBe(500);
    });

    it("uses scheduledAt override when provided", async () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      const task = await service.enqueue(makeDefinition({ scheduledAt: future }));
      expect(task.scheduledAt).toBe(future);
    });
  });

  // -------------------------------------------------------------------------
  // Deduplication
  // -------------------------------------------------------------------------

  describe("deduplication via uniqueKey", () => {
    it("returns the existing task when a PENDING task with the same uniqueKey exists", async () => {
      const first = await service.enqueue(
        makeDefinition({ uniqueKey: "uq-001" }),
      );
      const second = await service.enqueue(
        makeDefinition({ uniqueKey: "uq-001" }),
      );

      expect(first.id).toBe(second.id);
    });

    it("creates a new task after the first with the same uniqueKey is COMPLETED", async () => {
      const first = await service.enqueue(
        makeDefinition({ uniqueKey: "uq-002" }),
      );

      // Claim and complete the first task
      await service.claimNextBatch(10);
      await service.markCompleted(first.id);

      const second = await service.enqueue(
        makeDefinition({ uniqueKey: "uq-002" }),
      );
      expect(second.id).not.toBe(first.id);
      expect(second.state).toBe("PENDING");
    });
  });

  // -------------------------------------------------------------------------
  // claimNextBatch
  // -------------------------------------------------------------------------

  describe("claimNextBatch", () => {
    it("transitions PENDING tasks to RUNNING and increments attempt_count", async () => {
      await service.enqueue(makeDefinition());
      await service.enqueue(makeDefinition());

      const claimed = await service.claimNextBatch(10);
      expect(claimed).toHaveLength(2);
      for (const t of claimed) {
        expect(t.state).toBe("RUNNING");
        expect(t.attemptCount).toBe(1);
        expect(t.startedAt).toBeTruthy();
      }
    });

    it("does not exceed the specified limit", async () => {
      for (let i = 0; i < 5; i++) await service.enqueue(makeDefinition());
      const claimed = await service.claimNextBatch(3);
      expect(claimed).toHaveLength(3);
    });

    it("returns empty array when no tasks are due", async () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      await service.enqueue(makeDefinition({ scheduledAt: future }));
      const claimed = await service.claimNextBatch(10);
      expect(claimed).toHaveLength(0);
    });

    it("filters by taskType when taskTypes list is provided", async () => {
      await service.enqueue(makeDefinition({ taskType: "type.a" }));
      await service.enqueue(makeDefinition({ taskType: "type.b" }));

      const claimed = await service.claimNextBatch(10, ["type.a"]);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]!.taskType).toBe("type.a");
    });
  });

  // -------------------------------------------------------------------------
  // markCompleted
  // -------------------------------------------------------------------------

  describe("markCompleted", () => {
    it("transitions a RUNNING task to COMPLETED", async () => {
      const task = await service.enqueue(makeDefinition());
      await service.claimNextBatch(10);
      await service.markCompleted(task.id);

      const updated = await service.findById(task.id);
      expect(updated?.state).toBe("COMPLETED");
      expect(updated?.completedAt).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // markFailed — retry reschedule
  // -------------------------------------------------------------------------

  describe("markFailed (retryable error)", () => {
    it("reschedules task to PENDING when attempts remain", async () => {
      const task = await service.enqueue(
        makeDefinition({ retryPolicy: { maxAttempts: 3 } }),
      );
      await service.claimNextBatch(10);

      // Fail with a generic (retryable) error
      await service.markFailed(task.id, new Error("transient failure"));

      const updated = await service.findById(task.id);
      expect(updated?.state).toBe("PENDING");
      expect(updated?.lastError).toBe("transient failure");
      expect(updated?.scheduledAt).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // markFailed — exhaustion
  // -------------------------------------------------------------------------

  describe("markFailed (attempts exhausted)", () => {
    it("marks task FAILED when maxAttempts is reached", async () => {
      const task = await service.enqueue(
        makeDefinition({ retryPolicy: { maxAttempts: 1 } }),
      );
      // Claim (attempt_count becomes 1)
      await service.claimNextBatch(10);
      // Fail — attempt_count (1) >= maxAttempts (1), so FAILED
      await service.markFailed(task.id, new Error("permanent-ish"));

      const updated = await service.findById(task.id);
      expect(updated?.state).toBe("FAILED");
      expect(updated?.failedAt).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // markFailed — non-retryable error class
  // -------------------------------------------------------------------------

  describe("markFailed (non-retryable error)", () => {
    it("marks task FAILED immediately for AuthorizationError", async () => {
      const { AuthorizationError } = await import("@platform/core");

      const task = await service.enqueue(
        makeDefinition({ retryPolicy: { maxAttempts: 5 } }),
      );
      await service.claimNextBatch(10);

      const authErr = new AuthorizationError({
        message: "Access denied",
        userMessage: "You do not have permission.",
        correlationId: "corr-xyz",
      });
      await service.markFailed(task.id, authErr);

      const updated = await service.findById(task.id);
      expect(updated?.state).toBe("FAILED");
    });
  });

  // -------------------------------------------------------------------------
  // cancel
  // -------------------------------------------------------------------------

  describe("cancel", () => {
    it("transitions a PENDING task to CANCELLED with reason", async () => {
      const task = await service.enqueue(makeDefinition());
      await service.cancel(task.id, "User requested cancellation.");

      const updated = await service.findById(task.id);
      expect(updated?.state).toBe("CANCELLED");
      expect(updated?.lastError).toBe("User requested cancellation.");
    });

    it("transitions a RUNNING task to CANCELLED", async () => {
      const task = await service.enqueue(makeDefinition());
      await service.claimNextBatch(10);
      await service.cancel(task.id, "Operator cancelled.");

      const updated = await service.findById(task.id);
      expect(updated?.state).toBe("CANCELLED");
    });
  });

  // -------------------------------------------------------------------------
  // recoverHangingTasks (crash recovery)
  // -------------------------------------------------------------------------

  describe("recoverHangingTasks", () => {
    it("resets RUNNING tasks older than the timeout back to PENDING", async () => {
      const task = await service.enqueue(makeDefinition());
      await service.claimNextBatch(10);

      // Manually back-date started_at to simulate a crash that happened 2 minutes ago
      const oldStart = new Date(Date.now() - 120_000).toISOString();
      await db.execute(
        `UPDATE core_background_tasks SET started_at = ? WHERE id = ?`,
        [oldStart, task.id],
      );

      const recovered = await service.recoverHangingTasks(60_000);
      expect(recovered).toBe(1);

      const updated = await service.findById(task.id);
      expect(updated?.state).toBe("PENDING");
      expect(updated?.startedAt).toBeNull();
    });

    it("does not reset RUNNING tasks within the timeout window", async () => {
      const task = await service.enqueue(makeDefinition());
      await service.claimNextBatch(10);

      // started_at defaults to now — well within timeout
      const recovered = await service.recoverHangingTasks(60_000);
      expect(recovered).toBe(0);

      const updated = await service.findById(task.id);
      expect(updated?.state).toBe("RUNNING");
    });
  });

  // -------------------------------------------------------------------------
  // listByState
  // -------------------------------------------------------------------------

  describe("listByState", () => {
    it("returns tasks filtered by state and organisation", async () => {
      await service.enqueue(makeDefinition({ organisationId: "org-A" }));
      await service.enqueue(makeDefinition({ organisationId: "org-B" }));

      const result = await service.listByState("org-A", "PENDING");
      expect(result).toHaveLength(1);
      expect(result[0]!.organisationId).toBe("org-A");
    });
  });
});
