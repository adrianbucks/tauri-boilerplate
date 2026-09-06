import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { Platform } from "@platform/platform";
import { createOperationContext } from "@platform/core";
import {
  exampleFeatureManifest,
  WidgetService,
} from "@features/example-feature";
import {
  organisationsManifest,
  OrganisationService,
} from "@features/organisations";
import {
  identityAdminManifest,
  IdentityAdminService,
} from "@features/identity-admin";
import { KeyboardWedgeScanner } from "@platform/hardware";
import { ImportEngine, type ImportDefinition } from "@platform/import-export";

describe("Cross-Package Integration Suite — End-to-End Pipeline", () => {
  let db: MemoryDatabaseConnection;
  let platform: Platform;

  beforeEach(async () => {
    db = new MemoryDatabaseConnection(":memory:");
    await db.init();

    // Create core platform baseline schema
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
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        user_id TEXT,
        device_id TEXT NOT NULL UNIQUE,
        public_key TEXT NOT NULL,
        platform TEXT NOT NULL,
        application_id TEXT NOT NULL,
        status TEXT NOT NULL,
        registered_at TEXT NOT NULL,
        last_seen_at TEXT
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

    platform = new Platform({
      db,
      config: {
        applicationName: "Platform Integration Test",
        applicationVersion: "1.0.0",
        environment: "test",
        logLevel: "error",
      },
    });

    platform.registerFeature({ manifest: exampleFeatureManifest });
    platform.registerFeature({ manifest: organisationsManifest });
    platform.registerFeature({ manifest: identityAdminManifest });

    await platform.init();
  });

  async function grantAllPermissions(userId: string, organisationId: string) {
    const roleId = `role_${organisationId}_admin`;
    await db.execute(
      `INSERT OR IGNORE INTO core_roles (id, created_at, updated_at, organisation_id, name)
       VALUES (?, '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z', ?, 'Administrator')`,
      [roleId, organisationId],
    );
    const perms = [
      "organisations.create",
      "organisations.read",
      "organisations.manage",
      "users.create",
      "users.read",
      "devices.approve",
      "devices.revoke",
      "sync.manage",
      "widgets.create",
      "widgets.read",
      "widgets.update",
      "widgets.delete",
    ];
    for (const perm of perms) {
      await db.execute(
        `INSERT OR IGNORE INTO core_permissions (id, name) VALUES (?, ?)`,
        [perm, perm],
      );
      await db.execute(
        `INSERT OR IGNORE INTO core_role_permissions (id, role_id, permission_id) VALUES (?, ?, ?)`,
        [`${roleId}_${perm}`, roleId, perm],
      );
    }
    await db.execute(
      `INSERT OR IGNORE INTO core_user_roles (id, user_id, role_id, organisation_id, granted_at)
       VALUES (?, ?, ?, ?, '2026-08-30T10:00:00Z')`,
      [`ur_${userId}_${organisationId}`, userId, roleId, organisationId],
    );
  }

  afterEach(async () => {
    await db.close();
  });

  it("runs complete lifecycle: tenant creation → user onboarding → feature CRUD → audit logging", async () => {
    const ctx = createOperationContext({
      deviceId: "dev_primary",
      organisationId: "org_acme_logistics",
      userId: "usr_admin",
    });

    await grantAllPermissions("usr_admin", "org_acme_logistics");

    // 1. Create Organisation Tenancy
    const orgService = new OrganisationService(db);
    const org = await orgService.createOrganisation(
      { name: "Acme Global Logistics", domain: "acme.com" },
      ctx,
    );
    expect(org.id).toBeDefined();
    expect(org.name).toBe("Acme Global Logistics");

    // Authorize admin within the newly created tenant
    await grantAllPermissions("usr_admin", org.id);
    const tenantAdminCtx = createOperationContext({
      deviceId: ctx.deviceId,
      organisationId: org.id,
      userId: ctx.userId,
    });

    // 2. Onboard User via Identity Admin Service
    const adminService = new IdentityAdminService(db);
    const userId = await adminService.createUser(
      {
        displayName: "Alice Operator",
        email: "alice@acme.com",
        organisationId: org.id,
      },
      tenantAdminCtx,
    );
    expect(userId).toBeDefined();

    // 3. Register Device & Request Membership
    const syncGroupService = platform.syncGroups;
    const reqId = await syncGroupService.requestMembership(
      "grp_main",
      "dev_scanner_101",
      userId,
    );
    await adminService.approveDevice("dev_scanner_101", reqId, tenantAdminCtx);

    // 4. Feature CRUD (Widgets table migrated automatically by Platform.init())
    await grantAllPermissions(userId, org.id);
    const widgetService = new WidgetService(db);
    const widget = await widgetService.createWidget(
      {
        name: "Industrial Scanner Bracket",
        sku: "BRK-001",
        quantity: 50,
        syncGroupId: "grp_main",
      },
      { ...ctx, organisationId: org.id, userId },
    );
    expect(widget.id).toBeDefined();
    expect(widget.sku).toBe("BRK-001");

    // 5. Verify Audit Trail captured all actions atomically
    const auditLogs = await db.query<{ event_type: string }>(
      "SELECT event_type FROM core_audit_events",
    );
    expect(auditLogs.some((e) => e.event_type === "USER_CREATED")).toBe(true);
    expect(auditLogs.some((e) => e.event_type === "DEVICE_APPROVED")).toBe(
      true,
    );
  });

  it("integrates hardware barcode scanning with spreadsheet bulk import", async () => {
    const ctx = createOperationContext({
      deviceId: "dev_scanner",
      organisationId: "org_warehouse",
      userId: "usr_operator",
    });

    await grantAllPermissions("usr_operator", "org_warehouse");

    const widgetService = new WidgetService(db);
    const importEngine = new ImportEngine(db);

    // 1. Bulk import CSV of widgets
    const csvData =
      "SKU,Name,Quantity\r\nSCN-990,Barcode Mount,15\r\nSCN-991,Handheld Holster,30";
    const buffer = new TextEncoder().encode(csvData);

    const importDef: ImportDefinition<any> = {
      id: "import_widgets_integration",
      entityName: "Widgets",
      acceptedFormats: ["csv"],
      columns: [
        { key: "sku", label: "SKU", type: "string", required: true },
        { key: "name", label: "Name", type: "string", required: true },
        { key: "quantity", label: "Quantity", type: "number", required: true },
      ],
      validateRow: (row, idx) => ({
        valid: true,
        data: {
          sku: String(row["sku"] || row["SKU"]),
          name: String(row["name"] || row["Name"]),
          quantity: parseInt(String(row["quantity"] || row["Quantity"]), 10),
        },
      }),
      commit: async (records, dbConn, opCtx) => {
        for (const r of records) {
          await widgetService.createWidget(
            {
              sku: r.sku,
              name: r.name,
              quantity: r.quantity,
              syncGroupId: "grp_wh_1",
            },
            opCtx,
          );
        }
        return { importedCount: records.length };
      },
    };

    const summary = await importEngine.executeImport(buffer, importDef, ctx);
    expect(summary.successfulRows).toBe(2);

    // 2. Simulate hardware scanner scanning one of the imported items
    const scanner = new KeyboardWedgeScanner({ maxInterKeyDelayMs: 50 });
    let scannedText: string | null = null;
    scanner.startListening((res) => {
      scannedText = res.text;
    });

    let t = 1000;
    for (const c of "SCN-990") {
      scanner.handleKeyEvent(c, (t += 10));
    }
    scanner.handleKeyEvent("Enter", (t += 10));

    expect(scannedText).toBe("SCN-990");

    // 3. Lookup scanned widget in repository
    const matchedWidget = await widgetService.getWidgetById(
      (
        await db.query<{ id: string }>("SELECT id FROM widgets WHERE sku = ?", [
          "SCN-990",
        ])
      )[0]!.id,
      ctx,
    );
    expect(matchedWidget?.name).toBe("Barcode Mount");
  });
});
