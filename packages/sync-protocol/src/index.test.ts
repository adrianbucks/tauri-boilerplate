import { describe, it, expect } from "vitest";
import {
  HybridLogicalClock,
  NamespaceGenerator,
  ConflictRegistry,
  HandshakeValidator,
  type HandshakeMessage,
} from "./index.js";

describe("@platform/sync-protocol", () => {
  it("generates monotonically increasing HLC timestamps", () => {
    const hlc = new HybridLogicalClock("dev_node_1");
    const t1 = hlc.now();
    const t2 = hlc.now();

    expect(HybridLogicalClock.compare(t1, t2)).toBeLessThan(0);
    expect(t1.includes("dev_node_1")).toBe(true);
  });

  it("parses and updates HLC timestamps from remote peers", () => {
    const localHlc = new HybridLogicalClock("local_node");
    const remoteHlc = new HybridLogicalClock("remote_node");

    const remoteTime = remoteHlc.now();
    const updatedTime = localHlc.update(remoteTime);

    expect(HybridLogicalClock.compare(remoteTime, updatedTime)).toBeLessThan(0);
  });

  it("generates canonical deterministic namespaces", () => {
    const ns = NamespaceGenerator.generate({
      applicationId: "app_main",
      organisationId: "org_acme",
      syncGroupId: "grp_coventry",
      featureId: "inventory",
      entityType: "items",
    });

    expect(ns).toBe("app_main/org_acme/grp_coventry/inventory/items");

    expect(() =>
      NamespaceGenerator.generate({
        applicationId: "app/invalid",
        organisationId: "org",
        syncGroupId: "grp",
        featureId: "f",
        entityType: "e",
      }),
    ).toThrow("Invalid segment");
  });

  it("registers and retrieves entity conflict policies", () => {
    const registry = new ConflictRegistry();
    registry.registerEntityPolicy("locations", { strategy: "append-only" });
    registry.registerFieldPolicy("items", "stock_count", {
      strategy: "additive",
    });

    expect(registry.getPolicy("locations")).toEqual({
      strategy: "append-only",
    });
    expect(registry.getPolicy("items", "stock_count")).toEqual({
      strategy: "additive",
    });
    expect(registry.getPolicy("other")).toEqual({ strategy: "lww" });
  });

  describe("HandshakeValidator", () => {
    const validMessage: HandshakeMessage = {
      applicationId: "tauri-boilerplate-demo",
      applicationVersion: "0.1.0",
      protocolVersion: 1,
      deviceId: "dev_peer_1",
      organisationId: "org_acme",
      supportedFeatures: ["example-feature", "organisations"],
      supportedEntityVersions: { widgets: 1 },
      timestamp: new Date().toISOString(),
    };

    const options = {
      expectedApplicationId: "tauri-boilerplate-demo",
      expectedOrganisationId: "org_acme",
      minimumProtocolVersion: 1,
      currentProtocolVersion: 1,
    };

    it("accepts matching handshake message", () => {
      const result = HandshakeValidator.validate(validMessage, options);
      expect(result.valid).toBe(true);
    });

    it("rejects mismatched application ID", () => {
      const result = HandshakeValidator.validate(
        { ...validMessage, applicationId: "other-app" },
        options,
      );
      expect(result.valid).toBe(false);
      expect(result.code).toBe("APP_ID_MISMATCH");
    });

    it("rejects cross-organisation handshake", () => {
      const result = HandshakeValidator.validate(
        { ...validMessage, organisationId: "org_other" },
        options,
      );
      expect(result.valid).toBe(false);
      expect(result.code).toBe("ORG_ID_MISMATCH");
    });

    it("rejects incompatible protocol version", () => {
      const result = HandshakeValidator.validate(
        { ...validMessage, protocolVersion: 0 },
        options,
      );
      expect(result.valid).toBe(false);
      expect(result.code).toBe("PROTOCOL_INCOMPATIBLE");
    });
  });
});
