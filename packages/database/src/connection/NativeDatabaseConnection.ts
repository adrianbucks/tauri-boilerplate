import { DatabaseError, generateCorrelationId } from "@platform/core";
import type {
  DatabaseConnection,
  DatabaseHealth,
  TransactionClient,
} from "./DatabaseConnection.js";

// Tauri invoke types (defined locally to avoid dependency)
type InvokeArgs = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface NativeQueryRequest extends Record<string, unknown> {
  sql: string;
  params?: unknown[];
}

interface NativeHealthResponse {
  db_path: string;
  sqlite_version: string;
  journal_mode: string;
  foreign_keys_enabled: boolean;
  integrity_check: string;
}

function isNativeHealthResponse(value: unknown): value is NativeHealthResponse {
  return (
    isRecord(value) &&
    typeof value.db_path === "string" &&
    typeof value.sqlite_version === "string" &&
    typeof value.journal_mode === "string" &&
    typeof value.foreign_keys_enabled === "boolean" &&
    typeof value.integrity_check === "string"
  );
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
      const health = await this.healthCheck();
      if (!health.healthy) {
        throw new Error(`Native database health check failed: ${health.integrityCheck}`);
      }
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
      const response = await this.invoke("db_query", {
        sql,
        params,
      });
      if (
        !isRecord(response) ||
        !Array.isArray(response.rows) ||
        !response.rows.every(isRecord)
      ) {
        throw new Error("Native database returned an invalid query response");
      }
      return response.rows as T[];
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
      const response = await this.invoke("db_execute", {
        sql,
        params,
      });
      if (
        !isRecord(response) ||
        typeof response.rows_affected !== "number" ||
        !Number.isSafeInteger(response.rows_affected) ||
        (response.rows_affected as number) < 0
      ) {
        throw new Error("Native database returned an invalid execute response");
      }
      return { rowsAffected: response.rows_affected as number };
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

    type TransactionOperation = NativeTransactionRequest["operations"][number];
    const createTransactionClient = (targetOperations: TransactionOperation[]) => {
      let isActive = true;
      const close = () => {
        isActive = false;
      };
      const assertActive = () => {
        if (!isActive) {
          throw new DatabaseError({
            message: "Transaction client is no longer active",
            userMessage: "The database transaction has already completed",
            correlationId: generateCorrelationId("db-tx-closed"),
          });
        }
      };
      const client: TransactionClient = {
        query: async (_sql: string, _params: unknown[] = []) => {
          assertActive();
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
          assertActive();
          targetOperations.push({ type: "execute", sql, params });
          return {};
        },
        savepoint: async <R>(fn: (tx: TransactionClient) => Promise<R>) => {
          assertActive();
          const nestedOperations: TransactionOperation[] = [];
          const nestedClient = createTransactionClient(nestedOperations);
          try {
            const result = await fn(nestedClient.client);
            nestedClient.close();
            targetOperations.push(...nestedOperations);
            return result;
          } catch (error) {
            nestedClient.close();
            throw error;
          }
        },
      };
      return { client, close };
    };
    const txClient = createTransactionClient(operations);

    try {
      // Run the function to collect write operations
      const result = await fn(txClient.client);
      txClient.close();

      // Execute all collected operations atomically on the native side
      await this.invoke("db_transaction", {
        operations,
      });

      return result;
    } catch (error) {
      txClient.close();
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
      const response = await this.invoke("get_database_health");
      if (!isNativeHealthResponse(response)) {
        throw new Error("Native database returned an invalid health response");
      }
      const health = response;

      return {
        healthy: health.integrity_check === "ok" && health.foreign_keys_enabled,
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
