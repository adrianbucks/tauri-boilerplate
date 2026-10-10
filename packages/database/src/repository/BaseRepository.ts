import { getUtcIsoTimestamp, generateCorrelationId, ValidationError } from "@platform/core";
import type { DatabaseConnection, TransactionClient } from "../connection/DatabaseConnection.js";

export const MAX_REPOSITORY_PAGE_SIZE = 1_000;

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

  protected getExecutor(tx?: TransactionClient): DatabaseConnection | TransactionClient {
    return tx ?? this.db;
  }

  async findById(id: string, tx?: TransactionClient): Promise<TRecord | null> {
    const executor = this.getExecutor(tx);
    const tableName = this.getSafeTableName();
    const sql = `SELECT * FROM ${tableName} WHERE id = ? LIMIT 1`;
    const rows = await executor.query<TRecord>(sql, [id]);
    return rows[0] ?? null;
  }

  async findAll(options?: FindOptions, tx?: TransactionClient): Promise<TRecord[]> {
    const executor = this.getExecutor(tx);
    if (
      options?.limit !== undefined &&
      (!Number.isSafeInteger(options.limit) ||
        options.limit < 0 ||
        options.limit > MAX_REPOSITORY_PAGE_SIZE)
    ) {
      throw new ValidationError({
        message: `Repository page size must be a non-negative safe integer no greater than ${MAX_REPOSITORY_PAGE_SIZE}`,
        userMessage: "The requested page size is invalid",
        correlationId: generateCorrelationId("repo-page-size"),
      });
    }
    if (
      options?.offset !== undefined &&
      (!Number.isSafeInteger(options.offset) || options.offset < 0)
    ) {
      throw new ValidationError({
        message: "Repository page offset must be a non-negative safe integer",
        userMessage: "The requested page offset is invalid",
        correlationId: generateCorrelationId("repo-page-offset"),
      });
    }
    if (options?.offset !== undefined && options.limit === undefined) {
      throw new ValidationError({
        message: "Repository page offset requires a page size",
        userMessage: "The requested page is invalid",
        correlationId: generateCorrelationId("repo-page-offset"),
      });
    }

    let sql = `SELECT * FROM ${this.getSafeTableName()}`;
    const params: unknown[] = [];
    const whereClauses: string[] = [];

    const shouldFilterDeleted =
      options?.excludeDeleted === true || (this.supportsSoftDelete && !options?.includeDeleted);

    if (shouldFilterDeleted) {
      whereClauses.push("deleted_at IS NULL");
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(" AND ")}`;
    }

    if (options?.orderBy) {
      const dir = options.orderDirection ?? "ASC";
      this.assertIdentifier(options.orderBy, "orderBy");
      if (dir !== "ASC" && dir !== "DESC") {
        throw new ValidationError({
          message: "Invalid orderDirection; expected ASC or DESC",
          userMessage: "The requested sort order is invalid",
          correlationId: generateCorrelationId("repo-order"),
        });
      }
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
    const tableName = this.getSafeTableName();
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      throw new ValidationError({
        message: "Repository insert requires a record object",
        userMessage: "The record could not be saved",
        correlationId: generateCorrelationId("repo-insert"),
      });
    }
    const keys = Object.keys(record);
    if (keys.length === 0) {
      throw new ValidationError({
        message: "Repository insert requires at least one record field",
        userMessage: "The record could not be saved",
        correlationId: generateCorrelationId("repo-insert"),
      });
    }
    const placeholders = keys.map(() => "?").join(", ");
    const columns = keys.map((key) => this.toSafeColumnName(key)).join(", ");
    this.assertUniqueColumnNames(keys);
    const values = Object.values(record);

    const sql = `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`;
    await executor.execute(sql, values);
    return record;
  }

  async update(id: string, updates: Partial<TRecord>, tx?: TransactionClient): Promise<void> {
    const executor = this.getExecutor(tx);
    const tableName = this.getSafeTableName();
    const sanitized = { ...updates };
    delete (sanitized as Record<string, unknown>)["id"];

    const keys = Object.keys(sanitized);
    if (keys.length === 0) return;

    this.assertUniqueColumnNames(keys);
    const setClauses = keys.map((key) => `${this.toSafeColumnName(key)} = ?`).join(", ");
    const values = [...Object.values(sanitized), id];

    const sql = `UPDATE ${tableName} SET ${setClauses} WHERE id = ?`;
    await executor.execute(sql, values);
  }

  async softDelete(id: string, deletedBy: string, tx?: TransactionClient): Promise<void> {
    if (!this.supportsSoftDelete) {
      throw new ValidationError({
        message: `Repository for '${this.tableName}' does not support soft deletion`,
        userMessage: "This record type does not support deletion",
        correlationId: generateCorrelationId("repo-soft-delete"),
      });
    }
    const executor = this.getExecutor(tx);
    const tableName = this.getSafeTableName();
    const now = getUtcIsoTimestamp();
    const opId = generateCorrelationId("del");
    const sql = `UPDATE ${tableName} SET deleted_at = ?, deleted_by = ?, delete_operation_id = ? WHERE id = ?`;
    await executor.execute(sql, [now, deletedBy, opId, id]);
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  private toSafeColumnName(name: string): string {
    const columnName = this.camelToSnake(name);
    this.assertIdentifier(columnName, "column name");
    return columnName;
  }

  private getSafeTableName(): string {
    this.assertIdentifier(this.tableName, "table name");
    return this.tableName;
  }

  private assertUniqueColumnNames(names: string[]): void {
    const columns = names.map((name) => this.toSafeColumnName(name));
    if (new Set(columns).size !== columns.length) {
      throw new ValidationError({
        message: "Repository record contains multiple fields for the same SQL column",
        userMessage: "The record contains conflicting fields",
        correlationId: generateCorrelationId("repo-column-collision"),
      });
    }
  }

  private assertIdentifier(identifier: string, label: string): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
      throw new ValidationError({
        message: `Invalid SQL ${label}`,
        userMessage: `The requested ${label} is invalid`,
        correlationId: generateCorrelationId("repo-identifier"),
      });
    }
  }
}
