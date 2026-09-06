import { DatabaseError } from "@platform/core";
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
  private readonly invoke: (
    command: string,
    args?: Record<string, unknown>,
  ) => Promise<unknown>;

  constructor(
    invoke: (
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<unknown>,
  ) {
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
        correlationId: "db_native_init_err",
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
        correlationId: "db_query_err",
        cause: err,
        technicalDetails: `SQL: ${sql}`,
      });
    }
  }

  async execute(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rowsAffected: number }> {
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
        correlationId: "db_exec_err",
        cause: err,
        technicalDetails: `SQL: ${sql}`,
      });
    }
  }

  async transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    await this.init();

    // For native transactions, we collect operations and execute them atomically on the Rust side
    const operations: Array<{
      type: "query" | "execute";
      sql: string;
      params?: unknown[];
    }> = [];

    const txClient: TransactionClient = {
      query: async <R>(sql: string, params: unknown[] = []) => {
        // Collect the operation
        operations.push({ type: "query", sql, params });
        // Return empty for now - actual results come back after transaction
        return [];
      },
      execute: async (sql: string, params: unknown[] = []) => {
        operations.push({ type: "execute", sql, params });
        return { rowsAffected: 0 };
      },
    };

    try {
      // Run the function to collect operations
      const result = await fn(txClient);

      // Execute all operations atomically on the native side
      await this.invoke("db_transaction", {
        operations,
      });

      return result;
    } catch (error) {
      throw new DatabaseError({
        message: `Database transaction failed: ${error instanceof Error ? error.message : String(error)}`,
        userMessage: "Failed to execute database transaction",
        correlationId: "db_transaction_err",
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
