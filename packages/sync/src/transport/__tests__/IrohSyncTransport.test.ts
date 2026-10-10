import { describe, it, expect, vi } from "vitest";
import type { SyncEnvelope } from "@platform/sync-protocol";
import { IrohSyncTransport, type TauriInvokeFn } from "../IrohSyncTransport.js";

describe("IrohSyncTransport", () => {
  const dummyEnvelope: SyncEnvelope = {
    envelopeId: "env_iroh_01",
    signedAt: "2026-09-13T12:00:00.000Z",
    signerPublicKey: "ed25519_pk_" + "0".repeat(64),
    signature: "1".repeat(128),
    operation: {
      operationId: "env_iroh_01",
      applicationId: "tauri-boilerplate-demo",
      organisationId: "org_acme",
      syncGroupId: "grp_warehouse",
      featureId: "inventory",
      entityType: "items",
      entityId: "item_01",
      operation: "create",
      payload: { name: "Sample" },
      authorId: "usr_alice",
      deviceId: "dev_1",
      logicalTimestamp: "2026-09-13T12:00:00.000Z:0001:dev_1",
      schemaVersion: 1,
      protocolVersion: 1,
    },
  };

  it("initializes endpoint and connects to peer via Tauri IPC", async () => {
    const invokeCalls: Array<{ cmd: string; args?: unknown }> = [];
    const mockInvoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      invokeCalls.push({ cmd, args });
      if (cmd === "sync_start_endpoint") {
        return {
          endpoint_id: "local_node_id_123",
          addr_json: JSON.stringify({
            id: "local_node_id_123",
            relay_urls: [],
          }),
        };
      }
      if (cmd === "sync_connect_peer") {
        return "remote_node_id_456";
      }
      if (cmd === "sync_send_envelope") {
        return undefined;
      }
      if (cmd === "sync_disconnect_peer") {
        return undefined;
      }
      if (cmd === "sync_stop_endpoint") {
        return undefined;
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    let eventHandler: ((event: { payload: unknown }) => void) | undefined;
    const unlistenFn = vi.fn();
    const mockListen = vi.fn(
      async (_event: string, handler: (event: { payload: unknown }) => void) => {
        eventHandler = handler;
        return unlistenFn;
      },
    );

    const transport = new IrohSyncTransport({
      invoke: mockInvoke as unknown as TauriInvokeFn,
      listen: mockListen as any,
    });

    // 1. Initialise
    const info = await transport.init();
    expect(info.endpoint_id).toBe("local_node_id_123");
    expect(mockInvoke).toHaveBeenCalledWith("sync_start_endpoint");
    expect(mockListen).toHaveBeenCalledWith("sync://envelope-received", expect.any(Function));

    // 2. Connect
    const peerAddr = JSON.stringify({
      id: "remote_node_id_456",
      direct_addresses: ["127.0.0.1:12345"],
    });
    await transport.connect("peer_warehouse", peerAddr);
    expect(transport.isConnected("peer_warehouse")).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("sync_connect_peer", {
      request: { addr_json: peerAddr },
    });

    // 3. Send envelope
    await transport.send("peer_warehouse", dummyEnvelope);
    expect(mockInvoke).toHaveBeenCalledWith("sync_send_envelope", {
      request: {
        endpoint_id: "remote_node_id_456",
        payload_json: JSON.stringify(dummyEnvelope),
      },
    });

    // 4. Inbound envelope handling
    const received: Array<{ peerId: string; envelope: SyncEnvelope }> = [];
    transport.onReceive(async (peerId, env) => {
      received.push({ peerId, envelope: env });
    });

    expect(eventHandler).toBeDefined();
    eventHandler!({
      payload: {
        sender_endpoint_id: "remote_node_id_456",
        payload_json: JSON.stringify(dummyEnvelope),
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.peerId).toBe("peer_warehouse");
    expect(received[0]?.envelope.envelopeId).toBe("env_iroh_01");

    // 5. Disconnect
    await transport.disconnect("peer_warehouse");
    expect(transport.isConnected("peer_warehouse")).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith("sync_disconnect_peer", {
      request: { endpoint_id: "remote_node_id_456" },
    });

    // 6. Dispose
    await transport.dispose();
    expect(unlistenFn).toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith("sync_stop_endpoint");
  });

  it("throws when sending to an unconnected peer", async () => {
    const mockInvoke = vi.fn();
    const transport = new IrohSyncTransport({
      invoke: mockInvoke as unknown as TauriInvokeFn,
    });

    await expect(transport.send("unknown_peer", dummyEnvelope)).rejects.toThrow("is not connected");
  });

  it("retries event-listener registration after the endpoint starts", async () => {
    const endpointInfo = { endpoint_id: "local_node_id", addr_json: "{}" };
    const mockInvoke = vi.fn(async (command: string) => {
      if (command === "sync_start_endpoint") return endpointInfo;
      if (command === "sync_stop_endpoint") return undefined;
      throw new Error(`Unexpected command: ${command}`);
    });
    const unlisten = vi.fn();
    const mockListen = vi
      .fn()
      .mockRejectedValueOnce(new Error("event listener unavailable"))
      .mockResolvedValueOnce(unlisten);
    const transport = new IrohSyncTransport({
      invoke: mockInvoke as unknown as TauriInvokeFn,
      listen: mockListen as any,
    });

    await expect(transport.init()).rejects.toThrow("event listener unavailable");
    await expect(transport.init()).resolves.toEqual(endpointInfo);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockListen).toHaveBeenCalledTimes(2);
    await transport.dispose();
  });

  it("does not dispatch structurally invalid inbound envelopes", async () => {
    const transport = new IrohSyncTransport({ invoke: vi.fn() as unknown as TauriInvokeFn });
    const handler = vi.fn();
    transport.onReceive(handler);

    await transport.handleIncomingMessage({
      sender_endpoint_id: "peer_1",
      payload_json: JSON.stringify({ ...dummyEnvelope, envelopeId: "forged_id" }),
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
