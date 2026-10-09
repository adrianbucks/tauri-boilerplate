import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import type { MaintenanceOrchestrator, MaintenanceReport } from "@platform/maintenance";
import { TaskQueueService } from "../queue/TaskQueueService.js";
import {
  StorageMaintenanceWorker,
  STORAGE_MAINTENANCE_TASK_TYPE,
} from "../maintenance/StorageMaintenanceWorker.js";
import type { TaskExecutionContext } from "../types.js";

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

function makeCtx(overrides: Partial<TaskExecutionContext> = {}): TaskExecutionContext {
  const controller = new AbortController();
  return {
    taskId: "task-maint-001",
    attempt: 1,
    correlationId: "corr-maint-001",
    organisationId: "system",
    userId: undefined,
    signal: controller.signal,
    ...overrides,
  };
}

describe("StorageMaintenanceWorker", () => {
  let db: MemoryDatabaseConnection;
  let taskQueue: TaskQueueService;

  beforeEach(async () => {
    db = new MemoryDatabaseConnection(":memory:");
    await applySchema(db);
    taskQueue = new TaskQueueService(db);
  });

  it("delegates execution to orchestrator and returns maintenance report", async () => {
    const mockReport: MaintenanceReport = {
      timestamp: new Date().toISOString(),
      durationMs: 42,
      totalRowsPruned: 15,
      results: [],
      vacuumExecuted: true,
      success: true,
      aborted: false,
    };

    const mockOrchestrator = {
      pruneAll: vi.fn().mockResolvedValue(mockReport),
    } as unknown as MaintenanceOrchestrator;

    const worker = new StorageMaintenanceWorker({
      orchestrator: mockOrchestrator,
      taskQueue,
    });

    const report = await worker.handle({ skipVacuum: false, batchSize: 200 }, makeCtx());

    expect(report).toBe(mockReport);
    expect(mockOrchestrator.pruneAll).toHaveBeenCalledWith({
      signal: expect.any(Object),
      skipVacuum: false,
      batchSize: 200,
    });
  });

  it("throws when report indicates failures so background task retry logic engages", async () => {
    const mockReport: MaintenanceReport = {
      timestamp: new Date().toISOString(),
      durationMs: 42,
      totalRowsPruned: 0,
      results: [
        {
          handlerId: "test.fail",
          displayName: "Failing Pruner",
          rowsPruned: 0,
          durationMs: 5,
          error: "Database locked",
        },
      ],
      vacuumExecuted: false,
      success: false,
      aborted: false,
    };

    const mockOrchestrator = {
      pruneAll: vi.fn().mockResolvedValue(mockReport),
    } as unknown as MaintenanceOrchestrator;

    const worker = new StorageMaintenanceWorker({
      orchestrator: mockOrchestrator,
      taskQueue,
    });

    await expect(worker.handle({ skipVacuum: false }, makeCtx())).rejects.toThrow(
      "Maintenance failed: test.fail: Database locked",
    );
  });

  it("enqueues deduplicated maintenance tasks into task queue", async () => {
    const mockOrchestrator = {
      pruneAll: vi.fn(),
    } as unknown as MaintenanceOrchestrator;

    const worker = new StorageMaintenanceWorker({
      orchestrator: mockOrchestrator,
      taskQueue,
    });

    await worker.enqueueMaintenance({ organisationId: "org-demo" });
    await worker.enqueueMaintenance({ organisationId: "org-demo" }); // deduplicate

    const tasks = await taskQueue.listByState("org-demo", "PENDING");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.taskType).toBe(STORAGE_MAINTENANCE_TASK_TYPE);
    expect(tasks[0]!.uniqueKey).toBe("maintenance:storage:org-demo");
  });
});
