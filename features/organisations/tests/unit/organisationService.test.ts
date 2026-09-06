import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { createOperationContext } from "@platform/core";
import { OrganisationService } from "../../src/services/organisationService.js";

import { ORGANISATION_PERMISSIONS } from "../../src/permissions.js";

describe("@features/organisations", () => {
  let db: MemoryDatabaseConnection;
  let service: OrganisationService;
  const ctx = createOperationContext({
    deviceId: "dev_1",
    organisationId: "org_root",
    userId: "user_admin",
  });
  const otherOrganisationCtx = createOperationContext({
    deviceId: "dev_2",
    organisationId: "org_other",
    userId: "user_other",
  });

  async function grantOrgPermissions(
    database: MemoryDatabaseConnection,
    userId: string,
    organisationId: string,
  ) {
    const roleId = `role_${organisationId}_admin`;
    await database.execute(
      `INSERT OR IGNORE INTO core_roles (id, created_at, updated_at, organisation_id, name)
       VALUES (?, '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z', ?, 'Admin')`,
      [roleId, organisationId],
    );
    for (const perm of [
      ORGANISATION_PERMISSIONS.CREATE,
      ORGANISATION_PERMISSIONS.READ,
      ORGANISATION_PERMISSIONS.MANAGE,
    ]) {
      await database.execute(
        `INSERT OR IGNORE INTO core_permissions (id, name) VALUES (?, ?)`,
        [perm, perm],
      );
      await database.execute(
        `INSERT OR IGNORE INTO core_role_permissions (id, role_id, permission_id) VALUES (?, ?, ?)`,
        [`${roleId}_${perm}`, roleId, perm],
      );
    }
    await database.execute(
      `INSERT OR IGNORE INTO core_user_roles (id, user_id, role_id, organisation_id, granted_at)
       VALUES (?, ?, ?, ?, '2026-08-30T10:00:00Z')`,
      [`ur_${userId}_${organisationId}`, userId, roleId, organisationId],
    );
  }

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
      CREATE TABLE core_organisations (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT,
        updated_by TEXT,
        name TEXT NOT NULL,
        domain TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        settings_json TEXT
      );
    `);

    await grantOrgPermissions(db, "user_admin", "org_root");
    await grantOrgPermissions(db, "user_other", "org_other");

    service = new OrganisationService(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("creates organisation tenancy with unique domain", async () => {
    const org = await service.createOrganisation(
      {
        name: "Acme Logistics Ltd",
        domain: "acme.com",
        settings: { timezone: "Europe/London" },
      },
      ctx,
    );

    expect(org.id.startsWith("org_")).toBe(true);
    expect(org.name).toBe("Acme Logistics Ltd");
    expect(org.domain).toBe("acme.com");

    // Reject duplicate domain
    await expect(
      service.createOrganisation(
        { name: "Acme Corp", domain: "acme.com" },
        ctx,
      ),
    ).rejects.toThrow("already exists");
  });

  it("updates organisation name and settings", async () => {
    const org = await service.createOrganisation(
      { name: "Beta Corp", domain: "beta.com" },
      ctx,
    );
    await grantOrgPermissions(db, ctx.userId!, org.id);

    const organisationCtx = createOperationContext({
      deviceId: ctx.deviceId,
      organisationId: org.id,
      userId: ctx.userId,
    });

    const updated = await service.updateOrganisation(
      org.id,
      { name: "Beta Holdings Ltd" },
      organisationCtx,
    );

    expect(updated.name).toBe("Beta Holdings Ltd");
    expect(updated.domain).toBe("beta.com");
  });

  it("scopes organisation reads and updates to the operation context", async () => {
    const own = await service.createOrganisation(
      { name: "Org A", domain: "a.com" },
      ctx,
    );
    const other = await service.createOrganisation(
      { name: "Org B", domain: "b.com" },
      otherOrganisationCtx,
    );
    await grantOrgPermissions(db, ctx.userId!, own.id);

    const ownOrganisationCtx = createOperationContext({
      deviceId: ctx.deviceId,
      organisationId: own.id,
      userId: ctx.userId,
    });

    const orgs = await service.listOrganisations(ownOrganisationCtx);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.id).toBe(own.id);
    await expect(
      service.getOrganisationById(other.id, ownOrganisationCtx),
    ).resolves.toBeNull();
    await expect(
      service.updateOrganisation(
        other.id,
        { name: "Tampered" },
        ownOrganisationCtx,
      ),
    ).rejects.toThrow("not found");
  });

  it("rejects operations when context lacks required permissions", async () => {
    const unprivilegedCtx = createOperationContext({
      deviceId: "dev_unprivileged",
      organisationId: "org_root",
      userId: "user_unprivileged",
    });

    await expect(
      service.createOrganisation(
        { name: "Unauthorized Org", domain: "unauth.com" },
        unprivilegedCtx,
      ),
    ).rejects.toThrow("Authorization failed");
  });
});
