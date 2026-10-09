import { describe, it, expect } from "vitest";
import type { SyncEnvelope } from "@platform/sync-protocol";
import { SimulatedSyncTransport } from "../SyncTransport.js";

describe("SimulatedSyncTransport", () => {
  const dummyEnvelope: SyncEnvelope = {
    envelopeId: "env_trans_01",
    signedAt: "2026-09-06T12:00:00.000Z",
    signerPublicKey: "ed25519_pk_" + "0".repeat(64),
    signature: "1".repeat(128),
    operation: {
      operationId: "env_trans_01",
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
      logicalTimestamp: "2026-09-06T12:00:00.000Z:0001:dev_1",
      schemaVersion: 1,
      protocolVersion: 1,
    },
  };

  it("pairs two transports and transmits envelopes between peers", async () => {
    const transportA = new SimulatedSyncTransport();
    const transportB = new SimulatedSyncTransport();

    transportA.pairWith(transportB);

    await transportA.connect("peer_b", "pk_b");
    expect(transportA.isConnected("peer_b")).toBe(true);

    const received: Array<{ peerId: string; envelope: SyncEnvelope }> = [];
    transportB.onReceive(async (peerId, env) => {
      received.push({ peerId, envelope: env });
    });

    await transportA.send("peer_b", dummyEnvelope);

    expect(received).toHaveLength(1);
    expect(received[0]?.peerId).toBe("peer_b");
    expect(received[0]?.envelope.envelopeId).toBe("env_trans_01");

    await transportA.disconnect("peer_b");
    expect(transportA.isConnected("peer_b")).toBe(false);
  });

  it("throws when sending to an unconnected peer", async () => {
    const transport = new SimulatedSyncTransport();
    await expect(transport.send("unconnected_peer", dummyEnvelope)).rejects.toThrow(
      "is not connected",
    );
  });
});
