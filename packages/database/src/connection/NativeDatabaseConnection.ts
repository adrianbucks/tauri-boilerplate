import { DatabaseError, generateCorrelationId } from "@platform/core";
import type {
  DatabaseConnection,
  DatabaseHealth,
  TransactionClient,
} from "./DatabaseConnection.js";

// Tauri invoke types (defined locally to avoid dependency)
type InvokeArgs = Record<string, unknown>;

interface NativeQueryRequest extends Record<string, unknown> {
  sql: string;
  params?: unknown[];
}

interface NativeQueryResponse<T> {
  rows: T[];
}

interface NativeExecuteResponse {
  rows_affected: number;
}

interface NativeTransactionRequest extends Record<string, unknown> {
  operations: Array<{
    type: "query" | "execute";
    sql: string;
    params?: unknown[];
  }>;
}

/**
 * NativeDatabaseConnection bridges TypeScript to the Rust DurableDatabase
 * via Tauri commands. This provides persistent, file-backed SQLite storage
 * with WAL mode, foreign key enforcement, and transaction support.
 */
export class NativeDatabaseConnection implements DatabaseConnection {
  private isInitialised = false;
  private readonly invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;

  constructor(invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>) {
    this.invoke = invoke;
  }

  async init(): Promise<void> {
    if (this.isInitialised) return;
    try {
      // Verify native database is accessible by checking health
      await this.healthCheck();
      this.isInitialised = true;
    } catch (err) {
      throw new DatabaseError({
        message: `Failed to initialize native database connection: ${err instanceof Error ? err.message : String(err)}`,
        userMessage: "Failed to connect to local database",
        correlationId: generateCorrelationId("db-init"),
        cause: err,
      });
    }
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.init();
    try {
      const response = (await this.invoke("db_query", {
        sql,
        params,
      })) as NativeQueryResponse<T>;
      return response.rows;
    } catch (err) {
      throw new DatabaseError({
        message: `Database query failed: ${err instanceof Error ? err.message : String(err)}`,
        userMessage: "Failed to retrieve data",
        correlationId: generateCorrelationId("db-query"),
        cause: err,
        technicalDetails: `SQL: ${sql}`,
      });
    }
  }

  async execute(sql: string, params: unknown[] = []): Promise<{ rowsAffected: number }> {
    await this.init();
    try {
      const response = (await this.invoke("db_execute", {
        sql,
        params,
      })) as NativeExecuteResponse;
      return { rowsAffected: response.rows_affected };
    } catch (err) {
      throw new DatabaseError({
        message: `Database execute failed: ${err instanceof Error ? err.message : String(err)}`,
        userMessage: "Failed to execute database operation",
        correlationId: generateCorrelationId("db-exec"),
        cause: err,
        technicalDetails: `SQL: ${sql}`,
      });
    }
  }

  async transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    await this.init();

    // The Tauri IPC bridge uses a two-phase model: SQL operations are collected
    // during fn() and then executed atomically on the Rust side. Reads inside
    // the callback cannot return real data across the IPC boundary.
    // → Perform all reads BEFORE calling db.transaction().
    const operations: Array<{
      type: "query" | "execute";
      sql: string;
      params?: unknown[];
    }> = [];

    const txClient: TransactionClient = {
      query: async (_sql: string, _params: unknown[] = []) => {
        // Reads inside a transaction are not supported by the Tauri IPC bridge.
        // All reads must be performed outside the transaction boundary.
        throw new DatabaseError({
          message:
            "db.transaction(): query() is not supported inside a transaction callback. " +
            "The Tauri IPC bridge collects operations and executes them atomically on the " +
            "Rust side — intermediate reads cannot be returned across the IPC boundary. " +
            "Perform all reads before calling db.transaction().",
          userMessage: "A database read was attempted inside a write transaction.",
          correlationId: generateCorrelationId("db-tx-read"),
          technicalDetails: `SQL attempted: ${_sql}`,
        });
      },
      execute: async (sql: string, params: unknown[] = []) => {
        operations.push({ type: "execute", sql, params });
        return { rowsAffected: 0 };
      },
    };

    try {
      // Run the function to collect write operations
      const result = await fn(txClient);

      // Execute all collected operations atomically on the native side
      await this.invoke("db_transaction", {
        operations,
      });

      return result;
    } catch (error) {
      // Re-throw DatabaseErrors (e.g. the query() guard) as-is
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError({
        message: `Database transaction failed: ${error instanceof Error ? error.message : String(error)}`,
        userMessage: "Failed to execute database transaction",
        correlationId: generateCorrelationId("db-tx"),
        cause: error,
      });
    }
  }

  async healthCheck(): Promise<DatabaseHealth> {
    try {
      const health = (await this.invoke("get_database_health")) as {
        db_path: string;
        sqlite_version: string;
        journal_mode: string;
        foreign_keys_enabled: boolean;
        integrity_check: string;
      };

      return {
        healthy: health.integrity_check === "ok",
        dbName: health.db_path,
        walEnabled: health.journal_mode === "wal",
        foreignKeysEnabled: health.foreign_keys_enabled,
        version: health.sqlite_version,
        integrityCheck: health.integrity_check,
      };
    } catch (err) {
      return {
        healthy: false,
        dbName: "unknown",
        walEnabled: false,
        foreignKeysEnabled: false,
        version: "unknown",
        integrityCheck: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async close(): Promise<void> {
    // Native database lifecycle is managed by Tauri, no explicit close needed
    this.isInitialised = false;
  }
}
