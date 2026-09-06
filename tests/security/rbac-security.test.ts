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
    await expect(
      auth.require(subject, "inventory.update", { warehouseId: "BHM" }),
    ).rejects.toThrow(AuthorizationError);
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

      await expect(
        auth.requireTrusted(trustedCtx, "inventory.delete"),
      ).rejects.toThrow(AuthorizationError);
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
      const identityService = new IdentityAdminService(
        db,
        undefined,
        undefined,
        auth,
      );
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
      const identityService = new IdentityAdminService(
        db,
        undefined,
        undefined,
        auth,
      );
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
  });
});
