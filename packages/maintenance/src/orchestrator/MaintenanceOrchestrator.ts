import type { Logger } from "@platform/core";
import { ConsoleLogger, ValidationError } from "@platform/core";
import type { DatabaseConnection } from "@platform/database";
import type { MaintenanceReport, PruningCandidateStats, PruningResult } from "../types.js";
import { MaintenanceRegistry } from "../registry/MaintenanceRegistry.js";

export interface MaintenanceOrchestratorOptions {
  connection: DatabaseConnection;
  registry?: MaintenanceRegistry | undefined;
  defaultBatchSize?: number | undefined;
  retentionOverrides?: Record<string, number> | undefined;
  logger?: Logger | undefined;
}

export interface PruneAllOptions {
  signal?: AbortSignal | undefined;
  skipVacuum?: boolean | undefined;
  batchSize?: number | undefined;
}

export interface PruneHandlerOptions {
  signal?: AbortSignal | undefined;
  retentionDays?: number | undefined;
  batchSize?: number | undefined;
}

export class MaintenanceOrchestrator {
  private readonly connection: DatabaseConnection;
  readonly registry: MaintenanceRegistry;
  private readonly defaultBatchSize: number;
  private readonly retentionOverrides: Record<string, number>;
  private readonly logger: Logger;

  private static validatePositiveNumber(field: string, value: number, integer = false): void {
    if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isSafeInteger(value))) {
      throw new ValidationError({
        message: `Maintenance ${field} must be a positive${integer ? " safe integer" : " finite number"}; received ${value}`,
        userMessage: "The maintenance configuration is invalid.",
        correlationId: `maintenance_${field}`,
      });
    }
  }

  private static cutoffForRetention(retentionDays: number): Date {
    this.validatePositiveNumber("retention days", retentionDays);
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    if (!Number.isFinite(cutoff.getTime())) {
      throw new ValidationError({
        message: `Maintenance retention days exceed the supported date range: ${retentionDays}`,
        userMessage: "The maintenance retention period is invalid.",
        correlationId: "maintenance_retention_days",
      });
    }
    return cutoff;
  }

  constructor(options: MaintenanceOrchestratorOptions) {
    this.connection = options.connection;
    this.registry = options.registry ?? new MaintenanceRegistry({ includeCoreDefaults: true });
    this.defaultBatchSize = options.defaultBatchSize ?? 500;
    this.retentionOverrides = { ...(options.retentionOverrides ?? {}) };
    this.logger = options.logger ?? new ConsoleLogger("info");
    MaintenanceOrchestrator.validatePositiveNumber("batch size", this.defaultBatchSize, true);
    for (const [handlerId, retentionDays] of Object.entries(this.retentionOverrides)) {
      MaintenanceOrchestrator.validatePositiveNumber(
        `retention override for ${handlerId}`,
        retentionDays,
      );
    }
  }

  setRetentionOverride(handlerId: string, retentionDays: number): void {
    MaintenanceOrchestrator.validatePositiveNumber(
      `retention override for ${handlerId}`,
      retentionDays,
    );
    this.retentionOverrides[handlerId] = retentionDays;
  }

  getRetentionDays(handlerId: string, fallbackDefault: number): number {
    return this.retentionOverrides[handlerId] ?? fallbackDefault;
  }

  async inspectAll(): Promise<PruningCandidateStats[]> {
    const handlers = this.registry.getAllHandlers();
    const stats: PruningCandidateStats[] = [];

    for (const handler of handlers) {
      const retentionDays = this.getRetentionDays(handler.id, handler.defaultRetentionDays);
      let cutoffDate = "";
      try {
        const cutoff = MaintenanceOrchestrator.cutoffForRetention(retentionDays);
        cutoffDate = cutoff.toISOString();
        const count = await handler.countEligible(this.connection, cutoff);
        if (!Number.isSafeInteger(count) || count < 0) {
          throw new ValidationError({
            message: `Maintenance handler '${handler.id}' returned invalid eligible row count ${count}`,
            userMessage: "A maintenance handler returned an invalid inspection result.",
            correlationId: `maintenance_count_${handler.id}`,
          });
        }
        stats.push({
          handlerId: handler.id,
          displayName: handler.displayName,
          description: handler.description,
          retentionDays,
          cutoffDate,
          eligibleRowCount: count,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.logger.error(`[MaintenanceOrchestrator] Error inspecting handler ${handler.id}:`, err);
        stats.push({
          handlerId: handler.id,
          displayName: handler.displayName,
          description: handler.description,
          retentionDays,
          cutoffDate,
          eligibleRowCount: 0,
          error: errorMessage,
        });
      }
    }

    return stats;
  }

  async pruneHandler(handlerId: string, options?: PruneHandlerOptions): Promise<PruningResult> {
    const handler = this.registry.getHandler(handlerId);
    if (!handler) {
      throw new Error(`[MaintenanceOrchestrator] Pruning handler '${handlerId}' not found.`);
    }

    const retentionDays =
      options?.retentionDays ?? this.getRetentionDays(handler.id, handler.defaultRetentionDays);
    const batchSize = options?.batchSize ?? this.defaultBatchSize;
    MaintenanceOrchestrator.validatePositiveNumber("batch size", batchSize, true);
    const cutoffDate = MaintenanceOrchestrator.cutoffForRetention(retentionDays);

    return await handler.prune({
      connection: this.connection,
      cutoffDate,
      batchSize,
      signal: options?.signal,
    });
  }

  async pruneAll(options?: PruneAllOptions): Promise<MaintenanceReport> {
    const batchSize = options?.batchSize ?? this.defaultBatchSize;
    MaintenanceOrchestrator.validatePositiveNumber("batch size", batchSize, true);
    const startTime = performance.now();
    const timestamp = new Date().toISOString();
    const results: PruningResult[] = [];
    const handlers = this.registry.getAllHandlers();
    // Validate every handler's effective retention before deleting anything;
    // a bad later policy must not leave the earlier handlers partially pruned.
    const plans = handlers.map((handler) => {
      const retentionDays = this.getRetentionDays(handler.id, handler.defaultRetentionDays);
      return {
        handler,
        retentionDays,
        cutoffDate: MaintenanceOrchestrator.cutoffForRetention(retentionDays),
      };
    });

    this.logger.info(
      `[MaintenanceOrchestrator] Starting storage maintenance across ${handlers.length} handler(s).`,
    );

    let aborted = false;

    for (const { handler, cutoffDate } of plans) {
      if (options?.signal?.aborted) {
        aborted = true;
        this.logger.warn(
          "[MaintenanceOrchestrator] Abort signal triggered; stopping maintenance sequence.",
        );
        results.push({
          handlerId: handler.id,
          displayName: handler.displayName,
          rowsPruned: 0,
          durationMs: 0,
          error: "Pruning aborted by signal",
        });
        break;
      }

      try {
        const result = await handler.prune({
          connection: this.connection,
          cutoffDate,
          batchSize,
          signal: options?.signal,
        });
        results.push(result);
        this.logger.info(
          `[MaintenanceOrchestrator] Handler '${handler.id}' pruned ${result.rowsPruned} row(s) in ${result.durationMs}ms.`,
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[MaintenanceOrchestrator] Handler '${handler.id}' failed: ${errorMsg}`);
        results.push({
          handlerId: handler.id,
          displayName: handler.displayName,
          rowsPruned: 0,
          durationMs: 0,
          error: errorMsg,
        });
      }
    }

    const wasAborted = Boolean(options?.signal?.aborted || aborted);
    const totalRowsPruned = results.reduce((acc, r) => acc + r.rowsPruned, 0);

    let vacuumExecuted = false;
    // B-06: VACUUM executes whenever rows were pruned (even if aborted), or if completed without abort
    const shouldVacuum = !options?.skipVacuum && (totalRowsPruned > 0 || !wasAborted);

    if (shouldVacuum) {
      try {
        this.logger.info("[MaintenanceOrchestrator] Executing VACUUM space reclamation...");
        await this.connection.execute("VACUUM;");
        vacuumExecuted = true;
        this.logger.info("[MaintenanceOrchestrator] VACUUM complete.");
      } catch (err) {
        this.logger.error("[MaintenanceOrchestrator] VACUUM execution failed:", err);
      }
    }

    const durationMs = Math.round(performance.now() - startTime);
    const success = !wasAborted && results.every((result) => !result.error);

    return {
      timestamp,
      durationMs,
      totalRowsPruned,
      results,
      vacuumExecuted,
      success,
      aborted: wasAborted,
    };
  }
}
