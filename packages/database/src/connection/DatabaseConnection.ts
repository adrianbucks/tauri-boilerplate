export interface QueryResult<T> {
  rows: T[];
  rowsAffected?: number | undefined;
}

export interface DatabaseHealth {
  healthy: boolean;
  dbName: string;
  walEnabled: boolean;
  foreignKeysEnabled: boolean;
  version: string;
  integrityCheck: string;
}

export interface TransactionClient {
  /**
   * **NOT SUPPORTED inside `db.transaction()` callbacks.**
   *
   * The Tauri IPC bridge uses a two-phase model: SQL operations are collected
   * first, then executed atomically on the Rust side. Reads inside a
   * transaction callback will throw a `DatabaseError` with code
   * `"DATABASE_ERROR"` because intermediate results cannot be returned
   * across the IPC boundary.
   *
   * **Always perform reads _before_ entering the transaction.**
   */
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  /**
   * Queue a write for atomic execution. Drivers that defer execution until the
   * callback completes cannot know the affected-row count at this point.
   * Transaction clients are scoped to their callback and reject operations
   * after it completes.
   */
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected?: number }>;
  /** Run nested work with savepoint semantics inside the active transaction. */
  savepoint<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T>;
}

export interface DatabaseConnection {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
  transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T>;
  healthCheck(): Promise<DatabaseHealth>;
  close(): Promise<void>;
}
