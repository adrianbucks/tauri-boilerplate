import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import {
  MaintenanceRegistry,
  MaintenanceOrchestrator,
  DeclarativeTablePruner,
  SyncOutboxPruner,
  SyncInboxPruner,
  BackgroundTasksPruner,
  AuditEventsPruner,
  ReplicatedTombstonePruner,
  type PruningHandler,
} from "../index.js";

describe("@platform/maintenance unit test suite", () => {
  let db: MemoryDatabaseConnection;

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

      CREATE TABLE feature_sensor_readings (
        id TEXT PRIMARY KEY,
        recorded_at TEXT NOT NULL,
        reading_value REAL NOT NULL,
        status TEXT NOT NULL
      );
    `);
  });

  afterEach(async () => {
    await db.close();
  });

  describe("DeclarativeTablePruner", () => {
    it("prunes rows past cutoff matching filter condition and preserves active/recent rows", async () => {
      const oldDate = new Date("2026-01-01T00:00:00Z").toISOString();
      const recentDate = new Date("2026-09-01T00:00:00Z").toISOString();

      await db.execute(
        `INSERT INTO feature_sensor_readings (id, recorded_at, reading_value, status) VALUES
          ('s1', ?, 22.5, 'ARCHIVED'),
          ('s2', ?, 23.0, 'PROCESSED'),
          ('s3', ?, 24.1, 'ARCHIVED'),
          ('s4', ?, 25.0, 'PENDING');`,
        [oldDate, oldDate, recentDate, oldDate],
      );

      const pruner = new DeclarativeTablePruner({
        id: "feature.sensor_readings",
        displayName: "Sensor Readings Pruner",
        tableName: "feature_sensor_readings",
        timestampColumn: "recorded_at",
        defaultRetentionDays: 30,
        filterCondition: "status = 'ARCHIVED'",
      });

      const cutoff = new Date("2026-06-01T00:00:00Z");
      const eligible = await pruner.countEligible(db, cutoff);
      expect(eligible).toBe(1); // s1 only (s2 is PROCESSED, s3 is recent, s4 is PENDING)

      const result = await pruner.prune({
        connection: db,
        cutoffDate: cutoff,
        batchSize: 10,
      });

      expect(result.rowsPruned).toBe(1);

      const remaining = await db.query<{ id: string }>(
        "SELECT id FROM feature_sensor_readings ORDER BY id",
      );
      expect(remaining.map((r) => r.id)).toEqual(["s2", "s3", "s4"]);
    });

    it("rejects invalid table names or malicious filter SQL injection", () => {
      expect(
        () =>
          new DeclarativeTablePruner({
            id: "bad.table",
            displayName: "Bad",
            tableName: "users; DROP TABLE users;--",
            timestampColumn: "created_at",
            defaultRetentionDays: 7,
          }),
      ).toThrow();

      expect(
        () =>
          new DeclarativeTablePruner({
            id: "bad.filter",
            displayName: "Bad Filter",
            tableName: "feature_sensor_readings",
            timestampColumn: "recorded_at",
            defaultRetentionDays: 7,
            filterCondition: "status = 'A'; DROP TABLE feature_sensor_readings;--",
          }),
      ).toThrow();
    });
  });

  describe("SyncOutboxPruner", () => {
    it("Invariant #1 & #3: strictly preserves PENDING and FAILED envelopes, only prunes SENT", async () => {
      const oldDate = new Date("2026-01-01T00:00:00Z").toISOString();
      const recentDate = new Date("2026-10-01T00:00:00Z").toISOString();

      await db.execute(
        `INSERT INTO core_sync_outbox (
          id, created_at, envelope_id, organisation_id, sync_group_id, feature_id,
          entity_type, entity_id, operation, payload_json, author_id, device_id,
          logical_timestamp, schema_version, protocol_version, signer_public_key,
          signature, status, sent_at
        ) VALUES
          ('ob1', ?, 'env1', 'org1', 'grp1', 'f1', 'e1', 'id1', 'create', '{}', 'a1', 'd1', 't1', 1, 1, 'pk1', 'sig1', 'SENT', ?),
          ('ob2', ?, 'env2', 'org1', 'grp1', 'f1', 'e1', 'id2', 'create', '{}', 'a1', 'd1', 't2', 1, 1, 'pk1', 'sig1', 'PENDING', NULL),
          ('ob3', ?, 'env3', 'org1', 'grp1', 'f1', 'e1', 'id3', 'create', '{}', 'a1', 'd1', 't3', 1, 1, 'pk1', 'sig1', 'FAILED', NULL),
          ('ob4', ?, 'env4', 'org1', 'grp1', 'f1', 'e1', 'id4', 'create', '{}', 'a1', 'd1', 't4', 1, 1, 'pk1', 'sig1', 'SENT', ?);`,
        [oldDate, oldDate, oldDate, oldDate, recentDate, recentDate],
      );

      const pruner = new SyncOutboxPruner();
      const cutoff = new Date("2026-06-01T00:00:00Z");

      const eligible = await pruner.countEligible(db, cutoff);
      expect(eligible).toBe(1); // ob1 only

      const res = await pruner.prune({
        connection: db,
        cutoffDate: cutoff,
        batchSize: 10,
      });

      expect(res.rowsPruned).toBe(1);

      const remaining = await db.query<{ id: string; status: string }>(
        "SELECT id, status FROM core_sync_outbox ORDER BY id",
      );
      expect(remaining).toEqual([
        { id: "ob2", status: "PENDING" },
        { id: "ob3", status: "FAILED" },
        { id: "ob4", status: "SENT" },
      ]);
    });
  });

  describe("SyncInboxPruner", () => {
    it("Invariant #2: strictly preserves PENDING envelopes, prunes APPLIED and CONFLICT past cutoff", async () => {
      const oldDate = new Date("2026-01-01T00:00:00Z").toISOString();
      const recentDate = new Date("2026-10-01T00:00:00Z").toISOString();

      await db.execute(
        `INSERT INTO core_sync_inbox (
          id, created_at, envelope_id, organisation_id, from_device_id, sync_group_id,
          feature_id, entity_type, entity_id, operation, payload_json, logical_timestamp,
          schema_version, protocol_version, signer_public_key, signature, apply_status, applied_at
        ) VALUES
          ('ib1', ?, 'env1', 'org1', 'dev1', 'grp1', 'f1', 'e1', 'id1', 'create', '{}', 't1', 1, 1, 'pk1', 'sig1', 'APPLIED', ?),
          ('ib2', ?, 'env2', 'org1', 'dev1', 'grp1', 'f1', 'e1', 'id2', 'create', '{}', 't2', 1, 1, 'pk1', 'sig1', 'CONFLICT', ?),
          ('ib3', ?, 'env3', 'org1', 'dev1', 'grp1', 'f1', 'e1', 'id3', 'create', '{}', 't3', 1, 1, 'pk1', 'sig1', 'PENDING', NULL),
          ('ib4', ?, 'env4', 'org1', 'dev1', 'grp1', 'f1', 'e1', 'id4', 'create', '{}', 't4', 1, 1, 'pk1', 'sig1', 'APPLIED', ?);`,
        [oldDate, oldDate, oldDate, oldDate, oldDate, recentDate, recentDate],
      );

      const pruner = new SyncInboxPruner();
      const cutoff = new Date("2026-06-01T00:00:00Z");

      const eligible = await pruner.countEligible(db, cutoff);
      expect(eligible).toBe(2); // ib1 (APPLIED) and ib2 (CONFLICT)

      const res = await pruner.prune({
        connection: db,
        cutoffDate: cutoff,
        batchSize: 10,
      });

      expect(res.rowsPruned).toBe(2);

      const remaining = await db.query<{ id: string; apply_status: string }>(
        "SELECT id, apply_status FROM core_sync_inbox ORDER BY id",
      );
      expect(remaining).toEqual([
        { id: "ib3", apply_status: "PENDING" },
        { id: "ib4", apply_status: "APPLIED" },
      ]);
    });
  });

  describe("BackgroundTasksPruner", () => {
    it("Invariant #4: strictly preserves PENDING and RUNNING tasks, prunes COMPLETED and CANCELLED", async () => {
      const oldDate = new Date("2026-01-01T00:00:00Z").toISOString();
      const recentDate = new Date("2026-10-01T00:00:00Z").toISOString();

      await db.execute(
        `INSERT INTO core_background_tasks (
          id, created_at, updated_at, task_type, organisation_id, payload_json, state, scheduled_at, completed_at, correlation_id
        ) VALUES
          ('t1', ?, ?, 'sync', 'org1', '{}', 'COMPLETED', ?, ?, 'c1'),
          ('t2', ?, ?, 'sync', 'org1', '{}', 'CANCELLED', ?, ?, 'c2'),
          ('t3', ?, ?, 'sync', 'org1', '{}', 'PENDING', ?, NULL, 'c3'),
          ('t4', ?, ?, 'sync', 'org1', '{}', 'RUNNING', ?, NULL, 'c4'),
          ('t5', ?, ?, 'sync', 'org1', '{}', 'COMPLETED', ?, ?, 'c5');`,
        [
          oldDate,
          oldDate,
          oldDate,
          oldDate,
          oldDate,
          oldDate,
          oldDate,
          oldDate,
          oldDate,
          oldDate,
          oldDate,
          oldDate,
          oldDate,
          oldDate,
          recentDate,
          recentDate,
          recentDate,
          recentDate,
        ],
      );

      const pruner = new BackgroundTasksPruner();
      const cutoff = new Date("2026-06-01T00:00:00Z");

      const eligible = await pruner.countEligible(db, cutoff);
      expect(eligible).toBe(2); // t1 and t2

      const res = await pruner.prune({
        connection: db,
        cutoffDate: cutoff,
        batchSize: 10,
      });

      expect(res.rowsPruned).toBe(2);

      const remaining = await db.query<{ id: string; state: string }>(
        "SELECT id, state FROM core_background_tasks ORDER BY id",
      );
      expect(remaining).toEqual([
        { id: "t3", state: "PENDING" },
        { id: "t4", state: "RUNNING" },
        { id: "t5", state: "COMPLETED" },
      ]);
    });
  });

  describe("ReplicatedTombstonePruner", () => {
    it("Invariant #3 & #6: never prunes tombstones where replicated_at IS NULL", async () => {
      const oldDate = new Date("2026-01-01T00:00:00Z").toISOString();
      const recentDate = new Date("2026-10-01T00:00:00Z").toISOString();

      await db.execute(
        `INSERT INTO core_sync_tombstones (
          id, created_at, organisation_id, sync_group_id, feature_id, entity_type,
          entity_id, deleted_at, deleted_by, delete_operation_id, replicated_at
        ) VALUES
          ('tb1', ?, 'org1', 'grp1', 'f1', 'widgets', 'w1', ?, 'user1', 'op1', ?),
          ('tb2', ?, 'org1', 'grp1', 'f1', 'widgets', 'w2', ?, 'user1', 'op2', NULL),
          ('tb3', ?, 'org1', 'grp1', 'f1', 'widgets', 'w3', ?, 'user1', 'op3', ?);`,
        [oldDate, oldDate, oldDate, oldDate, oldDate, recentDate, recentDate, recentDate],
      );

      const pruner = new ReplicatedTombstonePruner();
      const cutoff = new Date("2026-06-01T00:00:00Z");

      const eligible = await pruner.countEligible(db, cutoff);
      expect(eligible).toBe(1); // tb1 only (tb2 has replicated_at NULL, tb3 is recent)

      const res = await pruner.prune({
        connection: db,
        cutoffDate: cutoff,
        batchSize: 10,
      });

      expect(res.rowsPruned).toBe(1);

      const remaining = await db.query<{
        id: string;
        replicated_at: string | null;
      }>("SELECT id, replicated_at FROM core_sync_tombstones ORDER BY id");
      expect(remaining).toEqual([
        { id: "tb2", replicated_at: null },
        { id: "tb3", replicated_at: recentDate },
      ]);
    });
  });

  describe("MaintenanceOrchestrator", () => {
    it("orchestrates inspection, pruning across all handlers, batching, and VACUUM", async () => {
      const oldDate = new Date("2026-01-01T00:00:00Z").toISOString();

      // Insert 2 audit events
      await db.execute(
        `INSERT INTO core_audit_events (id, event_type, device_id, organisation_id, correlation_id, timestamp) VALUES
          ('ae1', 'login', 'dev1', 'org1', 'c1', ?),
          ('ae2', 'logout', 'dev1', 'org1', 'c2', ?);`,
        [oldDate, oldDate],
      );

      const registry = new MaintenanceRegistry({ includeCoreDefaults: true });
      const orchestrator = new MaintenanceOrchestrator({
        connection: db,
        registry,
      });

      // Override retention to 1 day for test
      orchestrator.setRetentionOverride("core.audit.events", 1);

      const inspection = await orchestrator.inspectAll();
      const auditStats = inspection.find((s) => s.handlerId === "core.audit.events");
      expect(auditStats?.eligibleRowCount).toBe(2);

      const report = await orchestrator.pruneAll({ batchSize: 1 });
      expect(report.success).toBe(true);
      expect(report.vacuumExecuted).toBe(true);
      expect(report.totalRowsPruned).toBe(2);

      const remainingAudits = await db.query("SELECT id FROM core_audit_events");
      expect(remainingAudits.length).toBe(0);
    });

    it("respects AbortSignal cancellation during execution", async () => {
      const registry = new MaintenanceRegistry({ includeCoreDefaults: true });
      const orchestrator = new MaintenanceOrchestrator({
        connection: db,
        registry,
      });

      const controller = new AbortController();
      controller.abort();

      const report = await orchestrator.pruneAll({ signal: controller.signal });
      expect(report.aborted).toBe(true);
      expect(report.vacuumExecuted).toBe(false);
      expect(report.results.some((r) => r.error === "Pruning aborted by signal")).toBe(true);
    });

    it("executes VACUUM when aborted mid-run if rows were pruned (B-06)", async () => {
      const registry = new MaintenanceRegistry({ includeCoreDefaults: false });
      const controller = new AbortController();

      const handler1: PruningHandler = {
        id: "test.pruner1",
        displayName: "Pruner 1",
        description: "Test pruner 1 description",
        defaultRetentionDays: 1,
        countEligible: async () => 1,
        prune: async () => {
          controller.abort();
          return {
            handlerId: "test.pruner1",
            displayName: "Pruner 1",
            rowsPruned: 1,
            durationMs: 5,
          };
        },
      };

      const handler2: PruningHandler = {
        id: "test.pruner2",
        displayName: "Pruner 2",
        description: "Test pruner 2 description",
        defaultRetentionDays: 1,
        countEligible: async () => 0,
        prune: async () => ({
          handlerId: "test.pruner2",
          displayName: "Pruner 2",
          rowsPruned: 0,
          durationMs: 0,
        }),
      };

      registry.registerHandler(handler1);
      registry.registerHandler(handler2);

      const orchestrator = new MaintenanceOrchestrator({
        connection: db,
        registry,
      });

      const report = await orchestrator.pruneAll({ signal: controller.signal });
      expect(report.aborted).toBe(true);
      expect(report.totalRowsPruned).toBe(1);
      // Even though aborted, rows were pruned so VACUUM must execute!
      expect(report.vacuumExecuted).toBe(true);
      expect(report.results.some((r) => r.handlerId === "test.pruner1" && r.rowsPruned === 1)).toBe(
        true,
      );
      expect(
        report.results.some(
          (r) => r.handlerId === "test.pruner2" && r.error === "Pruning aborted by signal",
        ),
      ).toBe(true);
    });
  });
});
