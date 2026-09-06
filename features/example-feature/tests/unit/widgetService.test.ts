import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection, MigrationEngine } from "@platform/database";
import { createOperationContext } from "@platform/core";
import { WidgetService } from "../../src/services/widgetService.js";
import { exampleFeatureManifest } from "../../src/manifest.js";

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

  beforeEach(async () => {
    db = new MemoryDatabaseConnection(":memory:");
    await db.init();

    // Apply feature migration
    const engine = new MigrationEngine(db);
    await engine.applyMigrations(exampleFeatureManifest.migrations);

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
  });
});
