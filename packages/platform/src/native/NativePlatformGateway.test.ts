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
      widgets: [{ name: "Widget 2", sku: "W-2", quantity: 3, description: "Bulk" }],
    });
    expect(invoke).toHaveBeenLastCalledWith("create_widgets", {
      request: {
        organisation_id: "org_1",
        sync_group_id: "group_1",
        correlation_id: "corr_bulk_1",
        widgets: [{ name: "Widget 2", sku: "W-2", quantity: 3, description: "Bulk" }],
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

    // Test getDeviceIdentity
    const identity = {
      device_id: "dev_123",
      public_key: "ed25519_pk_abc",
      platform: "windows",
      application_id: "com.demo",
    };
    invoke.mockResolvedValueOnce(identity);
    await expect(gateway.getDeviceIdentity()).resolves.toEqual(identity);
    expect(invoke).toHaveBeenLastCalledWith("get_device_identity");

    // Test getCurrentSession
    const sessionView = {
      user_id: "u_1",
      device_id: "dev_123",
      organisation_id: "org_1",
      permissions: ["widget:read"],
    };
    invoke.mockResolvedValueOnce(sessionView);
    await expect(gateway.getCurrentSession()).resolves.toEqual(sessionView);
    expect(invoke).toHaveBeenLastCalledWith("get_current_session");

    // Test getBackgroundStatus
    const bgStatus = { running: true };
    invoke.mockResolvedValueOnce(bgStatus);
    await expect(gateway.getBackgroundStatus()).resolves.toEqual(bgStatus);
    expect(invoke).toHaveBeenLastCalledWith("background_status");

    // Test getSyncEndpointInfo
    const endpointInfo = {
      endpoint_id: "ep_123",
      addr_json: '{"id":"ep_123"}',
    };
    invoke.mockResolvedValueOnce(endpointInfo);
    await expect(gateway.getSyncEndpointInfo()).resolves.toEqual(endpointInfo);
    expect(invoke).toHaveBeenLastCalledWith("sync_start_endpoint");

    // Test signMessage
    invoke.mockResolvedValueOnce("sig_hex_128");
    await expect(gateway.signMessage("aabbcc")).resolves.toBe("sig_hex_128");
    expect(invoke).toHaveBeenLastCalledWith("sign_message", {
      request: { message_hex: "aabbcc" },
    });

    // Test verifyMessage
    invoke.mockResolvedValueOnce(true);
    await expect(
      gateway.verifyMessage({
        public_key: "ed25519_pk_abc",
        message_hex: "aabbcc",
        signature_hex: "sig_hex_128",
      }),
    ).resolves.toBe(true);
    expect(invoke).toHaveBeenLastCalledWith("verify_message", {
      request: {
        public_key: "ed25519_pk_abc",
        message_hex: "aabbcc",
        signature_hex: "sig_hex_128",
      },
    });
  });

  it("createNativeSignFn delegates to native signMessage without exposing private keys (Invariant #5)", async () => {
    const invoke = vi.fn().mockResolvedValue("signature_hex_128");
    const gateway = createPlatformNativeGateway({ invoke });
    const { createNativeSignFn } = await import("./NativePlatformGateway.js");

    const signFn = createNativeSignFn(gateway);
    const bytes = new Uint8Array([1, 2, 15, 255]); // 01020fff
    const signature = await signFn(bytes);

    expect(signature).toBe("signature_hex_128");
    expect(invoke).toHaveBeenCalledWith("sign_message", {
      request: { message_hex: "01020fff" },
    });
  });

  it("createNativeVerifyFn delegates to native verifyMessage", async () => {
    const invoke = vi.fn().mockResolvedValue(true);
    const gateway = createPlatformNativeGateway({ invoke });
    const { createNativeVerifyFn } = await import("./NativePlatformGateway.js");

    const verifyFn = createNativeVerifyFn(gateway);
    const bytes = new Uint8Array([10, 20]); // 0a14
    const valid = await verifyFn("ed25519_pk_123", bytes, "sig_hex");

    expect(valid).toBe(true);
    expect(invoke).toHaveBeenCalledWith("verify_message", {
      request: {
        public_key: "ed25519_pk_123",
        message_hex: "0a14",
        signature_hex: "sig_hex",
      },
    });
  });
});
