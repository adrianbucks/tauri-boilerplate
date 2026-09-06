import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection, MigrationEngine } from "@platform/database";
import { createOperationContext } from "@platform/core";
import { WidgetService } from "../../src/services/widgetService.js";
import { exampleFeatureManifest } from "../../src/manifest.js";

import { WIDGET_PERMISSIONS } from "../../src/permissions.js";

describe("@features/example-feature", () => {
  let db: MemoryDatabaseConnection;
  let service: WidgetService;
  const ctx = createOperationContext({
    deviceId: "dev_laptop_1",
    organisationId: "org_acme",
    userId: "user_alice",
  });
  const otherOrganisationCtx = createOperationContext({
    deviceId: "dev_laptop_2",
    organisationId: "org_other",
    userId: "user_bob",
  });

  async function grantWidgetPermissions(
    database: MemoryDatabaseConnection,
    userId: string,
    organisationId: string,
  ) {
    const roleId = `role_${organisationId}_manager`;
    await database.execute(
      `INSERT OR IGNORE INTO core_roles (id, created_at, updated_at, organisation_id, name)
       VALUES (?, '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z', ?, 'Widget Manager')`,
      [roleId, organisationId],
    );
    for (const perm of [
      WIDGET_PERMISSIONS.CREATE,
      WIDGET_PERMISSIONS.READ,
      WIDGET_PERMISSIONS.UPDATE,
      WIDGET_PERMISSIONS.DELETE,
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
    `);

    // Apply feature migration
    const engine = new MigrationEngine(db);
    await engine.applyMigrations(exampleFeatureManifest.migrations);

    await grantWidgetPermissions(db, "user_alice", "org_acme");
    await grantWidgetPermissions(db, "user_bob", "org_other");

    service = new WidgetService(db);
  });

  afterEach(async () => {
    await db.close();
  });

  describe("WidgetService", () => {
    it("creates widget successfully with uppercase SKU and auto-generated ID", async () => {
      const widget = await service.createWidget(
        {
          name: "Steel Bolt M8",
          sku: "bolt-m8",
          quantity: 150,
          syncGroupId: "grp_coventry",
        },
        ctx,
      );

      expect(widget.id.startsWith("wid_")).toBe(true);
      expect(widget.sku).toBe("BOLT-M8");
      expect(widget.quantity).toBe(150);
      expect(widget.organisationId).toBe("org_acme");
      expect(widget.syncGroupId).toBe("grp_coventry");
      expect(widget.deletedAt).toBeNull();
    });

    it("rejects duplicate SKU creation", async () => {
      await service.createWidget(
        {
          name: "Steel Bolt M8",
          sku: "BOLT-M8",
          quantity: 100,
          syncGroupId: "grp_coventry",
        },
        ctx,
      );

      await expect(
        service.createWidget(
          {
            name: "Another Bolt",
            sku: "bolt-m8",
            quantity: 50,
            syncGroupId: "grp_coventry",
          },
          ctx,
        ),
      ).rejects.toThrow("already exists");
    });

    it("rejects negative quantity", async () => {
      await expect(
        service.createWidget(
          {
            name: "Widget",
            sku: "WID-1",
            quantity: -5,
            syncGroupId: "grp_coventry",
          },
          ctx,
        ),
      ).rejects.toThrow("cannot be negative");
    });

    it("supports updates and soft-deletes via tombstone pattern", async () => {
      const widget = await service.createWidget(
        {
          name: "Standard Gear",
          sku: "GEAR-01",
          quantity: 25,
          syncGroupId: "grp_coventry",
        },
        ctx,
      );

      await service.updateWidget(widget.id, { quantity: 30 }, ctx);
      const updated = await service.getWidgetById(widget.id, ctx);
      expect(updated?.quantity).toBe(30);

      // Soft delete
      await service.deleteWidget(widget.id, ctx);
      const list = await service.listWidgets("grp_coventry", ctx);
      expect(list).toHaveLength(0); // Excluded from active list
    });

    it("does not read or mutate another organisation's widget", async () => {
      const widget = await service.createWidget(
        {
          name: "Other Organisation Widget",
          sku: "OTHER-01",
          quantity: 5,
          syncGroupId: "grp_other",
        },
        otherOrganisationCtx,
      );

      await expect(service.getWidgetById(widget.id, ctx)).resolves.toBeNull();
      await expect(
        service.updateWidget(widget.id, { quantity: 10 }, ctx),
      ).rejects.toThrow("not found");
      await service.deleteWidget(widget.id, ctx);
      await expect(
        service.getWidgetById(widget.id, otherOrganisationCtx),
      ).resolves.toEqual(
        expect.objectContaining({ quantity: 5, deleted_at: null }),
      );
    });

    it("rejects widget creation when caller lacks permission", async () => {
      const unprivilegedCtx = createOperationContext({
        deviceId: "dev_nobody",
        organisationId: "org_acme",
        userId: "user_nobody",
      });

      await expect(
        service.createWidget(
          {
            name: "Unauthorized Widget",
            sku: "UNAUTH-1",
            quantity: 1,
            syncGroupId: "grp_coventry",
          },
          unprivilegedCtx,
        ),
      ).rejects.toThrow("Authorization failed");
    });
  });
});
