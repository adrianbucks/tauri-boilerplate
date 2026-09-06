import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { AuthorizationEngine } from "@platform/authorization";
import { AuthorizationError } from "@platform/core";

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
});
