import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { createOperationContext } from "@platform/core";
import {
  AuthorizationEngine,
  SyncGroupService,
  ScopeEvaluator,
} from "./index.js";

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
      expect(ScopeEvaluator.matches(undefined, { warehouseId: "COV" })).toBe(
        true,
      );
      expect(ScopeEvaluator.matches({}, { warehouseId: "COV" })).toBe(true);
      expect(
        ScopeEvaluator.matches({ warehouseId: "COV" }, { warehouseId: "COV" }),
      ).toBe(true);
      expect(
        ScopeEvaluator.matches({ warehouseId: "COV" }, { warehouseId: "BHM" }),
      ).toBe(false);
      expect(ScopeEvaluator.matches({ warehouseId: "COV" }, undefined)).toBe(
        false,
      );
    });
  });

  describe("AuthorizationEngine", () => {
    it("grants permission when subject holds role with matching permission and scope", async () => {
      // Seed permissions & roles
      await db.execute(
        "INSERT INTO core_permissions (id, name) VALUES ('p1', 'inventory.read');",
      );
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
      await expect(
        authEngine.require(subject, "inventory.create"),
      ).rejects.toThrow("Authorization failed");

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
  });

  describe("SyncGroupService", () => {
    it("manages sync group lifecycle: request -> approve -> canSync -> revoke", async () => {
      const ctx = createOperationContext({
        deviceId: "dev_1",
        organisationId: "org_1",
      });
      const group = await syncGroupService.createGroup(
        { name: "Coventry Warehouse", organisationId: "org_1" },
        ctx,
      );

      expect(group.id.startsWith("grp_")).toBe(true);

      // Before request: cannot sync
      expect(await syncGroupService.canSync("dev_tablet", group.id)).toBe(
        false,
      );

      // Request membership
      const reqId = await syncGroupService.requestMembership(
        group.id,
        "dev_tablet",
        "user_op",
      );

      // Approve membership
      await syncGroupService.approveMembership(reqId, "user_admin");

      // Now can sync
      expect(await syncGroupService.canSync("dev_tablet", group.id)).toBe(true);

      // Revoke membership
      await syncGroupService.revokeMembership(
        "dev_tablet",
        group.id,
        "user_admin",
        "Device lost",
      );

      // Cannot sync after revocation
      expect(await syncGroupService.canSync("dev_tablet", group.id)).toBe(
        false,
      );
    });

    it("rejects a pending membership request", async () => {
      const ctx = createOperationContext({
        deviceId: "dev_1",
        organisationId: "org_1",
      });
      const group = await syncGroupService.createGroup(
        { name: "Birmingham Warehouse", organisationId: "org_1" },
        ctx,
      );

      const reqId = await syncGroupService.requestMembership(
        group.id,
        "dev_rejected",
        "user_op",
      );

      await syncGroupService.rejectMembership(
        reqId,
        "user_admin",
        "Not authorised for this site",
      );

      // Rejected device cannot sync
      expect(await syncGroupService.canSync("dev_rejected", group.id)).toBe(
        false,
      );
    });
  });
});
