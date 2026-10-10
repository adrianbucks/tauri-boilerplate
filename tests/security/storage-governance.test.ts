import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryDatabaseConnection } from "@platform/database";
import { Platform } from "@platform/platform";
import { ManifestValidator, type FeatureManifest } from "@platform/feature-system";
import {
  MaintenanceOrchestrator,
  MaintenanceRegistry,
  DeclarativeTablePruner,
  SyncOutboxPruner,
  SyncInboxPruner,
  BackgroundTasksPruner,
  ReplicatedTombstonePruner,
} from "@platform/maintenance";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../");

// ---------------------------------------------------------------------------
// Security & Governance Regression Suite — Storage Compaction (WP-022 / Gate G-014)
// ---------------------------------------------------------------------------

describe("Security Regression Suite — Storage Governance & Compaction (Gate G-014)", () => {
  let db: MemoryDatabaseConnection;
  let orchestrator: MaintenanceOrchestrator;
  let registry: MaintenanceRegistry;

  beforeEach(async () => {
    db = new MemoryDatabaseConnection(":memory:");
    await db.init();

    await db.execute(`
      CREATE TABLE core_sync_outbox (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        envelope_id TEXT NOT NULL UNIQUE,
        organisation_id TEXT NOT NULL,
        sync_group_id TEXT NOT NULL,
        feature_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        author_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        logical_timestamp TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        protocol_version INTEGER NOT NULL,
        signer_public_key TEXT NOT NULL,
        signature TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        sent_at TEXT
      );

      CREATE TABLE core_sync_inbox (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        envelope_id TEXT NOT NULL UNIQUE,
        organisation_id TEXT NOT NULL,
        from_device_id TEXT NOT NULL,
        sync_group_id TEXT NOT NULL,
        feature_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        logical_timestamp TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        protocol_version INTEGER NOT NULL,
        signer_public_key TEXT NOT NULL,
        signature TEXT NOT NULL,
        verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
        apply_status TEXT NOT NULL DEFAULT 'PENDING',
        applied_at TEXT,
        conflict_id TEXT
      );

      CREATE TABLE core_background_tasks (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        task_type TEXT NOT NULL,
        unique_key TEXT,
        organisation_id TEXT NOT NULL,
        user_id TEXT,
        payload_json TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'PENDING',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        retry_delay_ms INTEGER NOT NULL DEFAULT 1000,
        backoff_multiplier REAL NOT NULL DEFAULT 2.0,
        max_retry_delay_ms INTEGER NOT NULL DEFAULT 60000,
        scheduled_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        failed_at TEXT,
        last_error TEXT,
        timeout_ms INTEGER NOT NULL DEFAULT 30000,
        correlation_id TEXT NOT NULL
      );

      CREATE TABLE core_audit_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        user_id TEXT,
        device_id TEXT NOT NULL,
        organisation_id TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        metadata_json TEXT
      );

      CREATE TABLE core_sync_tombstones (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        organisation_id TEXT NOT NULL,
        sync_group_id TEXT NOT NULL,
        feature_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        deleted_by TEXT NOT NULL,
        delete_operation_id TEXT NOT NULL UNIQUE,
        replicated_at TEXT
      );
    `);

    registry = new MaintenanceRegistry({ includeCoreDefaults: true });
    orchestrator = new MaintenanceOrchestrator({
      connection: db,
      registry,
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it("rejects pruning filters that broaden deletion with boolean SQL", () => {
    const maliciousFilter = "status = 'ARCHIVED' OR 1 = 1";
    const manifest: FeatureManifest = {
      id: "domain-telemetry",
      name: "Domain Telemetry",
      version: "1.0.0",
      dependencies: [],
      permissions: [],
      migrations: [],
      pruningPolicies: [
        {
          id: "domain.telemetry_events",
          displayName: "Telemetry Events",
          tableName: "domain_telemetry_events",
          timestampColumn: "logged_at",
          defaultRetentionDays: 30,
          filterCondition: maliciousFilter,
        },
      ],
    };

    expect(() => ManifestValidator.validate(manifest)).toThrow("unsafe filterCondition");
    expect(
      () =>
        new DeclarativeTablePruner({
          id: "domain.telemetry_events",
          displayName: "Telemetry Events",
          tableName: "domain_telemetry_events",
          timestampColumn: "logged_at",
          defaultRetentionDays: 30,
          filterCondition: maliciousFilter,
        }),
    ).toThrow("single column comparison");
  });

  // -------------------------------------------------------------------------
  // Test 1: Outbox Compaction Invariant (Invariants #3 & #4)
  // -------------------------------------------------------------------------
  it("Gate G-014 / Invariant #3 & #4: Un-replicated outbox envelopes (PENDING or FAILED) are never pruned regardless of age", async () => {
    const prehistoricDate = new Date("2020-01-01T00:00:00Z").toISOString();

    await db.execute(
      `INSERT INTO core_sync_outbox (
        id, created_at, envelope_id, organisation_id, sync_group_id, feature_id,
        entity_type, entity_id, operation, payload_json, author_id, device_id,
        logical_timestamp, schema_version, protocol_version, signer_public_key,
        signature, status, sent_at
      ) VALUES
        ('out_pending', ?, 'env_p', 'org_1', 'grp_1', 'feat_1', 'record', 'r1', 'create', '{}', 'auth1', 'dev1', 't1', 1, 1, 'pk1', 'sig1', 'PENDING', NULL),
        ('out_failed', ?, 'env_f', 'org_1', 'grp_1', 'feat_1', 'record', 'r2', 'create', '{}', 'auth1', 'dev1', 't2', 1, 1, 'pk1', 'sig1', 'FAILED', NULL),
        ('out_sent', ?, 'env_s', 'org_1', 'grp_1', 'feat_1', 'record', 'r3', 'create', '{}', 'auth1', 'dev1', 't3', 1, 1, 'pk1', 'sig1', 'SENT', ?);`,
      [prehistoricDate, prehistoricDate, prehistoricDate, prehistoricDate],
    );

    // Run pruning with an aggressive, valid one-day retention override.
    orchestrator.setRetentionOverride("core.sync.outbox", 1);
    const report = await orchestrator.pruneAll({ skipVacuum: true });
    expect(report.success).toBe(true);

    const remaining = await db.query<{ id: string; status: string }>(
      "SELECT id, status FROM core_sync_outbox ORDER BY id",
    );

    // Only 'out_sent' should be pruned; 'out_pending' and 'out_failed' must remain intact
    expect(remaining).toHaveLength(2);
    expect(remaining.map((r) => r.id)).toEqual(["out_failed", "out_pending"]);
  });

  // -------------------------------------------------------------------------
  // Test 2: Replicated Tombstone GC Invariant (Invariant #6)
  // -------------------------------------------------------------------------
  it("Gate G-014 / Invariant #6: Un-replicated tombstones (replicated_at IS NULL) are never pruned before peer acknowledgment", async () => {
    const prehistoricDate = new Date("2020-01-01T00:00:00Z").toISOString();

    await db.execute(
      `INSERT INTO core_sync_tombstones (
        id, created_at, organisation_id, sync_group_id, feature_id, entity_type,
        entity_id, deleted_at, deleted_by, delete_operation_id, replicated_at
      ) VALUES
        ('tb_unreplicated', ?, 'org_1', 'grp_1', 'feat_1', 'widgets', 'w1', ?, 'usr1', 'del_op_1', NULL),
        ('tb_replicated', ?, 'org_1', 'grp_1', 'feat_1', 'widgets', 'w2', ?, 'usr1', 'del_op_2', ?);`,
      [prehistoricDate, prehistoricDate, prehistoricDate, prehistoricDate, prehistoricDate],
    );

    orchestrator.setRetentionOverride("core.sync.tombstones", 1);
    const report = await orchestrator.pruneAll({ skipVacuum: true });
    expect(report.success).toBe(true);

    const remaining = await db.query<{
      id: string;
      replicated_at: string | null;
    }>("SELECT id, replicated_at FROM core_sync_tombstones");

    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe("tb_unreplicated");
    expect(remaining[0]?.replicated_at).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 3: Active Task Protection Invariant
  // -------------------------------------------------------------------------
  it("Gate G-014: Active tasks in PENDING or RUNNING state are protected from deletion", async () => {
    const prehistoricDate = new Date("2020-01-01T00:00:00Z").toISOString();

    await db.execute(
      `INSERT INTO core_background_tasks (
        id, created_at, updated_at, task_type, organisation_id, payload_json, state, scheduled_at, correlation_id
      ) VALUES
        ('task_pending', ?, ?, 'sync', 'org_1', '{}', 'PENDING', ?, 'c1'),
        ('task_running', ?, ?, 'sync', 'org_1', '{}', 'RUNNING', ?, 'c2'),
        ('task_completed', ?, ?, 'sync', 'org_1', '{}', 'COMPLETED', ?, 'c3'),
        ('task_cancelled', ?, ?, 'sync', 'org_1', '{}', 'CANCELLED', ?, 'c4');`,
      [
        prehistoricDate,
        prehistoricDate,
        prehistoricDate,
        prehistoricDate,
        prehistoricDate,
        prehistoricDate,
        prehistoricDate,
        prehistoricDate,
        prehistoricDate,
        prehistoricDate,
        prehistoricDate,
        prehistoricDate,
      ],
    );

    orchestrator.setRetentionOverride("core.tasks", 1);
    const report = await orchestrator.pruneAll({ skipVacuum: true });
    expect(report.success).toBe(true);

    const remaining = await db.query<{ id: string; state: string }>(
      "SELECT id, state FROM core_background_tasks ORDER BY id",
    );

    expect(remaining).toHaveLength(2);
    expect(remaining.map((r) => r.id)).toEqual(["task_pending", "task_running"]);
  });

  // -------------------------------------------------------------------------
  // Test 4: Invariant #1: Repository / Connection Boundary
  // -------------------------------------------------------------------------
  it("Invariant #1: Maintenance package operates strictly via DatabaseConnection without raw fs/driver leaks", () => {
    const maintenanceSrc = path.join(workspaceRoot, "packages/maintenance/src");

    const checkDir = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== "__tests__") {
          checkDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".ts")) {
          const content = fs.readFileSync(fullPath, "utf8");
          // Ensure no direct sqlite3/better-sqlite3/rusqlite/fs raw handles in handlers
          expect(content).not.toMatch(/require\(['"]sqlite3['"]\)/);
          expect(content).not.toMatch(/require\(['"]better-sqlite3['"]\)/);
          expect(content).not.toMatch(/from ['"]better-sqlite3['"]/);
          expect(content).not.toMatch(/from ['"]sqlite3['"]/);
          expect(content).not.toMatch(/fs\.unlink/);
        }
      }
    };

    checkDir(maintenanceSrc);
  });

  // -------------------------------------------------------------------------
  // Test 5: Invariant #10: Boilerplate / Implementation Boundary
  // -------------------------------------------------------------------------
  it("Invariant #10: Domain features can extend data retention policies without modifying core packages", async () => {
    // Verify an arbitrary domain feature manifest can specify declarative pruning policies
    const domainManifest: FeatureManifest = {
      id: "domain-telemetry",
      name: "Domain Telemetry",
      version: "1.0.0",
      dependencies: [],
      permissions: [{ name: "telemetry.view", description: "View telemetry" }],
      migrations: [
        {
          version: 1,
          name: "create_telemetry_table",
          sql: "CREATE TABLE IF NOT EXISTS domain_telemetry_events (id TEXT PRIMARY KEY, logged_at TEXT NOT NULL, status TEXT NOT NULL);",
          checksum: "chk_telemetry_01",
        },
      ],
      pruningPolicies: [
        {
          id: "domain.telemetry_events",
          displayName: "Domain Telemetry Events Pruner",
          tableName: "domain_telemetry_events",
          timestampColumn: "logged_at",
          defaultRetentionDays: 3,
          filterCondition: "status = 'PROCESSED'",
        },
      ],
    };

    const platform = new Platform({ db });
    platform.registerFeature({ manifest: domainManifest });
    await platform.init();

    // Verify policy was auto-registered in the platform's maintenance registry
    const handler = platform.maintenanceRegistry.getHandler("domain.telemetry_events");
    expect(handler).toBeDefined();
    expect(handler?.displayName).toBe("Domain Telemetry Events Pruner");

    // Insert domain rows
    const oldDate = new Date("2026-01-01T00:00:00Z").toISOString();
    await db.execute(
      `INSERT INTO domain_telemetry_events (id, logged_at, status) VALUES
        ('e1', ?, 'PROCESSED'),
        ('e2', ?, 'UNPROCESSED');`,
      [oldDate, oldDate],
    );

    const report = await platform.runMaintenance({ skipVacuum: true });
    expect(report.success).toBe(true);

    const remaining = await db.query<{ id: string }>("SELECT id FROM domain_telemetry_events");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe("e2");
  });
});
