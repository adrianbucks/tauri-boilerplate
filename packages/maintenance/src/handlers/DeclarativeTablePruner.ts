import { isSafePruningFilterCondition, ValidationError } from "@platform/core";
import type { DatabaseConnection } from "@platform/database";
import type {
  DeclarativePruningPolicy,
  PruningContext,
  PruningHandler,
  PruningResult,
} from "../types.js";
import { validatePruningContext } from "../validation.js";

const IDENTIFIER_REGEX = /^[a-zA-Z0-9_]+$/;

export class DeclarativeTablePruner implements PruningHandler {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly defaultRetentionDays: number;
  readonly policy: DeclarativePruningPolicy;

  constructor(policy: DeclarativePruningPolicy) {
    if (!Number.isFinite(policy.defaultRetentionDays) || policy.defaultRetentionDays <= 0) {
      throw new ValidationError({
        message: `Invalid defaultRetentionDays '${policy.defaultRetentionDays}' in declarative pruning policy '${policy.id}'. It must be a positive finite number.`,
        userMessage: "Invalid pruning retention configuration",
        correlationId: `val_prune_retention_${policy.id}`,
      });
    }

    if (!IDENTIFIER_REGEX.test(policy.tableName)) {
      throw new ValidationError({
        message: `Invalid table name '${policy.tableName}' in declarative pruning policy '${policy.id}'. Only alphanumeric characters and underscores are permitted.`,
        userMessage: "Invalid table configuration",
        correlationId: `val_prune_table_${policy.id}`,
      });
    }

    if (!IDENTIFIER_REGEX.test(policy.timestampColumn)) {
      throw new ValidationError({
        message: `Invalid timestamp column '${policy.timestampColumn}' in declarative pruning policy '${policy.id}'. Only alphanumeric characters and underscores are permitted.`,
        userMessage: "Invalid column configuration",
        correlationId: `val_prune_col_${policy.id}`,
      });
    }

    if (policy.filterCondition) {
      if (!isSafePruningFilterCondition(policy.filterCondition)) {
        throw new ValidationError({
          message: `Unsafe filterCondition in pruning policy '${policy.id}'. Use a single column comparison with a literal value.`,
          userMessage: "Invalid filter configuration",
          correlationId: `val_prune_filter_${policy.id}`,
        });
      }
    }

    // Snapshot the declarative input so a caller cannot mutate identifiers or
    // filter SQL after constructor validation.
    this.policy = Object.freeze({ ...policy });
    this.id = policy.id;
    this.displayName = policy.displayName;
    this.description =
      policy.description ??
      `Declarative table pruner for ${policy.tableName} (${policy.timestampColumn})`;
    this.defaultRetentionDays = policy.defaultRetentionDays;
  }

  async countEligible(connection: DatabaseConnection, cutoff: Date): Promise<number> {
    const filter = this.policy.filterCondition ? ` AND (${this.policy.filterCondition})` : "";
    const sql = `SELECT COUNT(*) as count FROM ${this.policy.tableName} WHERE ${this.policy.timestampColumn} <= ?${filter}`;
    const rows = await connection.query<{
      count?: number;
      cnt?: number;
      "COUNT(*)": number;
    }>(sql, [cutoff.toISOString()]);
    return Number(rows[0]?.count ?? rows[0]?.cnt ?? rows[0]?.["COUNT(*)"] ?? 0);
  }

  async prune(ctx: PruningContext): Promise<PruningResult> {
    validatePruningContext(ctx);
    const start = performance.now();
    const filter = this.policy.filterCondition ? ` AND (${this.policy.filterCondition})` : "";
    const deleteSql = `DELETE FROM ${this.policy.tableName} WHERE rowid IN (
      SELECT rowid FROM ${this.policy.tableName}
      WHERE ${this.policy.timestampColumn} <= ?${filter}
      LIMIT ?
    )`;

    let rowsPruned = 0;
    const isoCutoff = ctx.cutoffDate.toISOString();

    while (!ctx.signal?.aborted) {
      const result = await ctx.connection.execute(deleteSql, [isoCutoff, ctx.batchSize]);
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
