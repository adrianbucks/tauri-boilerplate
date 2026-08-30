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
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
}

export interface DatabaseConnection {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
  transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T>;
  healthCheck(): Promise<DatabaseHealth>;
  close(): Promise<void>;
}
