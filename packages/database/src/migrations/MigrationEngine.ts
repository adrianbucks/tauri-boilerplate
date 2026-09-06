import { getUtcIsoTimestamp, MigrationError } from "@platform/core";
import type { DatabaseConnection } from "../connection/DatabaseConnection.js";

export interface MigrationScript {
  version: number;
  name: string;
  sql: string;
  checksum: string;
  owner?: string | undefined;
}

interface AppliedMigration {
  version: number;
  checksum: string;
  owner: string;
}

export class MigrationEngine {
  private readonly db: DatabaseConnection;

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  async ensureMigrationTable(): Promise<void> {
    const sql = `
      CREATE TABLE IF NOT EXISTS core_migrations (
        owner TEXT NOT NULL,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        checksum TEXT NOT NULL,
        PRIMARY KEY (owner, version)
      );
    `;
    await this.db.execute(sql);
  }

  async getAppliedVersions(): Promise<number[]> {
    await this.ensureMigrationTable();
    const rows = await this.db.query<{ version: number }>(
      "SELECT version FROM core_migrations WHERE owner = ? ORDER BY version ASC",
      ["platform"],
    );
    return rows.map((r) => r.version);
  }

  private async getAppliedMigrations(): Promise<AppliedMigration[]> {
    await this.ensureMigrationTable();
    return this.db.query<AppliedMigration>(
      "SELECT owner, version, checksum FROM core_migrations ORDER BY owner ASC, version ASC",
    );
  }

  async applyMigrations(
    migrations: readonly MigrationScript[],
  ): Promise<{ appliedCount: number }> {
    await this.ensureMigrationTable();
    const applied = await this.getAppliedMigrations();
    const appliedByIdentity = new Map(
      applied.map((migration) => [
        `${migration.owner}:${migration.version}`,
        migration.checksum,
      ]),
    );
    const sorted = [...migrations].sort(
      (a, b) =>
        (a.owner ?? "platform").localeCompare(b.owner ?? "platform") ||
        a.version - b.version,
    );
    let appliedCount = 0;

    for (const migration of sorted) {
      const owner = migration.owner ?? "platform";
      const identity = `${owner}:${migration.version}`;
      const appliedChecksum = appliedByIdentity.get(identity);
      if (appliedChecksum !== undefined) {
        if (appliedChecksum !== migration.checksum) {
          throw new MigrationError({
            message: `Migration checksum mismatch for ${owner}:v${migration.version} ('${migration.name}')`,
            userMessage:
              "Database upgrade validation failed. Please reinstall the application or contact support.",
            correlationId: `mig_checksum_${owner}_v${migration.version}`,
            technicalDetails: `Expected checksum ${appliedChecksum}, received ${migration.checksum}`,
          });
        }
        continue;
      }

      await this.db.transaction(async (tx) => {
        try {
          await tx.execute(migration.sql);

          // Record migration
          const appliedAt = getUtcIsoTimestamp();
          await tx.execute(
            "INSERT INTO core_migrations (owner, version, name, applied_at, checksum) VALUES (?, ?, ?, ?, ?)",
            [
              owner,
              migration.version,
              migration.name,
              appliedAt,
              migration.checksum,
            ],
          );

          appliedCount++;
        } catch (err) {
          throw new MigrationError({
            message: `Migration ${owner}:v${migration.version} ('${migration.name}') failed: ${err instanceof Error ? err.message : String(err)}`,
            userMessage:
              "Database upgrade failed. Please restart the application.",
            correlationId: `mig_${owner}_v${migration.version}`,
            cause: err,
            technicalDetails: `Failed SQL in migration ${migration.name}`,
          });
        }
      });
    }

    return { appliedCount };
  }
}
