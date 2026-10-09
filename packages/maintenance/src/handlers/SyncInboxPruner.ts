import type { DatabaseConnection } from "@platform/database";
import type { PruningContext, PruningHandler, PruningResult } from "../types.js";

export class SyncInboxPruner implements PruningHandler {
  readonly id = "core.sync.inbox";
  readonly displayName = "Sync Inbox Pruner";
  readonly description =
    "Prunes processed sync deduplication records (apply_status = 'APPLIED' or 'CONFLICT') past replay window";
  readonly defaultRetentionDays = 30;

  async countEligible(connection: DatabaseConnection, cutoff: Date): Promise<number> {
    const isoCutoff = cutoff.toISOString();
    const sql = `
      SELECT COUNT(*) as count FROM core_sync_inbox
      WHERE apply_status IN ('APPLIED', 'CONFLICT')
        AND (applied_at <= ? OR (applied_at IS NULL AND created_at <= ?))
    `;
    const rows = await connection.query<{
      count?: number;
      cnt?: number;
      "COUNT(*)": number;
    }>(sql, [isoCutoff, isoCutoff]);
    return Number(rows[0]?.count ?? rows[0]?.cnt ?? rows[0]?.["COUNT(*)"] ?? 0);
  }

  async prune(ctx: PruningContext): Promise<PruningResult> {
    const start = performance.now();
    const isoCutoff = ctx.cutoffDate.toISOString();
    const deleteSql = `
      DELETE FROM core_sync_inbox
      WHERE rowid IN (
        SELECT rowid FROM core_sync_inbox
        WHERE apply_status IN ('APPLIED', 'CONFLICT')
          AND (applied_at <= ? OR (applied_at IS NULL AND created_at <= ?))
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
