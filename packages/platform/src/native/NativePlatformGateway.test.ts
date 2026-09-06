import { describe, expect, it, vi } from "vitest";
import { createPlatformNativeGateway } from "./NativePlatformGateway.js";

describe("PlatformNativeGateway", () => {
  it("invokes the typed database health command without SQL arguments", async () => {
    const health = {
      db_path: "C:/app-data/platform.sqlite3",
      sqlite_version: "3.50.4",
      journal_mode: "wal",
      foreign_keys_enabled: true,
      integrity_check: "ok",
    };
    const invoke = vi.fn().mockResolvedValue(health);
    const gateway = createPlatformNativeGateway({ invoke });

    await expect(gateway.getDatabaseHealth()).resolves.toEqual(health);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("get_database_health");
  });

  it("uses typed authentication and session-scoped widget commands", async () => {
    const invoke = vi.fn().mockResolvedValue({
      user_id: "user_1",
      organisation_id: "org_1",
      permissions: ["widgets.read"],
    });
    const gateway = createPlatformNativeGateway({ invoke });

    await gateway.authenticateUser({
      user_id: "user_1",
      password: "not-retained-by-gateway",
    });
    expect(invoke).toHaveBeenCalledWith("authenticate_user", {
      request: {
        user_id: "user_1",
        password: "not-retained-by-gateway",
      },
    });

    await gateway.listWidgets("org_1");
    expect(invoke).toHaveBeenLastCalledWith("list_widgets", {
      request: { organisation_id: "org_1" },
    });
    await gateway.createWidget({
      organisation_id: "org_1",
      sync_group_id: "group_1",
      name: "Widget",
      sku: "W-1",
      quantity: 2,
      correlation_id: "corr_widget_1",
    });
    expect(invoke).toHaveBeenLastCalledWith("create_widget", {
      request: {
        organisation_id: "org_1",
        sync_group_id: "group_1",
        name: "Widget",
        sku: "W-1",
        quantity: 2,
        correlation_id: "corr_widget_1",
      },
    });
    await gateway.createWidgets({
      organisation_id: "org_1",
      sync_group_id: "group_1",
      correlation_id: "corr_bulk_1",
      widgets: [
        { name: "Widget 2", sku: "W-2", quantity: 3, description: "Bulk" },
      ],
    });
    expect(invoke).toHaveBeenLastCalledWith("create_widgets", {
      request: {
        organisation_id: "org_1",
        sync_group_id: "group_1",
        correlation_id: "corr_bulk_1",
        widgets: [
          { name: "Widget 2", sku: "W-2", quantity: 3, description: "Bulk" },
        ],
      },
    });
    await gateway.listOrganisations();
    expect(invoke).toHaveBeenLastCalledWith("list_organisations");
    await gateway.createOrganisation({
      name: "Acme",
      correlation_id: "corr_org_1",
    });
    expect(invoke).toHaveBeenLastCalledWith("create_organisation", {
      request: { name: "Acme", correlation_id: "corr_org_1" },
    });
    await gateway.logoutUser();
    expect(invoke).toHaveBeenLastCalledWith("logout_user");
  });
});
