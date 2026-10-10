import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { AuthorizationEngine, SyncGroupService } from "@platform/authorization";
import {
  AuthorizationError,
  createOperationContext,
  type TrustedOperationContext,
} from "@platform/core";
import { IdentityAdminService } from "@features/identity-admin";
import { WidgetService } from "@features/example-feature";
import { OrganisationService } from "@features/organisations";
import { DeviceIdentityService } from "@platform/identity";

describe("Security Regression Suite — RBAC & Scope Enforcement", () => {
  let db: MemoryDatabaseConnection;
  let auth: AuthorizationEngine;

  beforeEach(async () => {
    db = new MemoryDatabaseConnection(":memory:");
    await db.init();

    await db.execute(`
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
      CREATE TABLE core_permissions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
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
      CREATE TABLE core_devices (
        id TEXT PRIMARY KEY,
        created_at TEXT,
        updated_at TEXT,
        created_by TEXT,
        updated_by TEXT,
        user_id TEXT,
        device_id TEXT NOT NULL UNIQUE,
        public_key TEXT,
        platform TEXT,
        application_id TEXT,
        status TEXT NOT NULL,
        registered_at TEXT,
        last_seen_at TEXT,
        is_local INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE core_sync_groups (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT,
        updated_by TEXT,
        organisation_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        policy_json TEXT
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
      CREATE TABLE feature_widgets (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT,
        updated_by TEXT,
        entity_id TEXT NOT NULL,
        organisation_id TEXT NOT NULL,
        sync_group_id TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        sync_version INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        deleted_by TEXT,
        delete_operation_id TEXT,
        data_classification TEXT NOT NULL DEFAULT 'INTERNAL',
        name TEXT NOT NULL,
        sku TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0,
        description TEXT
      );

      -- Seed Permissions
      INSERT INTO core_permissions (id, name, description) VALUES 
        ('p_read', 'inventory.read', 'Read inventory records'),
        ('p_update', 'inventory.update', 'Update inventory records');

      -- Seed Role: Coventry Warehouse Operator (Scoped to warehouseId: COV)
      INSERT INTO core_roles (id, created_at, updated_at, organisation_id, name)
      VALUES ('role_cov_operator', '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z', 'org_acme', 'Coventry Operator');

      INSERT INTO core_role_permissions (id, role_id, permission_id, scope_constraints_json) VALUES 
        ('rp1', 'role_cov_operator', 'p_read', '{"warehouseId":"COV"}'),
        ('rp2', 'role_cov_operator', 'p_update', '{"warehouseId":"COV"}');

      INSERT INTO core_user_roles (id, user_id, role_id, organisation_id, granted_at)
      VALUES ('ur_cov_worker', 'usr_cov_worker', 'role_cov_operator', 'org_acme', '2026-08-30T10:00:00Z');

      INSERT INTO core_sync_groups (id, created_at, updated_at, organisation_id, name, status)
      VALUES ('grp_1', 'now', 'now', 'org_acme', 'Test Group', 'ACTIVE');

      INSERT INTO core_sync_group_members (id, group_id, device_id, user_id, status, joined_at)
      VALUES ('member_widget_authorized', 'grp_1', 'dev_widget_authorized', 'usr_cov_worker', 'APPROVED', 'now');
      INSERT INTO core_devices (id, device_id, status)
      VALUES ('device_widget_authorized', 'dev_widget_authorized', 'ACTIVE');
    `);

    auth = new AuthorizationEngine(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("allows action when subject holds matching scoped permission", async () => {
    const subject = {
      userId: "usr_cov_worker",
      organisationId: "org_acme",
      roles: ["role_cov_operator"],
    };

    const decision = await auth.can(subject, "inventory.read", {
      warehouseId: "COV",
    });
    expect(decision.granted).toBe(true);

    await expect(
      auth.require(subject, "inventory.update", { warehouseId: "COV" }),
    ).resolves.toBeUndefined();
  });

  it("strictly denies action when resource scope mismatches grant (COV grant vs BHM resource)", async () => {
    const subject = {
      userId: "usr_cov_worker",
      organisationId: "org_acme",
      roles: ["role_cov_operator"],
    };

    // User attempts to access Birmingham warehouse with Coventry credentials
    const decision = await auth.can(subject, "inventory.read", {
      warehouseId: "BHM",
    });
    expect(decision.granted).toBe(false);
    if (!decision.granted) {
      expect(decision.code).toBe("SCOPE_MISMATCH");
    }

    // require() throws typed AuthorizationError
    await expect(auth.require(subject, "inventory.update", { warehouseId: "BHM" })).rejects.toThrow(
      AuthorizationError,
    );
  });

  it("fails closed when persisted scope constraints are malformed or not objects", async () => {
    const invalidConstraints = ["not-json", "null", "[]", '"value"', "42"];

    for (const [index, constraints] of invalidConstraints.entries()) {
      const permissionId = `p_invalid_scope_${index}`;
      const permissionName = `inventory.invalid_scope_${index}`;
      const roleId = `role_invalid_scope_${index}`;

      await db.execute("INSERT INTO core_permissions (id, name) VALUES (?, ?)", [
        permissionId,
        permissionName,
      ]);
      await db.execute(
        "INSERT INTO core_roles (id, created_at, updated_at, organisation_id, name) VALUES (?, 'now', 'now', 'org_acme', ?)",
        [roleId, roleId],
      );
      await db.execute(
        "INSERT INTO core_role_permissions (id, role_id, permission_id, scope_constraints_json) VALUES (?, ?, ?, ?)",
        [`rp_invalid_scope_${index}`, roleId, permissionId, constraints],
      );
      await db.execute(
        "INSERT INTO core_user_roles (id, user_id, role_id, organisation_id, granted_at) VALUES (?, 'usr_invalid_scope', ?, 'org_acme', 'now')",
        [`ur_invalid_scope_${index}`, roleId],
      );

      await expect(
        auth.require(
          {
            userId: "usr_invalid_scope",
            organisationId: "org_acme",
            roles: [roleId],
          },
          permissionName,
          { warehouseId: "COV" },
        ),
      ).rejects.toThrow(AuthorizationError);
    }
  });

  it("denies action when user has no matching roles assigned", async () => {
    const unprivilegedSubject = {
      userId: "usr_guest",
      organisationId: "org_acme",
      roles: [],
    };

    const decision = await auth.can(unprivilegedSubject, "inventory.read");
    expect(decision.granted).toBe(false);
    if (!decision.granted) {
      expect(decision.code).toBe("NO_MATCHING_ROLE");
    }
  });

  it("denies a role injected from another organisation", async () => {
    const subject = {
      userId: "usr_attacker",
      organisationId: "org_malicious",
      roles: ["role_cov_operator"],
    };

    const decision = await auth.can(subject, "inventory.read", {
      warehouseId: "COV",
    });

    expect(decision.granted).toBe(false);
    if (!decision.granted) {
      expect(decision.code).toBe("PERMISSION_NOT_GRANTED");
    }
  });

  it("does not resolve a role binding whose organisation differs from its role", async () => {
    await db.execute(
      "INSERT INTO core_roles (id, created_at, updated_at, organisation_id, name) VALUES ('role_other_tenant', 'now', 'now', 'org_other', 'Other Tenant Role')",
    );
    await db.execute(
      "INSERT INTO core_role_permissions (id, role_id, permission_id) VALUES ('rp_other_tenant', 'role_other_tenant', 'p_read')",
    );
    await db.execute(
      "INSERT INTO core_user_roles (id, user_id, role_id, organisation_id, granted_at) VALUES ('ur_mismatched_tenant', 'usr_cov_worker', 'role_other_tenant', 'org_acme', 'now')",
    );

    await expect(
      auth.requireForSubject("usr_cov_worker", "org_acme", "inventory.read"),
    ).rejects.toThrow(AuthorizationError);
  });

  describe("TrustedOperationContext RBAC Enforcement", () => {
    it("grants access to valid TrustedOperationContext holding permissions", async () => {
      const trustedCtx: TrustedOperationContext = {
        correlationId: "op_sec_trusted_valid",
        principal: {
          sessionId: "sess_100",
          userId: "usr_cov_worker",
          deviceId: "dev_cov_1",
          organisationId: "org_acme",
          roles: ["role_cov_operator"],
          authStrength: "offline-session",
        },
      };

      await expect(
        auth.requireTrusted(trustedCtx, "inventory.read", {
          warehouseId: "COV",
        }),
      ).resolves.toBeUndefined();
    });

    it("denies access to TrustedOperationContext when role lacks requested permission", async () => {
      const trustedCtx: TrustedOperationContext = {
        correlationId: "op_sec_trusted_unauth",
        principal: {
          sessionId: "sess_101",
          userId: "usr_cov_worker",
          deviceId: "dev_cov_1",
          organisationId: "org_acme",
          roles: ["role_cov_operator"],
          authStrength: "offline-session",
        },
      };

      await expect(auth.requireTrusted(trustedCtx, "inventory.delete")).rejects.toThrow(
        AuthorizationError,
      );
    });

    it("strictly enforces scope constraints on TrustedOperationContext", async () => {
      const trustedCtx: TrustedOperationContext = {
        correlationId: "op_sec_trusted_scope",
        principal: {
          sessionId: "sess_102",
          userId: "usr_cov_worker",
          deviceId: "dev_cov_1",
          organisationId: "org_acme",
          roles: ["role_cov_operator"],
          authStrength: "offline-session",
        },
      };

      await expect(
        auth.requireTrusted(trustedCtx, "inventory.read", {
          warehouseId: "BHM",
        }),
      ).rejects.toThrow(AuthorizationError);
    });
  });

  describe("Tenant Isolation & Mandatory Authorization in Services", () => {
    it("DeviceIdentityService rejects a peer device ID presented with another public key", async () => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS core_devices (
          id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          created_by TEXT, updated_by TEXT, user_id TEXT, device_id TEXT NOT NULL UNIQUE,
          public_key TEXT NOT NULL, platform TEXT NOT NULL, application_id TEXT NOT NULL,
          status TEXT NOT NULL, registered_at TEXT NOT NULL, last_seen_at TEXT,
          is_local INTEGER NOT NULL DEFAULT 0
        )
      `);
      const deviceIdentity = new DeviceIdentityService(db);
      await deviceIdentity.registerDevice({
        deviceId: "dev_peer_identity",
        publicKey: "trusted-peer-key",
        platform: "linux",
        applicationId: "peer-app",
      });

      await expect(
        deviceIdentity.registerDevice({
          deviceId: "dev_peer_identity",
          publicKey: "substituted-key",
          platform: "linux",
          applicationId: "peer-app",
        }),
      ).rejects.toThrow("different public key");

      const rows = await db.query<{ public_key: string }>(
        "SELECT public_key FROM core_devices WHERE device_id = ?",
        ["dev_peer_identity"],
      );
      expect(rows[0]?.public_key).toBe("trusted-peer-key");
    });

    it("SyncGroupService strictly rejects cross-tenant group creation", async () => {
      const syncService = new SyncGroupService(db, auth);
      const ctx = createOperationContext({
        userId: "usr_attacker",
        deviceId: "dev_attacker_1",
        organisationId: "org_attacker",
      });

      await expect(
        syncService.createGroup(
          {
            name: "Compromised Group",
            organisationId: "org_victim",
          },
          ctx,
        ),
      ).rejects.toThrow("Cross-tenant sync group creation forbidden");
    });

    it("SyncGroupService strictly rejects group creation when context lacks sync.manage", async () => {
      const syncService = new SyncGroupService(db, auth);
      const ctx = createOperationContext({
        userId: "usr_cov_worker",
        deviceId: "dev_cov_1",
        organisationId: "org_acme",
      });

      await expect(
        syncService.createGroup(
          {
            name: "Unauthorised Group",
            organisationId: "org_acme",
          },
          ctx,
        ),
      ).rejects.toThrow(AuthorizationError);
    });

    it("IdentityAdminService strictly rejects cross-tenant user creation", async () => {
      const identityService = new IdentityAdminService(db, undefined, undefined, auth);
      const ctx = createOperationContext({
        userId: "usr_attacker",
        deviceId: "dev_attacker_1",
        organisationId: "org_attacker",
      });

      await expect(
        identityService.createUser(
          {
            organisationId: "org_victim",
            displayName: "Illegitimate User",
          },
          ctx,
        ),
      ).rejects.toThrow("Cross-tenant user creation forbidden");
    });

    it("IdentityAdminService strictly rejects user creation without users.create permission", async () => {
      const identityService = new IdentityAdminService(db, undefined, undefined, auth);
      const ctx = createOperationContext({
        userId: "usr_cov_worker",
        deviceId: "dev_cov_1",
        organisationId: "org_acme",
      });

      await expect(
        identityService.createUser(
          {
            organisationId: "org_acme",
            displayName: "Operator Sam",
          },
          ctx,
        ),
      ).rejects.toThrow(AuthorizationError);
    });

    it("IdentityAdminService requires roles.manage before assigning a role", async () => {
      await db.execute(
        "INSERT INTO core_permissions (id, name) VALUES ('p_users_create', 'users.create')",
      );
      await db.execute(
        "INSERT INTO core_role_permissions (id, role_id, permission_id) VALUES ('rp_users_create', 'role_cov_operator', 'p_users_create')",
      );
      const identityService = new IdentityAdminService(db, undefined, undefined, auth);
      const ctx = createOperationContext({
        userId: "usr_cov_worker",
        deviceId: "dev_cov_1",
        organisationId: "org_acme",
      });

      await expect(
        identityService.createUser(
          {
            organisationId: "org_acme",
            displayName: "Privilege Escalation",
            roleId: "role_cov_operator",
          },
          ctx,
        ),
      ).rejects.toThrow("roles.manage");

      const users = await db.query<{ id: string }>(
        "SELECT id FROM core_users WHERE display_name = ?",
        ["Privilege Escalation"],
      );
      expect(users).toHaveLength(0);
    });

    it("IdentityAdminService rejects approval or revocation for an unregistered device", async () => {
      await db.execute(
        "CREATE TABLE IF NOT EXISTS core_devices (device_id TEXT PRIMARY KEY, status TEXT NOT NULL)",
      );
      for (const [permissionId, permissionName] of [
        ["p_devices_approve", "devices.approve"],
        ["p_devices_revoke", "devices.revoke"],
      ]) {
        await db.execute("INSERT INTO core_permissions (id, name) VALUES (?, ?)", [
          permissionId,
          permissionName,
        ]);
        await db.execute(
          "INSERT INTO core_role_permissions (id, role_id, permission_id) VALUES (?, 'role_cov_operator', ?)",
          [`rp_${permissionId}`, permissionId],
        );
      }
      const identityService = new IdentityAdminService(db, undefined, undefined, auth);
      const ctx = createOperationContext({
        userId: "usr_cov_worker",
        deviceId: "dev_cov_1",
        organisationId: "org_acme",
      });

      await expect(
        identityService.approveDevice("dev_missing", "req_missing", ctx),
      ).rejects.toThrow("ineligible for approval");
      await expect(
        identityService.revokeDevice("dev_missing", "grp_1", "No registered device", ctx),
      ).rejects.toThrow("does not exist");
    });

    it("SyncGroupService cannot approve a device other than the one on the request", async () => {
      await db.execute(`
        CREATE TABLE core_membership_requests (
          id TEXT PRIMARY KEY, device_id TEXT NOT NULL, group_id TEXT NOT NULL,
          user_id TEXT, requested_at TEXT NOT NULL, status TEXT NOT NULL
        );
        CREATE TABLE core_membership_decisions (
          id TEXT PRIMARY KEY, request_id TEXT NOT NULL, decided_by TEXT NOT NULL,
          decision TEXT NOT NULL, decided_at TEXT NOT NULL, signature TEXT
        );
      `);
      await db.execute(
        "INSERT INTO core_permissions (id, name) VALUES ('p_sync_manage', 'sync.manage')",
      );
      await db.execute(
        "INSERT INTO core_role_permissions (id, role_id, permission_id) VALUES ('rp_sync_manage', 'role_cov_operator', 'p_sync_manage')",
      );
      await db.execute(
        "INSERT INTO core_membership_requests (id, device_id, group_id, requested_at, status) VALUES ('req_device_target', 'dev_expected', 'grp_1', 'now', 'PENDING')",
      );
      const syncService = new SyncGroupService(db, auth);
      const ctx = createOperationContext({
        userId: "usr_cov_worker",
        deviceId: "dev_cov_1",
        organisationId: "org_acme",
      });

      await expect(
        syncService.approveMembership("req_device_target", ctx, undefined, undefined, "dev_other"),
      ).rejects.toThrow("different device");

      const request = await db.query<{ status: string }>(
        "SELECT status FROM core_membership_requests WHERE id = ?",
        ["req_device_target"],
      );
      const membership = await db.query<{ id: string }>(
        "SELECT id FROM core_sync_group_members WHERE group_id = ? AND device_id = ?",
        ["grp_1", "dev_expected"],
      );
      expect(request[0]?.status).toBe("PENDING");
      expect(membership).toHaveLength(0);

      await db.execute("UPDATE core_membership_requests SET status = 'APPROVED' WHERE id = ?", [
        "req_device_target",
      ]);
      await db.execute(
        "INSERT INTO core_sync_group_members (id, group_id, device_id, user_id, status, joined_at) VALUES ('member_device_target', 'grp_1', 'dev_expected', 'usr_cov_worker', 'APPROVED', 'now')",
      );
      await expect(
        syncService.rejectMembership("req_device_target", ctx, "conflicting decision"),
      ).rejects.toThrow("not pending");
      const decisions = await db.query<{ id: string }>(
        "SELECT id FROM core_membership_decisions WHERE request_id = ?",
        ["req_device_target"],
      );
      expect(decisions).toHaveLength(0);
    });

    it("SyncGroupService cannot revoke a device with no membership in the selected group", async () => {
      await db.execute(`
        CREATE TABLE core_revocations (
          id TEXT PRIMARY KEY, device_id TEXT NOT NULL, group_id TEXT NOT NULL,
          revoked_by TEXT NOT NULL, revoked_at TEXT NOT NULL, reason TEXT NOT NULL
        )
      `);
      await db.execute(
        "INSERT INTO core_permissions (id, name) VALUES ('p_sync_manage', 'sync.manage')",
      );
      await db.execute(
        "INSERT INTO core_role_permissions (id, role_id, permission_id) VALUES ('rp_sync_manage', 'role_cov_operator', 'p_sync_manage')",
      );
      const syncService = new SyncGroupService(db, auth);
      const ctx = createOperationContext({
        userId: "usr_cov_worker",
        deviceId: "dev_cov_1",
        organisationId: "org_acme",
      });

      await expect(
        syncService.revokeMembership("dev_unrelated", "grp_1", ctx, "No approved membership"),
      ).rejects.toThrow("not an active member");

      const revocations = await db.query<{ id: string }>(
        "SELECT id FROM core_revocations WHERE device_id = ?",
        ["dev_unrelated"],
      );
      expect(revocations).toHaveLength(0);
    });

    it("denies sync-group access after global device revocation leaves another membership active", async () => {
      await db.execute(`
        CREATE TABLE core_revocations (
          id TEXT PRIMARY KEY, device_id TEXT NOT NULL, group_id TEXT,
          revoked_by TEXT NOT NULL, revoked_at TEXT NOT NULL, reason TEXT NOT NULL,
          propagated INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO core_sync_groups
          (id, created_at, updated_at, organisation_id, name, status)
        VALUES ('grp_2', 'now', 'now', 'org_acme', 'Second Group', 'ACTIVE');
        INSERT INTO core_devices (id, device_id, status, updated_at)
        VALUES ('device_revoked', 'dev_revoked', 'ACTIVE', 'now');
        INSERT INTO core_sync_group_members
          (id, group_id, device_id, user_id, status, joined_at)
        VALUES ('member_revoke_1', 'grp_1', 'dev_revoked', 'usr_cov_worker', 'ACTIVE', 'now'),
               ('member_revoke_2', 'grp_2', 'dev_revoked', 'usr_cov_worker', 'ACTIVE', 'now');
      `);
      await db.execute(
        "INSERT INTO core_permissions (id, name) VALUES ('p_devices_revoke', 'devices.revoke')",
      );
      await db.execute(
        "INSERT INTO core_role_permissions (id, role_id, permission_id) VALUES ('rp_devices_revoke', 'role_cov_operator', 'p_devices_revoke')",
      );

      const service = new IdentityAdminService(db, undefined, undefined, auth);
      const administratorContext = createOperationContext({
        userId: "usr_cov_worker",
        deviceId: "dev_cov_1",
        organisationId: "org_acme",
      });
      await service.revokeDevice(
        "dev_revoked",
        "grp_1",
        "Device reported stolen",
        administratorContext,
      );

      const stillActiveMembership = await db.query<{ status: string }>(
        "SELECT status FROM core_sync_group_members WHERE device_id = ? AND group_id = ?",
        ["dev_revoked", "grp_2"],
      );
      expect(stillActiveMembership[0]?.status).toBe("ACTIVE");
      expect(await new SyncGroupService(db, auth).canSync("dev_revoked", "grp_2")).toBe(false);

      const revokedDeviceContext = createOperationContext({
        userId: "usr_cov_worker",
        deviceId: "dev_revoked",
        organisationId: "org_acme",
      });
      await expect(
        new SyncGroupService(db, auth).requireActiveMembership(revokedDeviceContext, "grp_2"),
      ).rejects.toThrow("not approved for sync");
    });

    it("does not approve a suspended device through a pending group request", async () => {
      await db.execute(
        "INSERT INTO core_devices (id, device_id, status) VALUES ('device_suspended', 'dev_suspended', 'SUSPENDED')",
      );
      await db.execute(
        "INSERT INTO core_permissions (id, name) VALUES ('p_devices_approve', 'devices.approve')",
      );
      await db.execute(
        "INSERT INTO core_role_permissions (id, role_id, permission_id) VALUES ('rp_devices_approve', 'role_cov_operator', 'p_devices_approve')",
      );
      const service = new IdentityAdminService(db, undefined, undefined, auth);
      const administratorContext = createOperationContext({
        userId: "usr_cov_worker",
        deviceId: "dev_cov_1",
        organisationId: "org_acme",
      });

      await expect(
        service.approveDevice(
          "dev_suspended",
          "request_not_needed_for_status_gate",
          administratorContext,
        ),
      ).rejects.toThrow("missing or ineligible for approval");

      const device = await db.query<{ status: string }>(
        "SELECT status FROM core_devices WHERE device_id = ?",
        ["dev_suspended"],
      );
      expect(device[0]?.status).toBe("SUSPENDED");
    });

    it("WidgetService strictly rejects widget creation when context lacks widgets.create", async () => {
      const widgetService = new WidgetService(db, auth);
      const ctx = createOperationContext({
        userId: "usr_cov_worker",
        deviceId: "dev_cov_1",
        organisationId: "org_acme",
      });

      await expect(
        widgetService.createWidget(
          {
            name: "Unauthorized Widget",
            sku: "UNAUTH-SKU-1",
            quantity: 10,
            syncGroupId: "grp_1",
          },
          ctx,
        ),
      ).rejects.toThrow(AuthorizationError);
    });

    it("WidgetService denies writes to a same-tenant sync group without device membership", async () => {
      await db.execute(`
        CREATE TABLE widgets (
          id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          created_by TEXT, updated_by TEXT, entity_id TEXT NOT NULL,
          organisation_id TEXT NOT NULL, sync_group_id TEXT NOT NULL,
          schema_version INTEGER NOT NULL, sync_version INTEGER NOT NULL,
          deleted_at TEXT, deleted_by TEXT, delete_operation_id TEXT,
          data_classification TEXT NOT NULL, name TEXT NOT NULL, sku TEXT NOT NULL UNIQUE,
          quantity INTEGER NOT NULL, description TEXT
        )
      `);
      await db.execute(
        "INSERT INTO core_permissions (id, name) VALUES ('p_widget_create', 'widgets.create')",
      );
      await db.execute(
        "INSERT INTO core_role_permissions (id, role_id, permission_id) VALUES ('rp_widget_create', 'role_cov_operator', 'p_widget_create')",
      );
      for (const [permissionId, permissionName] of [
        ["p_widget_read", "widgets.read"],
        ["p_widget_update", "widgets.update"],
        ["p_widget_delete", "widgets.delete"],
      ]) {
        await db.execute("INSERT INTO core_permissions (id, name) VALUES (?, ?)", [
          permissionId,
          permissionName,
        ]);
        await db.execute(
          "INSERT INTO core_role_permissions (id, role_id, permission_id) VALUES (?, 'role_cov_operator', ?)",
          [`rp_${permissionId}`, permissionId],
        );
      }
      const widgetService = new WidgetService(db, auth);
      const ctx = createOperationContext({
        userId: "usr_cov_worker",
        deviceId: "dev_cov_1",
        organisationId: "org_acme",
      });

      await expect(
        widgetService.createWidget(
          {
            name: "Unapproved group widget",
            sku: "GROUP-DENIED-01",
            quantity: 1,
            syncGroupId: "grp_1",
          },
          ctx,
        ),
      ).rejects.toThrow("not an approved member");

      const authorizedCtx = createOperationContext({
        userId: "usr_cov_worker",
        deviceId: "dev_widget_authorized",
        organisationId: "org_acme",
      });
      const widget = await widgetService.createWidget(
        { name: "Authorized widget", sku: "GROUP-OK-01", quantity: 2, syncGroupId: "grp_1" },
        authorizedCtx,
      );

      await expect(widgetService.updateWidget(widget.id, { quantity: 99 }, ctx)).rejects.toThrow(
        "not an approved member",
      );
      await expect(widgetService.deleteWidget(widget.id, ctx)).rejects.toThrow(
        "not an approved member",
      );
      await expect(widgetService.getWidgetById(widget.id, authorizedCtx)).resolves.toEqual(
        expect.objectContaining({ quantity: 2, deletedAt: null }),
      );
      await widgetService.deleteWidget(widget.id, authorizedCtx);
      await expect(widgetService.getWidgetById(widget.id, authorizedCtx)).resolves.toBeNull();
    });

    it("OrganisationService preserves data when an unauthorised update is denied", async () => {
      await db.execute(`
        CREATE TABLE core_organisations (
          id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          created_by TEXT, updated_by TEXT, name TEXT NOT NULL, domain TEXT,
          status TEXT NOT NULL DEFAULT 'ACTIVE', settings_json TEXT
        )
      `);
      await db.execute(
        "INSERT INTO core_organisations (id, created_at, updated_at, name) VALUES ('org_acme', 'now', 'now', 'Acme')",
      );
      const organisationService = new OrganisationService(db, auth);
      const unauthorizedCtx = createOperationContext({
        userId: "usr_without_manage",
        deviceId: "dev_unprivileged",
        organisationId: "org_acme",
      });

      await expect(
        organisationService.updateOrganisation(
          "org_acme",
          { name: "Compromised" },
          unauthorizedCtx,
        ),
      ).rejects.toThrow("Authorization failed");
      const rows = await db.query<{ name: string }>(
        "SELECT name FROM core_organisations WHERE id = ?",
        ["org_acme"],
      );
      expect(rows[0]?.name).toBe("Acme");
    });
  });
});
