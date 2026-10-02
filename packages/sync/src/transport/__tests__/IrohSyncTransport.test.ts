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
      operationId: "op_01",
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
    const mockInvoke = vi.fn(
      async (cmd: string, args?: Record<string, unknown>) => {
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
        throw new Error(`Unexpected command: ${cmd}`);
      },
    );

    let eventHandler: ((event: { payload: unknown }) => void) | undefined;
    const unlistenFn = vi.fn();
    const mockListen = vi.fn(
      async (
        _event: string,
        handler: (event: { payload: unknown }) => void,
      ) => {
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
    expect(mockListen).toHaveBeenCalledWith(
      "sync://envelope-received",
      expect.any(Function),
    );

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
    transport.dispose();
    expect(unlistenFn).toHaveBeenCalled();
  });

  it("throws when sending to an unconnected peer", async () => {
    const mockInvoke = vi.fn();
    const transport = new IrohSyncTransport({
      invoke: mockInvoke as unknown as TauriInvokeFn,
    });

    await expect(transport.send("unknown_peer", dummyEnvelope)).rejects.toThrow(
      "is not connected",
    );
  });
});
