import type { DatabaseConnection } from "@platform/database";
import type { PruningContext, PruningHandler, PruningResult } from "../types.js";

export class SyncOutboxPruner implements PruningHandler {
  readonly id = "core.sync.outbox";
  readonly displayName = "Sync Outbox Pruner";
  readonly description =
    "Prunes successfully dispatched sync envelopes (status = 'SENT') past retention cutoff";
  readonly defaultRetentionDays = 14;

  async countEligible(connection: DatabaseConnection, cutoff: Date): Promise<number> {
    const isoCutoff = cutoff.toISOString();
    const sql = `
      SELECT COUNT(*) as count FROM core_sync_outbox
      WHERE status = 'SENT'
        AND (sent_at <= ? OR (sent_at IS NULL AND created_at <= ?))
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
      DELETE FROM core_sync_outbox
      WHERE rowid IN (
        SELECT rowid FROM core_sync_outbox
        WHERE status = 'SENT'
          AND (sent_at <= ? OR (sent_at IS NULL AND created_at <= ?))
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
