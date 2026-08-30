import { getUtcIsoTimestamp, MigrationError } from "@platform/core";
import type { DatabaseConnection } from "../connection/DatabaseConnection.js";

export interface MigrationScript {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export class MigrationEngine {
  private readonly db: DatabaseConnection;

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  async ensureMigrationTable(): Promise<void> {
    const sql = `
      CREATE TABLE IF NOT EXISTS core_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        checksum TEXT NOT NULL
      );
    `;
    await this.db.execute(sql);
  }

  async getAppliedVersions(): Promise<number[]> {
    await this.ensureMigrationTable();
    const rows = await this.db.query<{ version: number }>(
      "SELECT version FROM core_migrations ORDER BY version ASC",
    );
    return rows.map((r) => r.version);
  }

  async applyMigrations(
    migrations: readonly MigrationScript[],
  ): Promise<{ appliedCount: number }> {
    await this.ensureMigrationTable();
    const applied = new Set(await this.getAppliedVersions());
    const sorted = [...migrations].sort((a, b) => a.version - b.version);
    let appliedCount = 0;

    for (const migration of sorted) {
      if (applied.has(migration.version)) {
        continue;
      }

      await this.db.transaction(async (tx) => {
        try {
          // Execute migration statements
          const statements = migration.sql
            .split(";")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);

          for (const stmt of statements) {
            await tx.execute(stmt);
          }

          // Record migration
          const appliedAt = getUtcIsoTimestamp();
          await tx.execute(
            "INSERT INTO core_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)",
            [migration.version, migration.name, appliedAt, migration.checksum],
          );

          appliedCount++;
        } catch (err) {
          throw new MigrationError({
            message: `Migration v${migration.version} ('${migration.name}') failed: ${err instanceof Error ? err.message : String(err)}`,
            userMessage:
              "Database upgrade failed. Please restart the application.",
            correlationId: `mig_v${migration.version}`,
            cause: err,
            technicalDetails: `Failed SQL in migration ${migration.name}`,
          });
        }
      });
    }

    return { appliedCount };
  }
}
