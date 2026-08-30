import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { createOperationContext } from "@platform/core";
import {
  HandshakeValidator,
  NamespaceGenerator,
} from "@platform/sync-protocol";
import { PairingService } from "@platform/sync";
import { SyncGroupService } from "@platform/authorization";
import { DeviceIdentityService } from "@platform/identity";

describe("Security Regression Suite — Sync & Pairing Authorization", () => {
  let db: MemoryDatabaseConnection;
  let pairingService: PairingService;
  let syncGroups: SyncGroupService;
  let identity: DeviceIdentityService;

  const ctx = createOperationContext({
    deviceId: "dev_admin",
    organisationId: "org_acme",
    userId: "user_admin",
  });

  const baseValidationOpts = {
    expectedApplicationId: "tauri-boilerplate-demo",
    expectedOrganisationId: "org_acme",
    minimumProtocolVersion: 1,
    currentProtocolVersion: 1,
  };

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
      CREATE TABLE core_revocations (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        group_id TEXT,
        revoked_by TEXT NOT NULL,
        revoked_at TEXT NOT NULL,
        reason TEXT NOT NULL
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
      VALUES 
        ('grp_coventry', '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z', 'org_acme', 'Coventry Group'),
        ('grp_birmingham', '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z', 'org_acme', 'Birmingham Group');
    `);

    pairingService = new PairingService(db);
    syncGroups = new SyncGroupService(db);
    identity = new DeviceIdentityService(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("Layer 1 & 2: Rejects handshake from unknown or cross-organisation peer", () => {
    const handshake = {
      applicationId: "tauri-boilerplate-demo",
      applicationVersion: "0.1.0",
      protocolVersion: 1,
      deviceId: "dev_attacker_1",
      organisationId: "org_malicious",
      supportedFeatures: ["inventory"],
      supportedEntityVersions: { items: 1 },
      timestamp: new Date().toISOString(),
    };

    const res = HandshakeValidator.validate(handshake, baseValidationOpts);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("ORG_ID_MISMATCH");
  });

  it("Layer 4 & 5: Unapproved devices cannot sync under any condition", async () => {
    // Register device in UNREGISTERED state
    await identity.registerDevice({
      deviceId: "dev_pending_1",
      publicKey: "pk_1",
      platform: "windows",
      applicationId: "tauri-boilerplate-demo",
    });

    const canSync = await pairingService.canSync(
      "dev_pending_1",
      "grp_coventry",
    );
    expect(canSync).toBe(false);
  });

  it("Layer 6: Enforces strict sync group boundaries (Coventry vs Birmingham isolation)", async () => {
    // 1. Device 1 pairs with Coventry group and gets approved
    const req1 = await pairingService.requestPairing(
      {
        handshake: {
          applicationId: "tauri-boilerplate-demo",
          applicationVersion: "0.1.0",
          protocolVersion: 1,
          deviceId: "dev_coventry_1",
          organisationId: "org_acme",
          supportedFeatures: ["widgets"],
          supportedEntityVersions: { widgets: 1 },
          timestamp: new Date().toISOString(),
        },
        syncGroupId: "grp_coventry",
      },
      baseValidationOpts,
      ctx,
    );
    await pairingService.approvePairing(req1.requestId, ctx);

    // Device 1 CAN sync Coventry data
    expect(await pairingService.canSync("dev_coventry_1", "grp_coventry")).toBe(
      true,
    );

    // Device 1 CANNOT sync Birmingham data
    expect(
      await pairingService.canSync("dev_coventry_1", "grp_birmingham"),
    ).toBe(false);

    // Canonical namespaces are strictly isolated
    const nsCov = NamespaceGenerator.generate({
      applicationId: "tauri-boilerplate-demo",
      organisationId: "org_acme",
      syncGroupId: "grp_coventry",
      featureId: "inventory",
      entityType: "widgets",
    });
    const nsBhm = NamespaceGenerator.generate({
      applicationId: "tauri-boilerplate-demo",
      organisationId: "org_acme",
      syncGroupId: "grp_birmingham",
      featureId: "inventory",
      entityType: "widgets",
    });
    expect(nsCov).not.toBe(nsBhm);
  });

  it("Layer 7: Revoked device immediately loses sync authorization", async () => {
    // 1. Pair and approve
    const req = await pairingService.requestPairing(
      {
        handshake: {
          applicationId: "tauri-boilerplate-demo",
          applicationVersion: "0.1.0",
          protocolVersion: 1,
          deviceId: "dev_laptop_temp",
          organisationId: "org_acme",
          supportedFeatures: ["widgets"],
          supportedEntityVersions: { widgets: 1 },
          timestamp: new Date().toISOString(),
        },
        syncGroupId: "grp_coventry",
      },
      baseValidationOpts,
      ctx,
    );
    await pairingService.approvePairing(req.requestId, ctx);
    expect(
      await pairingService.canSync("dev_laptop_temp", "grp_coventry"),
    ).toBe(true);

    // 2. Revoke device
    await syncGroups.revokeMembership(
      "dev_laptop_temp",
      "grp_coventry",
      ctx.userId ?? "system",
      "Device reported lost",
    );
    await identity.updateDeviceStatus("dev_laptop_temp", "REVOKED");

    // 3. Immediately rejected
    expect(
      await pairingService.canSync("dev_laptop_temp", "grp_coventry"),
    ).toBe(false);
  });
});
