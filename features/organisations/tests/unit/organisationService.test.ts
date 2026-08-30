import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { createOperationContext } from "@platform/core";
import { OrganisationService } from "../../src/services/organisationService.js";

describe("@features/organisations", () => {
  let db: MemoryDatabaseConnection;
  let service: OrganisationService;
  const ctx = createOperationContext({
    deviceId: "dev_1",
    organisationId: "org_root",
    userId: "user_admin",
  });

  beforeEach(async () => {
    db = new MemoryDatabaseConnection(":memory:");
    await db.init();

    await db.execute(`
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

    const updated = await service.updateOrganisation(
      org.id,
      { name: "Beta Holdings Ltd" },
      ctx,
    );

    expect(updated.name).toBe("Beta Holdings Ltd");
    expect(updated.domain).toBe("beta.com");
  });

  it("lists all active organisations", async () => {
    await service.createOrganisation({ name: "Org A", domain: "a.com" }, ctx);
    await service.createOrganisation({ name: "Org B", domain: "b.com" }, ctx);

    const orgs = await service.listOrganisations();
    expect(orgs.length).toBeGreaterThanOrEqual(2);
    const names = orgs.map((o) => o.name);
    expect(names).toContain("Org A");
    expect(names).toContain("Org B");
  });
});
