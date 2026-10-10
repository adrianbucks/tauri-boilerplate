import { getUtcIsoTimestamp, MigrationError } from "@platform/core";
import type { DatabaseConnection } from "../connection/DatabaseConnection.js";
import { splitSqlScript } from "./SqlScript.js";

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

  async applyMigrations(migrations: readonly MigrationScript[]): Promise<{ appliedCount: number }> {
    const identities = new Set<string>();
    const versionsByOwner = new Map<string, number[]>();
    const statementsByIdentity = new Map<string, string[]>();
    for (const migration of migrations) {
      if (!migration || typeof migration !== "object") {
        throw new MigrationError({
          message: "Migration definition must be an object",
          userMessage: "Database upgrade configuration is invalid",
          correlationId: "mig_invalid_definition",
        });
      }
      const owner = migration.owner ?? "platform";
      if (
        !Number.isSafeInteger(migration.version) ||
        migration.version <= 0 ||
        typeof owner !== "string" ||
        !owner.trim() ||
        typeof migration.name !== "string" ||
        !migration.name.trim() ||
        typeof migration.checksum !== "string" ||
        !migration.checksum.trim() ||
        typeof migration.sql !== "string" ||
        !migration.sql.trim()
      ) {
        throw new MigrationError({
          message:
            "Migration definitions require a positive version and non-empty owner, name, checksum, and SQL",
          userMessage: "Database upgrade configuration is invalid",
          correlationId: "mig_invalid_definition",
        });
      }

      const identity = `${owner}:${migration.version}`;
      if (identities.has(identity)) {
        throw new MigrationError({
          message: `Duplicate migration identity '${identity}' in supplied migration set`,
          userMessage: "Database upgrade configuration contains duplicate migrations",
          correlationId: `mig_duplicate_${owner}_v${migration.version}`,
        });
      }
      identities.add(identity);
      const statements = splitSqlScript(migration.sql);
      if (statements.length === 0) {
        throw new MigrationError({
          message: `Migration '${identity}' does not contain an executable SQL statement`,
          userMessage: "Database upgrade configuration is invalid",
          correlationId: `mig_empty_sql_${owner}_v${migration.version}`,
        });
      }
      statementsByIdentity.set(identity, statements);
      const ownerVersions = versionsByOwner.get(owner) ?? [];
      ownerVersions.push(migration.version);
      versionsByOwner.set(owner, ownerVersions);
    }

    for (const [owner, versions] of versionsByOwner) {
      versions.sort((a, b) => a - b);
      for (const [index, version] of versions.entries()) {
        const expectedVersion = index + 1;
        if (version !== expectedVersion) {
          throw new MigrationError({
            message: `Migration sequence for owner '${owner}' is missing version ${expectedVersion}`,
            userMessage: "Database upgrade configuration is missing a migration",
            correlationId: `mig_sequence_${owner}_v${expectedVersion}`,
          });
        }
      }
    }

    await this.ensureMigrationTable();
    const applied = await this.getAppliedMigrations();
    const appliedByIdentity = new Map(
      applied.map((migration) => [`${migration.owner}:${migration.version}`, migration.checksum]),
    );
    const suppliedOwners = new Set(migrations.map((migration) => migration.owner ?? "platform"));
    const suppliedIdentities = new Set(
      migrations.map((migration) => `${migration.owner ?? "platform"}:${migration.version}`),
    );
    const removedAppliedMigration = applied.find(
      (migration) =>
        suppliedOwners.has(migration.owner) &&
        !suppliedIdentities.has(`${migration.owner}:${migration.version}`),
    );
    if (removedAppliedMigration) {
      throw new MigrationError({
        message: `Applied migration '${removedAppliedMigration.owner}:v${removedAppliedMigration.version}' is missing from the supplied migration set`,
        userMessage:
          "Database migration history does not match this application version. Please contact support.",
        correlationId: `mig_missing_${removedAppliedMigration.owner}_v${removedAppliedMigration.version}`,
      });
    }
    const sorted = [...migrations].sort(
      (a, b) =>
        (a.owner ?? "platform").localeCompare(b.owner ?? "platform") || a.version - b.version,
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
          for (const statement of statementsByIdentity.get(identity) ?? []) {
            await tx.execute(statement);
          }

          // Record migration
          const appliedAt = getUtcIsoTimestamp();
          await tx.execute(
            "INSERT INTO core_migrations (owner, version, name, applied_at, checksum) VALUES (?, ?, ?, ?, ?)",
            [owner, migration.version, migration.name, appliedAt, migration.checksum],
          );

          appliedCount++;
        } catch (err) {
          throw new MigrationError({
            message: `Migration ${owner}:v${migration.version} ('${migration.name}') failed: ${err instanceof Error ? err.message : String(err)}`,
            userMessage: "Database upgrade failed. Please restart the application.",
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
