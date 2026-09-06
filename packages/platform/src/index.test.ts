import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { Platform } from "./index.js";
import type { FeatureManifest } from "@platform/feature-system";

describe("@platform/platform", () => {
  let db: MemoryDatabaseConnection;
  let platform: Platform;

  const sampleManifest: FeatureManifest = {
    id: "sample-feature",
    name: "Sample Feature",
    version: "1.0.0",
    dependencies: [],
    permissions: [{ name: "sample.read", description: "Read sample records" }],
    migrations: [
      {
        version: 1,
        name: "create_sample_table",
        sql: "CREATE TABLE IF NOT EXISTS sample_table (id TEXT PRIMARY KEY, value TEXT);",
        checksum: "chk_sample_01",
      },
    ],
    syncPolicies: [
      {
        entityType: "sample_table",
        namespacePattern:
          "{application}/{organisation}/{syncGroup}/sample/records",
        conflictPolicy: { strategy: "lww" },
        syncable: true,
      },
    ],
  };

  beforeEach(async () => {
    db = new MemoryDatabaseConnection(":memory:");
    await db.init();

    platform = new Platform({
      db,
      config: {
        applicationId: "test-app",
      },
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it("registers feature, applies migrations upon init, and configures conflict policies", async () => {
    platform.registerFeature({ manifest: sampleManifest });

    expect(platform.getRegisteredFeatures()).toHaveLength(1);
    expect(platform.getRegisteredFeatures()[0]?.id).toBe("sample-feature");

    // Init platform & apply migrations
    await platform.init();

    // Verify table created
    const rows = await db.query(
      'SELECT name FROM sqlite_master WHERE type="table" AND name="sample_table"',
    );
    expect(rows).toHaveLength(1);

    const coreRows = await db.query<{ name: string }>(
      'SELECT name FROM sqlite_master WHERE type="table" AND name IN ("core_organisations", "core_audit_events") ORDER BY name',
    );
    expect(coreRows.map((row) => row.name)).toEqual([
      "core_audit_events",
      "core_organisations",
    ]);

    const appliedMigrations = await db.query<{
      owner: string;
      version: number;
    }>("SELECT owner, version FROM core_migrations ORDER BY rowid");
    expect(appliedMigrations).toEqual([
      { owner: "platform", version: 1 },
      { owner: "platform", version: 2 },
      { owner: "platform", version: 3 },
      { owner: "feature.sample-feature", version: 1 },
    ]);

    // Verify conflict policy registered
    const policy = platform.conflicts.getPolicy("sample_table");
    expect(policy.strategy).toBe("lww");
  });
});
