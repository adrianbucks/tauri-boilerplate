import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { createOperationContext } from "@platform/core";
import { SyncStateMachine, SyncManager, PairingService } from "./index.js";

describe("@platform/sync", () => {
  describe("SyncStateMachine", () => {
    it("follows standard handshake connection lifecycle", () => {
      const sm = new SyncStateMachine();
      expect(sm.getState()).toBe("DISCONNECTED");

      sm.transition("DISCOVERED");
      sm.transition("IDENTIFIED");
      sm.transition("CONNECTING");
      sm.transition("CONNECTED");
      sm.transition("AUTHENTICATING");
      sm.transition("AUTHORISED");
      sm.transition("IDLE");
      expect(sm.getState()).toBe("IDLE");

      sm.transition("SYNCING");
      expect(sm.getState()).toBe("SYNCING");
      sm.transition("IDLE");
      expect(sm.getState()).toBe("IDLE");
    });

    it("rejects invalid state transition", () => {
      const sm = new SyncStateMachine();
      expect(() => sm.transition("SYNCING")).toThrow(
        "Illegal sync state transition",
      );
    });

    it("transitions to terminal error states from any state", () => {
      for (const terminal of [
        "DISCONNECTED",
        "REVOKED",
        "EXPIRED",
        "INCOMPATIBLE",
        "ERROR",
      ] as const) {
        const sm = new SyncStateMachine();
        sm.transition("CONNECTING");
        sm.transition(terminal);
        expect(sm.getState()).toBe(terminal);
      }
    });

    it("fires onStateChange listener on each transition", () => {
      const sm = new SyncStateMachine();
      const changes: Array<{ from: string; to: string }> = [];
      const unsubscribe = sm.onStateChange((newState, oldState) => {
        changes.push({ from: oldState, to: newState });
      });

      sm.transition("CONNECTING");
      sm.transition("CONNECTED");
      expect(changes).toHaveLength(2);
      expect(changes[0]).toEqual({ from: "DISCONNECTED", to: "CONNECTING" });
      expect(changes[1]).toEqual({ from: "CONNECTING", to: "CONNECTED" });

      unsubscribe();
      sm.transition("ERROR");
      // No additional events after unsubscribe
      expect(changes).toHaveLength(2);
    });
  });

  describe("PairingService", () => {
    let db: MemoryDatabaseConnection;
    let pairingService: PairingService;
    const ctx = createOperationContext({
      deviceId: "dev_admin",
      organisationId: "org_acme",
      userId: "user_admin",
    });

    beforeEach(async () => {
      db = new MemoryDatabaseConnection(":memory:");
      await db.init();

      await db.execute(`
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

        INSERT INTO core_sync_groups (id, created_at, updated_at, organisation_id, name)
        VALUES ('grp_warehouse', '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z', 'org_acme', 'Warehouse Sync Group');
      `);

      pairingService = new PairingService(db);
    });

    afterEach(async () => {
      await db.close();
    });

    it("processes pairing request, validates handshake, and creates pending membership", async () => {
      const validationOpts = {
        expectedApplicationId: "tauri-boilerplate-demo",
        expectedOrganisationId: "org_acme",
        minimumProtocolVersion: 1,
        currentProtocolVersion: 1,
      };

      const result = await pairingService.requestPairing(
        {
          handshake: {
            applicationId: "tauri-boilerplate-demo",
            applicationVersion: "0.1.0",
            protocolVersion: 1,
            deviceId: "dev_scanner_1",
            organisationId: "org_acme",
            supportedFeatures: ["inventory"],
            supportedEntityVersions: { items: 1 },
            timestamp: new Date().toISOString(),
            nonce: "c".repeat(32),
            signerPublicKey: "ed25519_pk_" + "d".repeat(64),
            platform: "windows",
            signature: "e".repeat(128),
          },
          syncGroupId: "grp_warehouse",
        },
        validationOpts,
        ctx,
      );

      expect(result.status).toBe("PENDING");
      expect(
        await pairingService.canSync("dev_scanner_1", "grp_warehouse"),
      ).toBe(false);

      // Approve pairing
      const approval = await pairingService.approvePairing(
        result.requestId,
        ctx,
      );
      expect(approval.status).toBe("APPROVED");

      // Device can now sync in group
      expect(
        await pairingService.canSync("dev_scanner_1", "grp_warehouse"),
      ).toBe(true);
    });
  });
});
