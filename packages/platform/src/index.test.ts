import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { SyncError } from "@platform/core";
import { StorageMaintenanceWorker } from "@platform/tasks";
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
      { owner: "platform", version: 4 },
      { owner: "feature.sample-feature", version: 1 },
    ]);

    // Verify conflict policy registered
    const policy = platform.conflicts.getPolicy("sample_table");
    expect(policy.strategy).toBe("lww");
  });

  it("registers feature pruning policies and executes storage maintenance via runMaintenance", async () => {
    const featureWithPruning: FeatureManifest = {
      id: "prunable-feature",
      name: "Prunable Feature",
      version: "1.0.0",
      dependencies: [],
      permissions: [{ name: "prune.test", description: "Test permission" }],
      migrations: [
        {
          version: 1,
          name: "create_prunable_logs",
          sql: "CREATE TABLE IF NOT EXISTS prunable_logs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, level TEXT NOT NULL);",
          checksum: "chk_prunable_01",
        },
      ],
      pruningPolicies: [
        {
          id: "feature.prunable_logs",
          displayName: "Prunable Logs",
          tableName: "prunable_logs",
          timestampColumn: "created_at",
          defaultRetentionDays: 7,
          filterCondition: "level = 'DEBUG'",
        },
      ],
    };

    platform.registerFeature({ manifest: featureWithPruning });
    await platform.init();

    // Verify pruning policy registered
    expect(
      platform.maintenanceRegistry.hasHandler("feature.prunable_logs"),
    ).toBe(true);

    // Insert 1 old debug log and 1 recent debug log and 1 old error log
    const oldDate = new Date("2026-01-01T00:00:00Z").toISOString();
    const recentDate = new Date().toISOString();

    await db.execute(
      `INSERT INTO prunable_logs (id, created_at, level) VALUES
        ('log1', ?, 'DEBUG'),
        ('log2', ?, 'DEBUG'),
        ('log3', ?, 'ERROR');`,
      [oldDate, recentDate, oldDate],
    );

    const report = await platform.runMaintenance({ skipVacuum: false });
    expect(report.success).toBe(true);
    expect(report.vacuumExecuted).toBe(true);

    const remainingLogs = await db.query<{ id: string }>(
      "SELECT id FROM prunable_logs ORDER BY id",
    );
    expect(remainingLogs.map((l) => l.id)).toEqual(["log2", "log3"]);
  });

  it("guards sync access before configureSync() and allows access after (B-03)", async () => {
    expect(platform.isSyncConfigured()).toBe(false);
    expect(() => platform.sync).toThrow(SyncError);

    platform.configureSync({
      deviceId: "dev_123",
      organisationId: "org_abc",
    });

    expect(platform.isSyncConfigured()).toBe(true);
    expect(() => platform.sync).not.toThrow();
    expect(platform.sync).toBeDefined();
  });

  it("preserves registered maintenance task handlers when startTaskWorker() is called (B-04)", async () => {
    await platform.init();

    // Reconfigure and start task worker with custom options
    await platform.startTaskWorker({ pollIntervalMs: 50 });

    // Enqueue a storage maintenance task
    const claimedTask = await platform.tasks.enqueue({
      taskType: StorageMaintenanceWorker.TASK_TYPE,
      payload: { skipVacuum: true },
      organisationId: "org_test",
      correlationId: "corr_test",
    });

    // Wait a brief tick for the worker to poll and execute
    await new Promise((resolve) => setTimeout(resolve, 150));
    await platform.stopTaskWorker();

    // The maintenance task handler must still be registered, so it must not have been cancelled as unregistered
    const taskRecord = await platform.tasks.findById(claimedTask.id);
    expect(taskRecord?.state).not.toBe("CANCELLED");
  });
});
