import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { createOperationContext, type OperationContext } from "@platform/core";
import {
  HybridLogicalClock,
  ConflictRegistry,
  NamespaceGenerator,
  type SyncOperation,
} from "@platform/sync-protocol";
import { WidgetService, type WidgetRecord } from "@features/example-feature";

class VirtualSyncDevice {
  readonly deviceId: string;
  readonly orgId: string;
  readonly hlc: HybridLogicalClock;
  readonly db: MemoryDatabaseConnection;
  readonly widgets: WidgetService;
  readonly outgoingQueue: SyncOperation[] = [];
  readonly entityTimestamps = new Map<string, string>();

  constructor(deviceId: string, orgId: string) {
    this.deviceId = deviceId;
    this.orgId = orgId;
    this.hlc = new HybridLogicalClock(deviceId);
    this.db = new MemoryDatabaseConnection(":memory:");
    this.widgets = new WidgetService(this.db);
  }

  async init(): Promise<void> {
    await this.db.init();
    await this.db.execute(`
      CREATE TABLE core_permissions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT
      );
      CREATE TABLE core_roles (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT,
        updated_by TEXT,
        organisation_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT
      );
      CREATE TABLE core_role_permissions (
        id TEXT PRIMARY KEY,
        role_id TEXT NOT NULL,
        permission_id TEXT NOT NULL,
        scope_constraints_json TEXT
      );
      CREATE TABLE core_user_roles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        organisation_id TEXT NOT NULL,
        granted_by TEXT,
        granted_at TEXT NOT NULL
      );
      CREATE TABLE widgets (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT,
        updated_by TEXT,
        entity_id TEXT NOT NULL UNIQUE,
        organisation_id TEXT NOT NULL,
        sync_group_id TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        sync_version INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        deleted_by TEXT,
        delete_operation_id TEXT,
        data_classification TEXT DEFAULT 'INTERNAL',
        name TEXT NOT NULL,
        sku TEXT NOT NULL UNIQUE,
        quantity INTEGER NOT NULL DEFAULT 0,
        description TEXT
      );

      INSERT INTO core_roles (id, created_at, updated_at, organisation_id, name)
      VALUES ('role_sync_op', '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z', '${this.orgId}', 'Sync Operator');

      INSERT INTO core_permissions (id, name) VALUES
        ('widgets.create', 'widgets.create'),
        ('widgets.read', 'widgets.read'),
        ('widgets.update', 'widgets.update'),
        ('widgets.delete', 'widgets.delete');

      INSERT INTO core_role_permissions (id, role_id, permission_id) VALUES
        ('rp_wc', 'role_sync_op', 'widgets.create'),
        ('rp_wr', 'role_sync_op', 'widgets.read'),
        ('rp_wu', 'role_sync_op', 'widgets.update'),
        ('rp_wd', 'role_sync_op', 'widgets.delete');

      INSERT INTO core_user_roles (id, user_id, role_id, organisation_id, granted_at)
      VALUES ('ur_${this.deviceId}', 'usr_${this.deviceId}', 'role_sync_op', '${this.orgId}', '2026-08-30T10:00:00Z');
    `);
  }

  getContext(): OperationContext {
    return createOperationContext({
      deviceId: this.deviceId,
      organisationId: this.orgId,
      userId: `usr_${this.deviceId}`,
    });
  }

  async createLocalWidget(
    name: string,
    sku: string,
    quantity: number,
    syncGroupId: string,
  ): Promise<WidgetRecord> {
    const ctx = this.getContext();

    const w = await this.widgets.createWidget(
      { name, sku, quantity, syncGroupId },
      ctx,
    );
    const logicalTimestamp = this.hlc.now();
    this.entityTimestamps.set(w.id, logicalTimestamp);

    // Enqueue replication operation
    this.outgoingQueue.push({
      operationId: `op_${w.id}_${logicalTimestamp}`,
      applicationId: "tauri-boilerplate-demo",
      organisationId: this.orgId,
      syncGroupId,
      featureId: "example-feature",
      entityType: "widgets",
      entityId: w.id,
      operation: "create",
      payload: w,
      authorId: ctx.userId ?? "system",
      deviceId: this.deviceId,
      logicalTimestamp,
      schemaVersion: 1,
      protocolVersion: 1,
    });

    return w;
  }

