import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { createOperationContext } from "@platform/core";
import { AuthorizationEngine, SyncGroupService, ScopeEvaluator } from "./index.js";

describe("@platform/authorization", () => {
  let db: MemoryDatabaseConnection;
  let authEngine: AuthorizationEngine;
  let syncGroupService: SyncGroupService;

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
        status TEXT NOT NULL DEFAULT 'REQUESTED',
        joined_at TEXT NOT NULL,
        revoked_at TEXT,
        revoked_by TEXT,
        revocation_reason TEXT
      );
      CREATE TABLE core_devices (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL
      );
      CREATE TABLE core_membership_requests (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        user_id TEXT,
        requested_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING'
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
        reason TEXT NOT NULL,
        propagated INTEGER NOT NULL DEFAULT 0
      );
    `);

    authEngine = new AuthorizationEngine(db);
    syncGroupService = new SyncGroupService(db);
  });

  afterEach(async () => {
    await db.close();
  });

  describe("ScopeEvaluator", () => {
    it("evaluates scope matching correctly", () => {
      expect(ScopeEvaluator.matches(undefined, { warehouseId: "COV" })).toBe(true);
      expect(ScopeEvaluator.matches({}, { warehouseId: "COV" })).toBe(true);
      expect(ScopeEvaluator.matches({ warehouseId: "COV" }, { warehouseId: "COV" })).toBe(true);
      expect(ScopeEvaluator.matches({ warehouseId: "COV" }, { warehouseId: "BHM" })).toBe(false);
      expect(ScopeEvaluator.matches({ warehouseId: "COV" }, undefined)).toBe(false);
    });
  });

  describe("AuthorizationEngine", () => {
    it("fails closed for malformed or non-object permission scope constraints", async () => {
      const invalidConstraints = ["not-json", "", "null", "[]", '"value"', "42", "false"];

      for (const [index, constraints] of invalidConstraints.entries()) {
        const roleId = `invalid_scope_role_${index}`;
        const permissionId = `invalid_scope_permission_${index}`;
        const permissionName = `invalid.scope.${index}`;

        await db.execute("INSERT INTO core_permissions (id, name) VALUES (?, ?)", [
          permissionId,
          permissionName,
        ]);
        await db.execute(
          "INSERT INTO core_roles (id, created_at, updated_at, organisation_id, name) VALUES (?, 'now', 'now', 'org_1', ?)",
          [roleId, roleId],
        );
        await db.execute(
          "INSERT INTO core_role_permissions (id, role_id, permission_id, scope_constraints_json) VALUES (?, ?, ?, ?)",
          [`rp_${index}`, roleId, permissionId, constraints],
        );
        await db.execute(
          "INSERT INTO core_user_roles (id, user_id, role_id, organisation_id, granted_at) VALUES (?, 'user_invalid_scope', ?, 'org_1', 'now')",
          [`ur_${index}`, roleId],
        );

        const decision = await authEngine.can(
          {
            userId: "user_invalid_scope",
            organisationId: "org_1",
            roles: [roleId],
          },
          permissionName,
          { warehouseId: "COV" },
        );

        expect(decision).toMatchObject({ granted: false, code: "PERMISSION_NOT_GRANTED" });
      }
    });

    it("grants permission when subject holds role with matching permission and scope", async () => {
      // Seed permissions & roles
      await db.execute("INSERT INTO core_permissions (id, name) VALUES ('p1', 'inventory.read');");
      await db.execute(
        "INSERT INTO core_permissions (id, name) VALUES ('p2', 'inventory.create');",
      );
      await db.execute(
        "INSERT INTO core_roles (id, created_at, updated_at, organisation_id, name) VALUES ('r1', '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z', 'org_1', 'Warehouse Operator');",
      );

      // r1 has inventory.read scoped to warehouseId: COV
      await db.execute(
        `INSERT INTO core_role_permissions (id, role_id, permission_id, scope_constraints_json) VALUES ('rp1', 'r1', 'p1', '{"warehouseId":"COV"}');`,
      );
      await db.execute(
        "INSERT INTO core_user_roles (id, user_id, role_id, organisation_id, granted_at) VALUES ('ur1', 'u1', 'r1', 'org_1', '2026-08-30T10:00:00Z');",
      );

      const subject = {
        userId: "u1",
        organisationId: "org_1",
        roles: ["r1"],
      };

      // Allowed for COV
      const covDecision = await authEngine.can(subject, "inventory.read", {
        warehouseId: "COV",
      });
      expect(covDecision.granted).toBe(true);

      // Denied for BHM
      const bhmDecision = await authEngine.can(subject, "inventory.read", {
        warehouseId: "BHM",
      });
      expect(bhmDecision.granted).toBe(false);
      if (!bhmDecision.granted) {
        expect(bhmDecision.code).toBe("SCOPE_MISMATCH");
      }

      // Denied for unheld permission
      const createDecision = await authEngine.can(subject, "inventory.create");
      expect(createDecision.granted).toBe(false);
      if (!createDecision.granted) {
        expect(createDecision.code).toBe("PERMISSION_NOT_GRANTED");
      }

      // require() throws on denial
      await expect(authEngine.require(subject, "inventory.create")).rejects.toThrow(
        "Authorization failed",
      );

      await expect(
        authEngine.requireTrusted(
          {
            correlationId: "op_trusted_test",
            principal: {
              sessionId: "sess_1",
              userId: "u1",
              deviceId: "dev_1",
              organisationId: "org_1",
              roles: ["r1"],
              authStrength: "offline-session",
            },
          },
          "inventory.read",
          { warehouseId: "COV" },
        ),
      ).resolves.toBeUndefined();

      await expect(
        authEngine.requireTrusted(
          {
            correlationId: "op_trusted_denied",
            principal: {
              sessionId: "sess_1",
              userId: "u1",
              deviceId: "dev_1",
              organisationId: "org_1",
              roles: ["r1"],
              authStrength: "offline-session",
            },
          },
          "inventory.read",
          { warehouseId: "BHM" },
        ),
      ).rejects.toThrow("Authorization failed");
    });

    it("resolves subject roles through organisation-owned role bindings", async () => {
      await db.execute("INSERT INTO core_permissions (id, name) VALUES ('p_other', 'other.read')");
      await db.execute(
        "INSERT INTO core_roles (id, created_at, updated_at, organisation_id, name) VALUES ('r_other_org', 'now', 'now', 'org_other', 'Other Organisation Role')",
      );
      await db.execute(
        "INSERT INTO core_role_permissions (id, role_id, permission_id) VALUES ('rp_other', 'r_other_org', 'p_other')",
      );
      await db.execute(
        "INSERT INTO core_user_roles (id, user_id, role_id, organisation_id, granted_at) VALUES ('ur_wrong_org', 'u1', 'r_other_org', 'org_1', 'now')",
      );

      await expect(authEngine.requireForSubject("u1", "org_1", "other.read")).rejects.toThrow(
        "Authorization failed",
      );
    });
  });

  describe("SyncGroupService", () => {
    beforeEach(async () => {
      await db.execute("INSERT INTO core_permissions (id, name) VALUES ('p_sync', 'sync.manage');");
      await db.execute(
        "INSERT INTO core_roles (id, created_at, updated_at, organisation_id, name) VALUES ('r_admin', '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z', 'org_1', 'Sync Admin');",
      );
      await db.execute(
        "INSERT INTO core_role_permissions (id, role_id, permission_id) VALUES ('rp_sync', 'r_admin', 'p_sync');",
      );
      await db.execute(
        "INSERT INTO core_user_roles (id, user_id, role_id, organisation_id, granted_at) VALUES ('ur_admin', 'user_admin', 'r_admin', 'org_1', '2026-08-30T10:00:00Z');",
      );
    });

    it("manages sync group lifecycle: request -> approve -> canSync -> revoke", async () => {
      await db.execute(
        "INSERT INTO core_devices (id, device_id, status) VALUES ('device_tablet', 'dev_tablet', 'APPROVED')",
      );
      const ctx = createOperationContext({
        userId: "user_admin",
        deviceId: "dev_1",
        organisationId: "org_1",
      });
      const group = await syncGroupService.createGroup(
        { name: "Coventry Warehouse", organisationId: "org_1" },
        ctx,
      );

      expect(group.id.startsWith("grp_")).toBe(true);

      // Before request: cannot sync
      expect(await syncGroupService.canSync("dev_tablet", group.id)).toBe(false);

      // Request membership
      const reqId = await syncGroupService.requestMembership(group.id, "dev_tablet", "user_op");

      // Approve membership with authorized ctx
      await syncGroupService.approveMembership(reqId, ctx);

      // Now can sync
      expect(await syncGroupService.canSync("dev_tablet", group.id)).toBe(true);
      const memberContext = createOperationContext({
        userId: "user_op",
        deviceId: "dev_tablet",
        organisationId: "org_1",
      });
      await expect(
        syncGroupService.requireActiveMembership(memberContext, group.id),
      ).resolves.toBeUndefined();
      const mismatchedUserContext = createOperationContext({
        userId: "user_other",
        deviceId: "dev_tablet",
        organisationId: "org_1",
      });
      await expect(
        syncGroupService.requireActiveMembership(mismatchedUserContext, group.id),
      ).rejects.toThrow("not an approved member");

      // Revoke membership with authorized ctx
      await syncGroupService.revokeMembership("dev_tablet", group.id, ctx, "Device lost");

      // Cannot sync after revocation
      expect(await syncGroupService.canSync("dev_tablet", group.id)).toBe(false);
    });

    it("rejects a pending membership request", async () => {
      const ctx = createOperationContext({
        userId: "user_admin",
        deviceId: "dev_1",
        organisationId: "org_1",
      });
      const group = await syncGroupService.createGroup(
        { name: "Birmingham Warehouse", organisationId: "org_1" },
        ctx,
      );

      const reqId = await syncGroupService.requestMembership(group.id, "dev_rejected", "user_op");

      await syncGroupService.rejectMembership(reqId, ctx, "Not authorised for this site");

      // Rejected device cannot sync
      expect(await syncGroupService.canSync("dev_rejected", group.id)).toBe(false);
    });

    it("rejects group creation when context lacks sync.manage permission", async () => {
      const unauthorizedCtx = createOperationContext({
        userId: "user_nobody",
        deviceId: "dev_2",
        organisationId: "org_1",
      });

      await expect(
        syncGroupService.createGroup(
          { name: "Secret Warehouse", organisationId: "org_1" },
          unauthorizedCtx,
        ),
      ).rejects.toThrow("Authorization failed");
    });

    it("rejects cross-tenant sync group creation", async () => {
      const ctx = createOperationContext({
        userId: "user_admin",
        deviceId: "dev_1",
        organisationId: "org_1",
      });

      await expect(
        syncGroupService.createGroup({ name: "Other Org Group", organisationId: "org_2" }, ctx),
      ).rejects.toThrow("Cross-tenant sync group creation forbidden");
    });
  });
});
