import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { SyncError, ValidationError } from "@platform/core";
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
        namespacePattern: "{application}/{organisation}/{syncGroup}/sample/records",
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
    expect(coreRows.map((row) => row.name)).toEqual(["core_audit_events", "core_organisations"]);

    const appliedMigrations = await db.query<{
      owner: string;
      version: number;
    }>("SELECT owner, version FROM core_migrations ORDER BY rowid");
    expect(appliedMigrations).toEqual([
      { owner: "platform", version: 1 },
      { owner: "platform", version: 2 },
      { owner: "platform", version: 3 },
      { owner: "platform", version: 4 },
      { owner: "platform", version: 5 },
      { owner: "platform", version: 6 },
      { owner: "platform", version: 7 },
      { owner: "platform", version: 8 },
      { owner: "feature.sample-feature", version: 1 },
    ]);

    const jitterColumn = await db.query<{ name: string }>(
      "PRAGMA table_info(core_background_tasks)",
    );
    expect(jitterColumn.some((column) => column.name === "retry_jitter")).toBe(true);

    const envelopeColumn = await db.query<{ name: string }>("PRAGMA table_info(core_sync_outbox)");
    expect(envelopeColumn.some((column) => column.name === "envelope_json")).toBe(true);

    // Verify conflict policy registered
    const policy = platform.conflicts.getPolicy("sample_table");
    expect(policy.strategy).toBe("lww");
  });

  it("shares one initialization run across concurrent callers", async () => {
    platform.registerFeature({ manifest: sampleManifest });

    await Promise.all([platform.init(), platform.init(), platform.init()]);

    const featureMigrations = await db.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM core_migrations WHERE owner = ?",
      ["feature.sample-feature"],
    );
    expect(featureMigrations[0]?.count).toBe(1);
  });

  it("rejects feature registration after initialization starts", async () => {
    await platform.init();

    expect(() => platform.registerFeature({ manifest: sampleManifest })).toThrow(ValidationError);
    expect(platform.getRegisteredFeatures()).toHaveLength(0);
  });

  it("adds an explicit local-device marker when upgrading the device schema", async () => {
    await db.execute(`
      CREATE TABLE core_devices (
        id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        created_by TEXT, updated_by TEXT, user_id TEXT, device_id TEXT NOT NULL UNIQUE,
        public_key TEXT NOT NULL, platform TEXT NOT NULL, application_id TEXT NOT NULL,
        status TEXT NOT NULL, registered_at TEXT NOT NULL, last_seen_at TEXT
      )
    `);
    await db.execute(
      "INSERT INTO core_devices (id, created_at, updated_at, device_id, public_key, platform, application_id, status, registered_at) VALUES ('d1', 'now', 'now', 'dev_existing_local', 'pub', 'linux', 'app', 'ACTIVE', 'now')",
    );

    await platform.init();

    const rows = await db.query<{ is_local: number }>(
      "SELECT is_local FROM core_devices WHERE device_id = ?",
      ["dev_existing_local"],
    );
    expect(rows[0]?.is_local).toBe(0);
  });

  it("applies feature migrations in dependency order regardless of feature IDs", async () => {
    platform.registerFeature({
      manifest: {
        id: "z-base",
        name: "Base",
        version: "1.0.0",
        dependencies: [],
        permissions: [],
        migrations: [
          {
            version: 1,
            name: "create_base_table",
            sql: "CREATE TABLE base_records (id TEXT PRIMARY KEY);",
            checksum: "chk_base_1",
          },
        ],
      },
    });
    platform.registerFeature({
      manifest: {
        id: "a-dependent",
        name: "Dependent",
        version: "1.0.0",
        dependencies: ["z-base"],
        permissions: [],
        migrations: [
          {
            version: 1,
            name: "index_base_table",
            sql: "CREATE INDEX idx_base_records_id ON base_records (id);",
            checksum: "chk_dependent_1",
          },
        ],
      },
    });

    await platform.init();
    const index = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
      ["idx_base_records_id"],
    );
    expect(index).toHaveLength(1);
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
    expect(platform.maintenanceRegistry.hasHandler("feature.prunable_logs")).toBe(true);

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

  it("keeps feature and pruning registries unchanged when a pruning policy conflicts", () => {
    const featureWithConflictingPolicies: FeatureManifest = {
      id: "atomic-pruning-feature",
      name: "Atomic Pruning Feature",
      version: "1.0.0",
      dependencies: [],
      permissions: [],
      migrations: [],
      pruningPolicies: [
        {
          id: "feature.should_not_register",
          displayName: "Valid First Policy",
          tableName: "records",
          timestampColumn: "created_at",
          defaultRetentionDays: 30,
        },
        {
          id: "core.sync.outbox",
          displayName: "Conflicts with a core handler",
          tableName: "records",
          timestampColumn: "created_at",
          defaultRetentionDays: 30,
        },
      ],
    };

    expect(() => platform.registerFeature({ manifest: featureWithConflictingPolicies })).toThrow(
      "already registered or duplicated",
    );
    expect(platform.getRegisteredFeatures()).toEqual([]);
    expect(platform.maintenanceRegistry.hasHandler("feature.should_not_register")).toBe(false);
  });

  it("rejects duplicate sync entity policies without replacing the registered policy", () => {
    platform.registerFeature({ manifest: sampleManifest });
    const conflictingFeature: FeatureManifest = {
      id: "conflicting-sync-feature",
      name: "Conflicting Sync Feature",
      version: "1.0.0",
      dependencies: [],
      permissions: [],
      migrations: [],
      syncPolicies: [
        {
          entityType: "sample_table",
          namespacePattern: "{application}/{organisation}/{syncGroup}/other",
          conflictPolicy: { strategy: "append-only" },
          syncable: true,
        },
      ],
    };

    expect(() => platform.registerFeature({ manifest: conflictingFeature })).toThrow(
      "already registered or duplicated",
    );
    expect(platform.getRegisteredFeatures().map((feature) => feature.id)).toEqual([
      "sample-feature",
    ]);
    expect(platform.conflicts.getPolicy("sample_table").strategy).toBe("lww");
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