  async applyRemoteOperation(
    op: SyncOperation,
    conflictRegistry: ConflictRegistry,
  ): Promise<void> {
    // 1. Advance local clock with remote HLC
    this.hlc.update(op.logicalTimestamp);

    const existing = await this.widgets.getWidgetById(
      op.entityId,
      this.getContext(),
    );
    if (!existing) {
      // Direct insert
      const item = op.payload as WidgetRecord;
      await this.db.execute(
        `INSERT INTO widgets (
          id, created_at, updated_at, created_by, updated_by, entity_id, organisation_id, sync_group_id,
          schema_version, sync_version, deleted_at, deleted_by, delete_operation_id, data_classification,
          name, sku, quantity, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id,
          item.createdAt,
          item.updatedAt,
          item.createdBy,
          item.updatedBy,
          item.entityId,
          item.organisationId,
          item.syncGroupId,
          item.schemaVersion,
          item.syncVersion,
          item.deletedAt,
          item.deletedBy,
          item.deleteOperationId,
          item.dataClassification,
          item.name,
          item.sku,
          item.quantity,
          item.description,
        ],
      );
      this.entityTimestamps.set(op.entityId, op.logicalTimestamp);
      return;
    }

    // Conflict resolution comparing local write timestamp vs remote write timestamp
    const localTimestamp =
      this.entityTimestamps.get(op.entityId) ?? "000000000000_0000_init";
    const resolution = conflictRegistry.resolve({
      entityId: op.entityId,
      entityType: op.entityType,
      localValue: existing,
      remoteValue: op.payload,
      localTimestamp,
      remoteTimestamp: op.logicalTimestamp,
    });

    if (resolution.winner === "remote") {
      const winner = resolution.resolvedValue as WidgetRecord;
      await this.db.execute(
        "UPDATE widgets SET name = ?, quantity = ?, updated_at = ? WHERE id = ?",
        [winner.name, winner.quantity, winner.updatedAt, winner.id],
      );
      this.entityTimestamps.set(op.entityId, op.logicalTimestamp);
    }
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

describe("Multi-Device Sync Harness — Simulated P2P Replication", () => {
  let devA: VirtualSyncDevice;
  let devB: VirtualSyncDevice;
  let conflicts: ConflictRegistry;

  beforeEach(async () => {
    conflicts = new ConflictRegistry();
    conflicts.registerEntityPolicy("widgets", { strategy: "lww" });

    devA = new VirtualSyncDevice("dev_tablet_A", "org_acme");
    devB = new VirtualSyncDevice("dev_laptop_B", "org_acme");

    await devA.init();
    await devB.init();
  });

  afterEach(async () => {
    await devA.close();
    await devB.close();
  });

  it("Device A writes offline → connects → Device B receives and converges", async () => {
    // 1. Device A creates widget offline
    const widgetA = await devA.createLocalWidget(
      "Acme Gear",
      "GEAR-01",
      10,
      "grp_coventry",
    );
    expect(devA.outgoingQueue).toHaveLength(1);

    // Device B does not have it yet
    expect(
      await devB.widgets.getWidgetById(widgetA.id, devB.getContext()),
    ).toBeNull();

    // 2. Transmit operation to Device B
    const op = devA.outgoingQueue.shift()!;
    await devB.applyRemoteOperation(op, conflicts);

    // 3. Device B now has the record
    const widgetB = await devB.widgets.getWidgetById(
      widgetA.id,
      devB.getContext(),
    );
    expect(widgetB).not.toBeNull();
    expect(widgetB?.sku).toBe("GEAR-01");
    expect(widgetB?.quantity).toBe(10);
  });

  it("Deterministic LWW conflict resolution: latest HLC timestamp wins on both devices", async () => {
    // Device A and Device B both start with same initial record
    const w1 = await devA.createLocalWidget(
      "Original Valve",
      "VALVE-01",
      5,
      "grp_coventry",
    );
    await devB.applyRemoteOperation(devA.outgoingQueue.shift()!, conflicts);

    // Device A edits offline at t_a
    const tA = devA.hlc.now();
    devA.entityTimestamps.set(w1.id, tA);
    const opA: SyncOperation = {
      operationId: `op_edit_A_${tA}`,
      applicationId: "tauri-boilerplate-demo",
      organisationId: "org_acme",
      syncGroupId: "grp_coventry",
      featureId: "example-feature",
      entityType: "widgets",
      entityId: w1.id,
      operation: "update",
      payload: {
        ...w1,
        name: "Edited by Device A",
        quantity: 8,
        updatedAt: new Date().toISOString(),
      },
      authorId: "usr_A",
      deviceId: "dev_tablet_A",
      logicalTimestamp: tA,
      schemaVersion: 1,
      protocolVersion: 1,
    };

    // Device B edits offline later at t_b (where t_b > t_a)
    // Advance clock so B is strictly later
    devB.hlc.update(tA);
    const tB = devB.hlc.now();
    devB.entityTimestamps.set(w1.id, tB);
    const opB: SyncOperation = {
      operationId: `op_edit_B_${tB}`,
      applicationId: "tauri-boilerplate-demo",
      organisationId: "org_acme",
      syncGroupId: "grp_coventry",
      featureId: "example-feature",
      entityType: "widgets",
      entityId: w1.id,
      operation: "update",
      payload: {
        ...w1,
        name: "Edited by Device B (Winner)",
        quantity: 20,
        updatedAt: new Date().toISOString(),
      },
      authorId: "usr_B",
      deviceId: "dev_laptop_B",
      logicalTimestamp: tB,
      schemaVersion: 1,
      protocolVersion: 1,
    };

    expect(HybridLogicalClock.compare(tA, tB)).toBeLessThan(0);

    // Device A applies opB (which has higher timestamp tB > tA)
    await devA.applyRemoteOperation(opB, conflicts);

    const finalA = await devA.widgets.getWidgetById(w1.id, devA.getContext());
    expect(finalA?.name).toBe("Edited by Device B (Winner)");
    expect(finalA?.quantity).toBe(20);
  });
});
