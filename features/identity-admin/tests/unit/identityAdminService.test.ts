import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { createOperationContext } from "@platform/core";
import { IdentityAdminService } from "../../src/services/identityAdminService.js";

describe("@features/identity-admin", () => {
  let db: MemoryDatabaseConnection;
  let service: IdentityAdminService;
  const ctx = createOperationContext({
    deviceId: "dev_admin_1",
    organisationId: "org_acme",
    userId: "user_superadmin",
  });

  beforeEach(async () => {
    db = new MemoryDatabaseConnection(":memory:");
    await db.init();

    await db.execute(`
      CREATE TABLE core_users (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT,
        updated_by TEXT,
        organisation_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        email TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE'
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
      CREATE TABLE core_user_roles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        organisation_id TEXT NOT NULL,
        granted_by TEXT,
        granted_at TEXT NOT NULL
      );
      CREATE TABLE core_devices (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE TABLE core_sync_group_members (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        user_id TEXT,
        status TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        revoked_at TEXT,
        revoked_by TEXT,
        revocation_reason TEXT
      );
      CREATE TABLE core_membership_requests (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        user_id TEXT,
        requested_at TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE core_membership_decisions (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        decided_by TEXT NOT NULL,
        decision TEXT NOT NULL,
        decided_at TEXT NOT NULL,
        signature TEXT
      );
      CREATE TABLE core_revocations (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        group_id TEXT,
        revoked_by TEXT NOT NULL,
        revoked_at TEXT NOT NULL,
        reason TEXT NOT NULL
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
    `);

    service = new IdentityAdminService(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("creates user with audit event logging", async () => {
    const userId = await service.createUser(
      {
        organisationId: "org_acme",
        displayName: "Operator John",
        email: "john@acme.com",
      },
      ctx,
    );

    expect(userId.startsWith("usr_")).toBe(true);

    const auditRows = await db.query<{ event_type: string }>(
      "SELECT event_type FROM core_audit_events WHERE user_id = ?",
      ["user_superadmin"],
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.event_type).toBe("USER_CREATED");
  });

  it("approves device pairing request and records audit event", async () => {
    await db.execute(
      "INSERT INTO core_devices (id, device_id, status) VALUES ('d1', 'dev_tablet_1', 'PENDING_APPROVAL');",
    );
    await db.execute(
      "INSERT INTO core_membership_requests (id, device_id, group_id, requested_at, status) VALUES ('req_1', 'dev_tablet_1', 'grp_1', '2026-08-30T10:00:00Z', 'PENDING');",
    );

    await service.approveDevice("dev_tablet_1", "req_1", ctx);

    const dev = await db.query<{ status: string }>(
      "SELECT status FROM core_devices WHERE device_id = ?",
      ["dev_tablet_1"],
    );
    expect(dev[0]?.status).toBe("APPROVED");

    const auditRows = await db.query<{ event_type: string }>(
      "SELECT event_type FROM core_audit_events WHERE event_type = 'DEVICE_APPROVED'",
    );
    expect(auditRows).toHaveLength(1);
  });

  it("revokes a device from a sync group and records audit event", async () => {
    await db.execute(
      "INSERT INTO core_devices (id, device_id, status, updated_at) VALUES ('d2', 'dev_laptop_2', 'ACTIVE', '2026-08-30T10:00:00Z');",
    );
    await db.execute(
      "INSERT INTO core_sync_group_members (id, group_id, device_id, status, joined_at) VALUES ('m1', 'grp_1', 'dev_laptop_2', 'ACTIVE', '2026-08-30T10:00:00Z');",
    );

    await service.revokeDevice(
      "dev_laptop_2",
      "grp_1",
      "Device reported stolen",
      ctx,
    );

    const dev = await db.query<{ status: string }>(
      "SELECT status FROM core_devices WHERE device_id = ?",
      ["dev_laptop_2"],
    );
    expect(dev[0]?.status).toBe("REVOKED");

    const auditRows = await db.query<{ event_type: string }>(
      "SELECT event_type FROM core_audit_events WHERE event_type = 'DEVICE_REVOKED'",
    );
    expect(auditRows).toHaveLength(1);
  });

  it("creates a user with a role assignment", async () => {
    await db.execute(
      "INSERT INTO core_roles (id, created_at, updated_at, organisation_id, name) VALUES ('role_op', '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z', 'org_acme', 'Operator');",
    );

    const userId = await service.createUser(
      {
        organisationId: "org_acme",
        displayName: "Operator Jane",
        email: "jane@acme.com",
        roleId: "role_op",
      },
      ctx,
    );

    expect(userId.startsWith("usr_")).toBe(true);

    const roleRow = await db.query<{ role_id: string }>(
      "SELECT role_id FROM core_user_roles WHERE user_id = ?",
      [userId],
    );
    expect(roleRow).toHaveLength(1);
    expect(roleRow[0]?.role_id).toBe("role_op");
  });
});
