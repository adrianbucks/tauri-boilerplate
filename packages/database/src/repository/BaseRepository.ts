import { getUtcIsoTimestamp, generateCorrelationId } from "@platform/core";
import type {
  DatabaseConnection,
  TransactionClient,
} from "../connection/DatabaseConnection.js";

export interface FindOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: "ASC" | "DESC";
  /** When true and the repository supports soft-delete, rows with a non-null deleted_at column are included. */
  includeDeleted?: boolean;
  /** When true, explicitly filters by `deleted_at IS NULL`. */
  excludeDeleted?: boolean;
}

export abstract class BaseRepository<TRecord extends { id: string }> {
  protected readonly db: DatabaseConnection;
  protected abstract readonly tableName: string;
  protected readonly supportsSoftDelete: boolean = false;

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  protected getExecutor(
    tx?: TransactionClient,
  ): DatabaseConnection | TransactionClient {
    return tx ?? this.db;
  }

  async findById(id: string, tx?: TransactionClient): Promise<TRecord | null> {
    const executor = this.getExecutor(tx);
    const sql = `SELECT * FROM ${this.tableName} WHERE id = ? LIMIT 1`;
    const rows = await executor.query<TRecord>(sql, [id]);
    return rows[0] ?? null;
  }

  async findAll(
    options?: FindOptions,
    tx?: TransactionClient,
  ): Promise<TRecord[]> {
    const executor = this.getExecutor(tx);
    let sql = `SELECT * FROM ${this.tableName}`;
    const params: unknown[] = [];
    const whereClauses: string[] = [];

    const shouldFilterDeleted =
      options?.excludeDeleted === true ||
      (this.supportsSoftDelete && !options?.includeDeleted);

    if (shouldFilterDeleted) {
      whereClauses.push("deleted_at IS NULL");
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(" AND ")}`;
    }

    if (options?.orderBy) {
      const dir = options.orderDirection ?? "ASC";
      sql += ` ORDER BY ${options.orderBy} ${dir}`;
    }

    if (typeof options?.limit === "number") {
      sql += ` LIMIT ?`;
      params.push(options.limit);

      if (typeof options?.offset === "number") {
        sql += ` OFFSET ?`;
        params.push(options.offset);
      }
    }

    return executor.query<TRecord>(sql, params);
  }

  async insert(record: TRecord, tx?: TransactionClient): Promise<TRecord> {
    const executor = this.getExecutor(tx);
    const keys = Object.keys(record);
    const placeholders = keys.map(() => "?").join(", ");
    const columns = keys.map((k) => this.camelToSnake(k)).join(", ");
    const values = Object.values(record);

    const sql = `INSERT INTO ${this.tableName} (${columns}) VALUES (${placeholders})`;
    await executor.execute(sql, values);
    return record;
  }

  async update(
    id: string,
    updates: Partial<TRecord>,
    tx?: TransactionClient,
  ): Promise<void> {
    const executor = this.getExecutor(tx);
    const sanitized = { ...updates };
    delete (sanitized as Record<string, unknown>)["id"];

    const keys = Object.keys(sanitized);
    if (keys.length === 0) return;

    const setClauses = keys
      .map((k) => `${this.camelToSnake(k)} = ?`)
      .join(", ");
    const values = [...Object.values(sanitized), id];

    const sql = `UPDATE ${this.tableName} SET ${setClauses} WHERE id = ?`;
    await executor.execute(sql, values);
  }

  async softDelete(
    id: string,
    deletedBy: string,
    tx?: TransactionClient,
  ): Promise<void> {
    const executor = this.getExecutor(tx);
    const now = getUtcIsoTimestamp();
    const opId = generateCorrelationId("del");
    const sql = `UPDATE ${this.tableName} SET deleted_at = ?, deleted_by = ?, delete_operation_id = ? WHERE id = ?`;
    await executor.execute(sql, [now, deletedBy, opId, id]);
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }
}
