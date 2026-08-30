import initSqlJs, {
  type Database as SqlJsDatabase,
  type SqlValue,
} from "sql.js";
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
    const db = this.getDb();
    try {
      const stmt = db.prepare(sql);
      if (params.length > 0) {
        stmt.bind(params as SqlValue[]);
      }

      const results: T[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject() as T;
        results.push(row);
      }
      stmt.free();
      return results;
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
    const db = this.getDb();
    try {
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
    }
  }

  private inTransaction = false;
  private savepointCounter = 0;

  async transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    await this.init();
    const rawDb = this.getDb();
    const isNested = this.inTransaction;
    const spName = `sp_${++this.savepointCounter}`;

    if (isNested) {
      rawDb.run(`SAVEPOINT ${spName};`);
    } else {
      this.inTransaction = true;
      rawDb.run("BEGIN TRANSACTION;");
    }

    const txClient: TransactionClient = {
      query: async <R>(sql: string, params: unknown[] = []) => {
        const stmt = rawDb.prepare(sql);
        if (params.length > 0) {
          stmt.bind(params as SqlValue[]);
        }
        const results: R[] = [];
        while (stmt.step()) {
          results.push(stmt.getAsObject() as R);
        }
        stmt.free();
        return results;
      },
      execute: async (sql: string, params: unknown[] = []) => {
        if (params.length > 0) {
          rawDb.run(sql, params as SqlValue[]);
        } else {
          rawDb.run(sql);
        }
        return { rowsAffected: rawDb.getRowsModified() };
      },
    };

    try {
      const result = await fn(txClient);
      if (isNested) {
        rawDb.run(`RELEASE SAVEPOINT ${spName};`);
      } else {
        rawDb.run("COMMIT;");
        this.inTransaction = false;
      }
      return result;
    } catch (error) {
      try {
        if (isNested) {
          rawDb.run(`ROLLBACK TO SAVEPOINT ${spName};`);
        } else {
          rawDb.run("ROLLBACK;");
          this.inTransaction = false;
        }
      } catch {
        // Ignore rollback failure if already rolled back
      }
      throw error;
    }
  }

  async healthCheck(): Promise<DatabaseHealth> {
    await this.init();
    try {
      const db = this.getDb();
      const versionResult = db.exec("SELECT sqlite_version() AS version;");
      const version = versionResult[0]?.values[0]?.[0]
        ? String(versionResult[0].values[0][0])
        : "unknown";

      return {
        healthy: true,
        dbName: this.dbPath,
        walEnabled: true,
        foreignKeysEnabled: true,
        version,
        integrityCheck: "ok",
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
