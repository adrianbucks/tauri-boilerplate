import initSqlJs, { type Database as SqlJsDatabase, type SqlValue } from "sql.js";
import { DatabaseError } from "@platform/core";
import type {
  DatabaseConnection,
  DatabaseHealth,
  TransactionClient,
} from "./DatabaseConnection.js";

export class MemoryDatabaseConnection implements DatabaseConnection {
  private db: SqlJsDatabase | null = null;
  private readonly dbPath: string;
  private isInitialised = false;

  constructor(dbPath: string = ":memory:") {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    if (this.isInitialised && this.db) return;
    try {
      const SQL = await initSqlJs();
      this.db = new SQL.Database();
      // SQLite disables foreign-key enforcement by default. Match the native
      // driver's invariant so memory-backed tests exercise real constraints.
      this.db.run("PRAGMA foreign_keys = ON;");
      this.isInitialised = true;
    } catch (err) {
      throw new DatabaseError({
        message: `Failed to initialize SQLite Wasm database: ${err instanceof Error ? err.message : String(err)}`,
        userMessage: "Failed to start local database",
        correlationId: "db_init_err",
        cause: err,
      });
    }
  }

  private getDb(): SqlJsDatabase {
    if (!this.db || !this.isInitialised) {
      throw new DatabaseError({
        message: "Database connection is not initialized or is closed",
        userMessage: "Database is not available",
        correlationId: "db_closed",
      });
    }
    return this.db;
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.init();
    const release = await this.acquireOperationLock();
    try {
      const db = this.getDb();
      const stmt = db.prepare(sql);
      try {
        if (params.length > 0) {
          stmt.bind(params as SqlValue[]);
        }

        const results: T[] = [];
        while (stmt.step()) {
          const row = stmt.getAsObject() as T;
          results.push(row);
        }
        return results;
      } finally {
        stmt.free();
      }
    } catch (err) {
      throw new DatabaseError({
        message: `Database query failed: ${err instanceof Error ? err.message : String(err)}`,
        userMessage: "Failed to retrieve data",
        correlationId: "db_query_err",
        cause: err,
        technicalDetails: `SQL: ${sql}`,
      });
    } finally {
      release();
    }
  }

  async execute(sql: string, params: unknown[] = []): Promise<{ rowsAffected: number }> {
    await this.init();
    const release = await this.acquireOperationLock();
    try {
      const db = this.getDb();
      if (params.length > 0) {
        db.run(sql, params as SqlValue[]);
      } else {
        db.run(sql);
      }
      const rowsAffected = db.getRowsModified();
      return { rowsAffected };
    } catch (err) {
      throw new DatabaseError({
        message: `Database execute failed: ${err instanceof Error ? err.message : String(err)}`,
        userMessage: "Failed to execute database operation",
        correlationId: "db_exec_err",
        cause: err,
        technicalDetails: `SQL: ${sql}`,
      });
    } finally {
      release();
    }
  }

  private transactionQueue: Promise<void> = Promise.resolve();
  private savepointCounter = 0;

  private async acquireOperationLock(): Promise<() => void> {
    const previousOperation = this.transactionQueue;
    let releaseOperation!: () => void;
    this.transactionQueue = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    await previousOperation;
    return releaseOperation;
  }

  async transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    await this.init();
    const releaseTransaction = await this.acquireOperationLock();

    try {
      const rawDb = this.getDb();
      rawDb.run("BEGIN TRANSACTION;");
      const txClient = this.createTransactionClient(rawDb);

      try {
        const result = await fn(txClient);
        txClient.close();
        rawDb.run("COMMIT;");
        return result;
      } catch (error) {
        txClient.close();
        try {
          rawDb.run("ROLLBACK;");
        } catch {
          // Preserve the original transaction error if rollback also fails.
        }
        throw error;
      }
    } finally {
      releaseTransaction();
    }
  }

  private createTransactionClient(rawDb: SqlJsDatabase): TransactionClient & { close: () => void } {
    let active = true;
    const assertActive = () => {
      if (!active) {
        throw new DatabaseError({
          message: "Transaction client is no longer active",
          userMessage: "The database transaction has already completed",
          correlationId: "db_tx_closed",
        });
      }
    };

    return {
      close: () => {
        active = false;
      },
      query: async <R>(sql: string, params: unknown[] = []) => {
        assertActive();
        const stmt = rawDb.prepare(sql);
        try {
          if (params.length > 0) {
            stmt.bind(params as SqlValue[]);
          }
          const results: R[] = [];
          while (stmt.step()) {
            results.push(stmt.getAsObject() as R);
          }
          return results;
        } finally {
          stmt.free();
        }
      },
      execute: async (sql: string, params: unknown[] = []) => {
        assertActive();
        if (params.length > 0) {
          rawDb.run(sql, params as SqlValue[]);
        } else {
          rawDb.run(sql);
        }
        return { rowsAffected: rawDb.getRowsModified() };
      },
      savepoint: async <R>(fn: (tx: TransactionClient) => Promise<R>) => {
        assertActive();
        const spName = `sp_${++this.savepointCounter}`;
        rawDb.run(`SAVEPOINT ${spName};`);
        const nestedClient = this.createTransactionClient(rawDb);
        try {
          const result = await fn(nestedClient);
          nestedClient.close();
          rawDb.run(`RELEASE SAVEPOINT ${spName};`);
          return result;
        } catch (error) {
          nestedClient.close();
          try {
            rawDb.run(`ROLLBACK TO SAVEPOINT ${spName};`);
            rawDb.run(`RELEASE SAVEPOINT ${spName};`);
          } catch {
            // Preserve the original savepoint error if rollback also fails.
          }
          throw error;
        }
      },
    };
  }

  async healthCheck(): Promise<DatabaseHealth> {
    await this.init();
    try {
      const db = this.getDb();
      const versionResult = db.exec("SELECT sqlite_version() AS version;");
      const version = versionResult[0]?.values[0]?.[0]
        ? String(versionResult[0].values[0][0])
        : "unknown";
      const journalModeResult = db.exec("PRAGMA journal_mode;");
      const journalMode = String(journalModeResult[0]?.values[0]?.[0] ?? "unknown");
      const foreignKeysResult = db.exec("PRAGMA foreign_keys;");
      const foreignKeysEnabled = Number(foreignKeysResult[0]?.values[0]?.[0] ?? 0) === 1;
      const integrityResult = db.exec("PRAGMA integrity_check;");
      const integrityCheck = String(integrityResult[0]?.values[0]?.[0] ?? "unknown");

      return {
        healthy: integrityCheck === "ok" && foreignKeysEnabled,
        dbName: this.dbPath,
        // sql.js runs an in-memory database and does not provide durable WAL.
        walEnabled: journalMode.toLowerCase() === "wal",
        foreignKeysEnabled,
        version,
        integrityCheck,
      };
    } catch (err) {
      return {
        healthy: false,
        dbName: this.dbPath,
        walEnabled: false,
        foreignKeysEnabled: false,
        version: "unknown",
        integrityCheck: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialised = false;
    }
  }
}
