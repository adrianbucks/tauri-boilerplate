import type { DatabaseConnection } from "@platform/database";
import type {
  PruningContext,
  PruningHandler,
  PruningResult,
} from "../types.js";

export class ReplicatedTombstonePruner implements PruningHandler {
  readonly id = "core.sync.tombstones";
  readonly displayName = "Replicated Tombstone Pruner";
  readonly description =
    "Prunes cluster-acknowledged soft-delete tombstones past retention cutoff";
  readonly defaultRetentionDays = 30;

  async countEligible(
    connection: DatabaseConnection,
    cutoff: Date,
  ): Promise<number> {
    const isoCutoff = cutoff.toISOString();
    const sql = `
      SELECT COUNT(*) as count FROM core_sync_tombstones
      WHERE replicated_at IS NOT NULL
        AND replicated_at <= ?
    `;
    const rows = await connection.query<{
      count?: number;
      cnt?: number;
      "COUNT(*)": number;
    }>(sql, [isoCutoff]);
    return Number(rows[0]?.count ?? rows[0]?.cnt ?? rows[0]?.["COUNT(*)"] ?? 0);
  }

  async prune(ctx: PruningContext): Promise<PruningResult> {
    const start = performance.now();
    const isoCutoff = ctx.cutoffDate.toISOString();
    const deleteSql = `
      DELETE FROM core_sync_tombstones
      WHERE rowid IN (
        SELECT rowid FROM core_sync_tombstones
        WHERE replicated_at IS NOT NULL
          AND replicated_at <= ?
        LIMIT ?
      )
    `;

    let rowsPruned = 0;
    while (!ctx.signal?.aborted) {
      const result = await ctx.connection.execute(deleteSql, [
        isoCutoff,
        ctx.batchSize,
      ]);
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
