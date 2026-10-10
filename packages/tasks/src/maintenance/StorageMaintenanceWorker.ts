import type { Logger } from "@platform/core";
import { ConsoleLogger, generateCorrelationId } from "@platform/core";
import type { MaintenanceOrchestrator, MaintenanceReport } from "@platform/maintenance";
import type { TaskExecutionContext } from "../types.js";
import type { TaskQueueService } from "../queue/TaskQueueService.js";
import { DEFAULT_RETRY_POLICY } from "../types.js";

export const STORAGE_MAINTENANCE_TASK_TYPE = "platform.maintenance.storage" as const;

export interface StorageMaintenancePayload {
  readonly skipVacuum?: boolean | undefined;
  readonly batchSize?: number | undefined;
  readonly organisationId?: string | undefined;
}

export class StorageMaintenanceWorker {
  static readonly TASK_TYPE = STORAGE_MAINTENANCE_TASK_TYPE;

  private readonly orchestrator: MaintenanceOrchestrator;
  private readonly taskQueue: TaskQueueService;
  private readonly logger: Logger;

  constructor(options: {
    orchestrator: MaintenanceOrchestrator;
    taskQueue: TaskQueueService;
    logger?: Logger | undefined;
  }) {
    this.orchestrator = options.orchestrator;
    this.taskQueue = options.taskQueue;
    this.logger = options.logger ?? new ConsoleLogger("info");
  }

  handle = async (
    payload: StorageMaintenancePayload,
    ctx: TaskExecutionContext,
  ): Promise<MaintenanceReport> => {
    this.logger.info(
      `[StorageMaintenanceWorker] Starting storage maintenance (correlation=${ctx.correlationId}, attempt=${ctx.attempt}).`,
    );

    const report = await this.orchestrator.pruneAll({
      signal: ctx.signal,
      skipVacuum: payload.skipVacuum,
      batchSize: payload.batchSize,
    });

    this.logger.info(
      `[StorageMaintenanceWorker] Maintenance finished: pruned=${report.totalRowsPruned}, vacuum=${report.vacuumExecuted}, success=${report.success}, duration=${report.durationMs}ms.`,
    );

    if (report.aborted || ctx.signal.aborted) {
      throw new Error("[StorageMaintenanceWorker] Maintenance was interrupted before completion.");
    }

    if (!report.success) {
      const errors = report.results
        .filter((r) => r.error)
        .map((r) => `${r.handlerId}: ${r.error}`)
        .join("; ");
      throw new Error(`[StorageMaintenanceWorker] Maintenance failed: ${errors}`);
    }

    return report;
  };

  async enqueueMaintenance(options?: {
    organisationId?: string | undefined;
    skipVacuum?: boolean | undefined;
    batchSize?: number | undefined;
  }): Promise<void> {
    const orgId = options?.organisationId ?? "system";
    await this.taskQueue.enqueue<StorageMaintenancePayload>({
      taskType: STORAGE_MAINTENANCE_TASK_TYPE,
      uniqueKey: `maintenance:storage:${orgId}`,
      organisationId: orgId,
      payload: {
        organisationId: orgId,
        skipVacuum: options?.skipVacuum,
        batchSize: options?.batchSize,
      },
      correlationId: generateCorrelationId("storage-maintenance"),
      retryPolicy: DEFAULT_RETRY_POLICY,
    });
  }
}
