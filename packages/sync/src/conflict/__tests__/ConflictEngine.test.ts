import { describe, it, expect } from "vitest";
import { ConflictError } from "@platform/core";
import {
  ConflictRegistry,
  HybridLogicalClock,
  type SyncEnvelope,
} from "@platform/sync-protocol";
import { ConflictEngine } from "../ConflictEngine.js";

describe("ConflictEngine", () => {
  const hlc1 = new HybridLogicalClock("dev_1");
  const hlc2 = new HybridLogicalClock("dev_2");

  const tsLocal = hlc1.now();
  // Ensure tsRemote is strictly greater by updating or waiting
  const tsRemote = hlc2.update(tsLocal);

  const baseLocalEnvelope: SyncEnvelope = {
    envelopeId: "env_local",
    signedAt: "2026-09-06T12:00:00.000Z",
    signerPublicKey: "ed25519_pk_" + "1".repeat(64),
    signature: "a".repeat(128),
    operation: {
      operationId: "op_local",
      applicationId: "tauri-boilerplate-demo",
      organisationId: "org_acme",
      syncGroupId: "grp_warehouse",
      featureId: "inventory",
      entityType: "products",
      entityId: "prod_1",
      operation: "update",
      payload: { stock: 10 },
      authorId: "usr_alice",
      deviceId: "dev_1",
      logicalTimestamp: tsLocal,
      schemaVersion: 1,
      protocolVersion: 1,
    },
  };

  const baseRemoteEnvelope: SyncEnvelope = {
    envelopeId: "env_remote",
    signedAt: "2026-09-06T12:01:00.000Z",
    signerPublicKey: "ed25519_pk_" + "2".repeat(64),
    signature: "b".repeat(128),
    operation: {
      operationId: "op_remote",
      applicationId: "tauri-boilerplate-demo",
      organisationId: "org_acme",
      syncGroupId: "grp_warehouse",
      featureId: "inventory",
      entityType: "products",
      entityId: "prod_1",
      operation: "update",
      payload: { stock: 15 },
      authorId: "usr_bob",
      deviceId: "dev_2",
      logicalTimestamp: tsRemote,
      schemaVersion: 1,
      protocolVersion: 1,
    },
  };

  it("resolves LWW favoring the newer HLC timestamp", () => {
    const engine = new ConflictEngine();

    // Remote is newer (tsRemote > tsLocal)
    const res1 = engine.resolve(
      { strategy: "lww" },
      baseLocalEnvelope,
      baseRemoteEnvelope,
    );
    expect(res1.winner).toBe("remote");
    expect(res1.resolvedEnvelope?.envelopeId).toBe("env_remote");

    // Local is newer
    const tsNewerLocal = hlc1.update(tsRemote);
    const newerLocal = {
      ...baseLocalEnvelope,
      operation: {
        ...baseLocalEnvelope.operation,
        logicalTimestamp: tsNewerLocal,
      },
    };
    const res2 = engine.resolve({ strategy: "lww" }, newerLocal, baseRemoteEnvelope);
    expect(res2.winner).toBe("local");
    expect(res2.resolvedEnvelope?.envelopeId).toBe("env_local");
  });

  it("resolves append-only by accepting remote into log", () => {
    const engine = new ConflictEngine();
    const res = engine.resolve(
      { strategy: "append-only" },
      baseLocalEnvelope,
      baseRemoteEnvelope,
    );
    expect(res.winner).toBe("remote");
    expect(res.resolvedEnvelope?.envelopeId).toBe("env_remote");
  });

  it("resolves immutable by rejecting remote update and keeping local", () => {
    const engine = new ConflictEngine();
    const res = engine.resolve(
      { strategy: "immutable" },
      baseLocalEnvelope,
      baseRemoteEnvelope,
    );
    expect(res.winner).toBe("local");
    expect(res.resolvedEnvelope?.envelopeId).toBe("env_local");
  });

  it("requires manual resolution for manual strategy", () => {
    const engine = new ConflictEngine();
    const res = engine.resolve(
      { strategy: "manual" },
      baseLocalEnvelope,
      baseRemoteEnvelope,
    );
    expect(res.winner).toBe("manual_required");
    expect(res.resolvedEnvelope).toBeNull();
  });

  it("merges additive deltas for non-absolute fields", () => {
    const engine = new ConflictEngine();
    const deltaLocal = {
      ...baseLocalEnvelope,
      operation: {
        ...baseLocalEnvelope.operation,
        payload: { adjustments: 5 },
      },
    };
    const deltaRemote = {
      ...baseRemoteEnvelope,
      operation: {
        ...baseRemoteEnvelope.operation,
        payload: { adjustments: 10 },
      },
    };

    const res = engine.resolve(
      { strategy: "additive" },
      deltaLocal,
      deltaRemote,
      "adjustments",
    );
    expect(res.winner).toBe("merge");
    expect((res.resolvedEnvelope?.operation.payload as { adjustments: number }).adjustments).toBe(15);
  });

  it("enforces CS-010: throws ConflictError if additive strategy is attempted on an absolute value field", () => {
    const registry = new ConflictRegistry();
    registry.registerAbsoluteLwwField("products", "stock");

    const engine = new ConflictEngine(registry);

    expect(() =>
      engine.resolve(
        { strategy: "additive" },
        baseLocalEnvelope,
        baseRemoteEnvelope,
        "stock",
      ),
    ).toThrow(ConflictError);
  });
});
