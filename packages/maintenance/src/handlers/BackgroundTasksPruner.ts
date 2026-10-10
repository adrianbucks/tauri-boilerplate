import type { DatabaseConnection } from "@platform/database";
import type { PruningContext, PruningHandler, PruningResult } from "../types.js";
import { validatePruningContext } from "../validation.js";

export class BackgroundTasksPruner implements PruningHandler {
  readonly id = "core.tasks";
  readonly displayName = "Background Tasks Pruner";
  readonly description = "Prunes completed or cancelled background tasks past retention cutoff";
  readonly defaultRetentionDays = 7;

  async countEligible(connection: DatabaseConnection, cutoff: Date): Promise<number> {
    const isoCutoff = cutoff.toISOString();
    const sql = `
      SELECT COUNT(*) as count FROM core_background_tasks
      WHERE state IN ('COMPLETED', 'CANCELLED')
        AND (completed_at <= ? OR (completed_at IS NULL AND updated_at <= ?))
    `;
    const rows = await connection.query<{
      count?: number;
      cnt?: number;
      "COUNT(*)": number;
    }>(sql, [isoCutoff, isoCutoff]);
    return Number(rows[0]?.count ?? rows[0]?.cnt ?? rows[0]?.["COUNT(*)"] ?? 0);
  }

  async prune(ctx: PruningContext): Promise<PruningResult> {
    validatePruningContext(ctx);
    const start = performance.now();
    const isoCutoff = ctx.cutoffDate.toISOString();
    const deleteSql = `
      DELETE FROM core_background_tasks
      WHERE rowid IN (
        SELECT rowid FROM core_background_tasks
        WHERE state IN ('COMPLETED', 'CANCELLED')
          AND (completed_at <= ? OR (completed_at IS NULL AND updated_at <= ?))
        LIMIT ?
      )
    `;

    let rowsPruned = 0;
    while (!ctx.signal?.aborted) {
      const result = await ctx.connection.execute(deleteSql, [isoCutoff, isoCutoff, ctx.batchSize]);
      if (result.rowsAffected === 0) break;
      rowsPruned += result.rowsAffected;
      if (result.rowsAffected < ctx.batchSize) break;
    }

    return {
      handlerId: this.id,
      displayName: this.displayName,
      rowsPruned,
      durationMs: Math.round(performance.now() - start),
    };
  }
}
