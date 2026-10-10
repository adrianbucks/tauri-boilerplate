import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { createOperationContext } from "@platform/core";
import { IdentityAdminService } from "../../src/services/identityAdminService.js";

import { IDENTITY_ADMIN_PERMISSIONS } from "../../src/permissions.js";

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
      CREATE TABLE core_sync_groups (
        id TEXT PRIMARY KEY,
        organisation_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE'
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

    await db.execute(
      "INSERT INTO core_sync_groups (id, organisation_id) VALUES ('grp_1', 'org_acme')",
    );

    // Seed admin role & permissions for user_superadmin in org_acme
    await db.execute(
      `INSERT INTO core_roles (id, created_at, updated_at, organisation_id, name)
       VALUES ('role_superadmin', '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z', 'org_acme', 'Superadmin')`,
    );
    for (const perm of [
      IDENTITY_ADMIN_PERMISSIONS.USERS_CREATE,
      IDENTITY_ADMIN_PERMISSIONS.USERS_READ,
      IDENTITY_ADMIN_PERMISSIONS.ROLES_MANAGE,
      IDENTITY_ADMIN_PERMISSIONS.DEVICES_APPROVE,
      IDENTITY_ADMIN_PERMISSIONS.DEVICES_REVOKE,
      "sync.manage",
    ]) {
      await db.execute(`INSERT INTO core_permissions (id, name) VALUES (?, ?)`, [perm, perm]);
      await db.execute(
        `INSERT INTO core_role_permissions (id, role_id, permission_id) VALUES (?, 'role_superadmin', ?)`,
        [`rp_${perm}`, perm],
      );
    }
    await db.execute(
      `INSERT INTO core_user_roles (id, user_id, role_id, organisation_id, granted_at)
       VALUES ('ur_superadmin', 'user_superadmin', 'role_superadmin', 'org_acme', '2026-08-30T10:00:00Z')`,
    );

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

  it("normalizes blank email values and rejects malformed runtime inputs", async () => {
    const userId = await service.createUser(
      { organisationId: "org_acme", displayName: "No Email", email: "  " },
      ctx,
    );
    const user = await db.query<{ email: string | null }>(
      "SELECT email FROM core_users WHERE id = ?",
      [userId],
    );
    expect(user[0]?.email).toBeNull();

    await expect(
      service.createUser({ organisationId: "org_acme", displayName: 42 as unknown as string }, ctx),
    ).rejects.toThrow("Display name is required");
    await expect(
      service.createUser(
        { organisationId: "org_acme", displayName: "Invalid email", email: 42 as never },
        ctx,
      ),
    ).rejects.toThrow("Email must be a string");
  });

  it("approves device pairing request and records audit event", async () => {
    await db.execute(
      "INSERT INTO core_devices (id, device_id, status) VALUES ('d1', 'dev_tablet_1', 'PENDING_APPROVAL');",
    );
    await db.execute(
      "INSERT INTO core_membership_requests (id, device_id, group_id, requested_at, status) VALUES ('req_1', 'dev_tablet_1', 'grp_1', '2026-08-30T10:00:00Z', 'PENDING');",
    );

    await service.approveDevice("dev_tablet_1", "req_1", ctx);
    await expect(service.approveDevice("dev_tablet_1", "req_1", ctx)).rejects.toThrow(
      "not pending",
    );

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

  it("rejects approval when the supplied device does not match the request", async () => {
    await db.execute(
      "INSERT INTO core_devices (id, device_id, status) VALUES ('d1', 'dev_request', 'PENDING_APPROVAL'), ('d2', 'dev_other', 'PENDING_APPROVAL')",
    );
    await db.execute(
      "INSERT INTO core_membership_requests (id, device_id, group_id, requested_at, status) VALUES ('req_mismatch', 'dev_request', 'grp_1', 'now', 'PENDING')",
    );

    await expect(service.approveDevice("dev_other", "req_mismatch", ctx)).rejects.toThrow(
      "different device",
    );

    const request = await db.query<{ status: string }>(
      "SELECT status FROM core_membership_requests WHERE id = ?",
      ["req_mismatch"],
    );
    const device = await db.query<{ status: string }>(
      "SELECT status FROM core_devices WHERE device_id = ?",
      ["dev_other"],
    );
    expect(request[0]?.status).toBe("PENDING");
    expect(device[0]?.status).toBe("PENDING_APPROVAL");
  });

  it("rejects membership approval when the device has no registered identity", async () => {
    await db.execute(
      "INSERT INTO core_membership_requests (id, device_id, group_id, requested_at, status) VALUES ('req_missing_device', 'dev_missing', 'grp_1', 'now', 'PENDING')",
    );

    await expect(service.approveDevice("dev_missing", "req_missing_device", ctx)).rejects.toThrow(
      "ineligible for approval",
    );

    const request = await db.query<{ status: string }>(
      "SELECT status FROM core_membership_requests WHERE id = ?",
      ["req_missing_device"],
    );
    expect(request[0]?.status).toBe("PENDING");
  });

  it("revokes a device from a sync group and records audit event", async () => {
    await db.execute(
      "INSERT INTO core_devices (id, device_id, status, updated_at) VALUES ('d2', 'dev_laptop_2', 'ACTIVE', '2026-08-30T10:00:00Z');",
    );
    await db.execute(
      "INSERT INTO core_sync_group_members (id, group_id, device_id, status, joined_at) VALUES ('m1', 'grp_1', 'dev_laptop_2', 'ACTIVE', '2026-08-30T10:00:00Z');",
    );

    await service.revokeDevice("dev_laptop_2", "grp_1", "Device reported stolen", ctx);

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

  it("does not revoke the global device status when it is not a member of the group", async () => {
    await db.execute(
      "INSERT INTO core_devices (id, device_id, status, updated_at) VALUES ('d3', 'dev_unrelated', 'ACTIVE', 'now')",
    );

    await expect(
      service.revokeDevice("dev_unrelated", "grp_1", "Requested revocation", ctx),
    ).rejects.toThrow("not an active member");

    const device = await db.query<{ status: string }>(
      "SELECT status FROM core_devices WHERE device_id = ?",
      ["dev_unrelated"],
    );
    expect(device[0]?.status).toBe("ACTIVE");
  });

  it("rejects revocation when the device identity does not exist", async () => {
    await expect(
      service.revokeDevice("dev_missing", "grp_1", "Requested revocation", ctx),
    ).rejects.toThrow("does not exist");

    const revocations = await db.query<{ id: string }>(
      "SELECT id FROM core_revocations WHERE device_id = ?",
      ["dev_missing"],
    );
    expect(revocations).toHaveLength(0);
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

  it("rejects assigning a role from another organisation", async () => {
    await db.execute(
      "INSERT INTO core_roles (id, created_at, updated_at, organisation_id, name) VALUES ('role_other', 'now', 'now', 'org_other', 'Other role')",
    );

    await expect(
      service.createUser(
        { organisationId: "org_acme", displayName: "No Role Leak", roleId: "role_other" },
        ctx,
      ),
    ).rejects.toThrow("does not exist in organisation");

    const users = await db.query<{ id: string }>(
      "SELECT id FROM core_users WHERE display_name = ?",
      ["No Role Leak"],
    );
    expect(users).toHaveLength(0);
  });

  it("rejects cross-tenant user creation", async () => {
    await expect(
      service.createUser(
        {
          organisationId: "org_other_tenant",
          displayName: "Cross Tenant User",
        },
        ctx,
      ),
    ).rejects.toThrow("Cross-tenant user creation forbidden");
  });

  it("rejects user creation when caller lacks permission", async () => {
    const unprivilegedCtx = createOperationContext({
      deviceId: "dev_nobody",
      organisationId: "org_acme",
      userId: "user_nobody",
    });

    await expect(
      service.createUser(
        {
          organisationId: "org_acme",
          displayName: "Unauthorized Test",
        },
        unprivilegedCtx,
      ),
    ).rejects.toThrow("Authorization failed");
  });
});
