import type { Logger } from "@platform/core";
import { ConsoleLogger } from "@platform/core";
import type { DatabaseConnection } from "@platform/database";
import type {
  MaintenanceReport,
  PruningCandidateStats,
  PruningResult,
} from "../types.js";
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

  constructor(options: MaintenanceOrchestratorOptions) {
    this.connection = options.connection;
    this.registry =
      options.registry ??
      new MaintenanceRegistry({ includeCoreDefaults: true });
    this.defaultBatchSize = options.defaultBatchSize ?? 500;
    this.retentionOverrides = { ...(options.retentionOverrides ?? {}) };
    this.logger = options.logger ?? new ConsoleLogger("info");
  }

  setRetentionOverride(handlerId: string, retentionDays: number): void {
    this.retentionOverrides[handlerId] = retentionDays;
  }

  getRetentionDays(handlerId: string, fallbackDefault: number): number {
    return this.retentionOverrides[handlerId] ?? fallbackDefault;
  }

  async inspectAll(): Promise<PruningCandidateStats[]> {
    const handlers = this.registry.getAllHandlers();
    const stats: PruningCandidateStats[] = [];

    for (const handler of handlers) {
      const retentionDays = this.getRetentionDays(
        handler.id,
        handler.defaultRetentionDays,
      );
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      try {
        const count = await handler.countEligible(this.connection, cutoff);
        stats.push({
          handlerId: handler.id,
          displayName: handler.displayName,
          description: handler.description,
          retentionDays,
          cutoffDate: cutoff.toISOString(),
          eligibleRowCount: count,
        });
      } catch (err) {
        this.logger.error(
          `[MaintenanceOrchestrator] Error inspecting handler ${handler.id}:`,
          err,
        );
        stats.push({
          handlerId: handler.id,
          displayName: handler.displayName,
          description: handler.description,
          retentionDays,
          cutoffDate: cutoff.toISOString(),
          eligibleRowCount: 0,
        });
      }
    }

    return stats;
  }

  async pruneHandler(
    handlerId: string,
    options?: PruneHandlerOptions,
  ): Promise<PruningResult> {
    const handler = this.registry.getHandler(handlerId);
    if (!handler) {
      throw new Error(
        `[MaintenanceOrchestrator] Pruning handler '${handlerId}' not found.`,
      );
    }

    const retentionDays =
      options?.retentionDays ??
      this.getRetentionDays(handler.id, handler.defaultRetentionDays);
    const cutoffDate = new Date(
      Date.now() - retentionDays * 24 * 60 * 60 * 1000,
    );
    const batchSize = options?.batchSize ?? this.defaultBatchSize;

    return await handler.prune({
      connection: this.connection,
      cutoffDate,
      batchSize,
      signal: options?.signal,
    });
  }

  async pruneAll(options?: PruneAllOptions): Promise<MaintenanceReport> {
    const startTime = performance.now();
    const timestamp = new Date().toISOString();
    const results: PruningResult[] = [];
    const handlers = this.registry.getAllHandlers();

    this.logger.info(
      `[MaintenanceOrchestrator] Starting storage maintenance across ${handlers.length} handler(s).`,
    );

    let aborted = false;

    for (const handler of handlers) {
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

      const retentionDays = this.getRetentionDays(
        handler.id,
        handler.defaultRetentionDays,
      );
      const cutoffDate = new Date(
        Date.now() - retentionDays * 24 * 60 * 60 * 1000,
      );
      const batchSize = options?.batchSize ?? this.defaultBatchSize;

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
        this.logger.error(
          `[MaintenanceOrchestrator] Handler '${handler.id}' failed: ${errorMsg}`,
        );
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
    const shouldVacuum =
      !options?.skipVacuum && (totalRowsPruned > 0 || !wasAborted);

    if (shouldVacuum) {
      try {
        this.logger.info(
          "[MaintenanceOrchestrator] Executing VACUUM space reclamation...",
        );
        await this.connection.execute("VACUUM;");
        vacuumExecuted = true;
        this.logger.info("[MaintenanceOrchestrator] VACUUM complete.");
      } catch (err) {
        this.logger.error(
          "[MaintenanceOrchestrator] VACUUM execution failed:",
          err,
        );
      }
    }

    const durationMs = Math.round(performance.now() - startTime);
    const success = results
      .filter((r) => r.error !== "Pruning aborted by signal")
      .every((r) => !r.error);

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
