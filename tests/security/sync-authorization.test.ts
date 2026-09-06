import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { createOperationContext, ValidationError } from "@platform/core";
import {
  HandshakeValidator,
  NamespaceGenerator,
  type HandshakeMessage,
  type SyncEnvelope,
} from "@platform/sync-protocol";
import {
  PairingService,
  OutboxService,
  InboxService,
  TombstoneService,
} from "@platform/sync";
import { SyncGroupService } from "@platform/authorization";
import { DeviceIdentityService } from "@platform/identity";

describe("Security Regression Suite — Sync & Pairing Authorization", () => {
  let db: MemoryDatabaseConnection;
  let pairingService: PairingService;
  let syncGroups: SyncGroupService;
  let identity: DeviceIdentityService;
  let outboxService: OutboxService;
  let inboxService: InboxService;
  let tombstoneService: TombstoneService;

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

  function createValidHandshake(overrides?: Partial<HandshakeMessage>): HandshakeMessage {
    return {
      applicationId: "tauri-boilerplate-demo",
      applicationVersion: "0.1.0",
      protocolVersion: 1,
      deviceId: "dev_coventry_1",
      organisationId: "org_acme",
      supportedFeatures: ["widgets"],
      supportedEntityVersions: { widgets: 1 },
      timestamp: new Date().toISOString(),
      nonce: "a".repeat(32),
      signerPublicKey: "ed25519_pk_" + "b".repeat(64),
      platform: "windows",
      signature: "c".repeat(128),
      ...overrides,
    };
  }

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
      CREATE TABLE core_sync_outbox (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        envelope_id TEXT NOT NULL UNIQUE,
        organisation_id TEXT NOT NULL,
        sync_group_id TEXT NOT NULL,
        feature_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        author_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        logical_timestamp TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        protocol_version INTEGER NOT NULL,
        signer_public_key TEXT NOT NULL,
        signature TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        sent_at TEXT
      );
      CREATE TABLE core_sync_inbox (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        envelope_id TEXT NOT NULL UNIQUE,
        organisation_id TEXT NOT NULL,
        from_device_id TEXT NOT NULL,
        sync_group_id TEXT NOT NULL,
        feature_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        logical_timestamp TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        protocol_version INTEGER NOT NULL,
        signer_public_key TEXT NOT NULL,
        signature TEXT NOT NULL,
        verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
        apply_status TEXT NOT NULL DEFAULT 'PENDING',
        applied_at TEXT,
        conflict_id TEXT
      );
      CREATE TABLE core_sync_tombstones (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        organisation_id TEXT NOT NULL,
        sync_group_id TEXT NOT NULL,
        feature_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        deleted_by TEXT NOT NULL,
        delete_operation_id TEXT NOT NULL UNIQUE,
        replicated_at TEXT
      );

      INSERT INTO core_sync_groups (id, created_at, updated_at, organisation_id, name)
      VALUES 
        ('grp_coventry', '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z', 'org_acme', 'Coventry Group'),
        ('grp_birmingham', '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z', 'org_acme', 'Birmingham Group');
    `);

    pairingService = new PairingService(db);
    syncGroups = new SyncGroupService(db);
    identity = new DeviceIdentityService(db);
    outboxService = new OutboxService(db);
    inboxService = new InboxService(db);
    tombstoneService = new TombstoneService(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("Layer 1 & 2: Rejects handshake from unknown or cross-organisation peer", () => {
    const handshake = createValidHandshake({
      deviceId: "dev_attacker_1",
      organisationId: "org_malicious",
    });

    const res = HandshakeValidator.validate(handshake, baseValidationOpts);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("ORG_ID_MISMATCH");
  });

  it("Handshake Security: Rejects handshake with replayed nonce", async () => {
    const seenNonces = new Set<string>();
    const handshake = createValidHandshake({
      nonce: "1".repeat(32),
    });

    // First attempt passes
    await HandshakeValidator.requireValid(
      handshake,
      { ...baseValidationOpts, seenNonces },
      "corr_1",
    );
    expect(seenNonces.has("1".repeat(32))).toBe(true);

    // Second attempt with same nonce must be rejected
    await expect(
      HandshakeValidator.requireValid(
        handshake,
        { ...baseValidationOpts, seenNonces },
        "corr_2",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("Layer 4 & 5: Unapproved devices cannot sync under any condition", async () => {
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
    const req1 = await pairingService.requestPairing(
      {
        handshake: createValidHandshake({
          deviceId: "dev_coventry_1",
          nonce: "2".repeat(32),
        }),
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
    const req = await pairingService.requestPairing(
      {
        handshake: createValidHandshake({
          deviceId: "dev_laptop_temp",
          nonce: "3".repeat(32),
        }),
        syncGroupId: "grp_coventry",
      },
      baseValidationOpts,
      ctx,
    );
    await pairingService.approvePairing(req.requestId, ctx);
    expect(
      await pairingService.canSync("dev_laptop_temp", "grp_coventry"),
    ).toBe(true);

    // Revoke device
    await syncGroups.revokeMembership(
      "dev_laptop_temp",
      "grp_coventry",
      ctx.userId ?? "system",
      "Device reported lost",
    );
    await identity.updateDeviceStatus("dev_laptop_temp", "REVOKED");

    // Immediately rejected
    expect(
      await pairingService.canSync("dev_laptop_temp", "grp_coventry"),
    ).toBe(false);
  });

  it("Replication Security: Inbox rejects tampered envelope signature", async () => {
    const envelope: SyncEnvelope = {
      envelopeId: "env_tampered_01",
      signedAt: "2026-09-06T12:00:00.000Z",
      signerPublicKey: "ed25519_pk_" + "e".repeat(64),
      signature: "f".repeat(128),
      operation: {
        operationId: "env_tampered_01",
        applicationId: "tauri-boilerplate-demo",
        organisationId: "org_acme",
        syncGroupId: "grp_coventry",
        featureId: "inventory",
        entityType: "widgets",
        entityId: "wid_fake",
        operation: "create",
        payload: { name: "Unauthorized Widget" },
        authorId: "usr_attacker",
        deviceId: "dev_attacker",
        logicalTimestamp: "0000018f1000_0000_dev_attacker",
        schemaVersion: 1,
        protocolVersion: 1,
      },
    };

    // Verify callback returns false for tampered signature
    const record = await inboxService.receive(envelope, async () => false);

    expect(record.verificationStatus).toBe("REJECTED");
    expect(record.applyStatus).toBe("PENDING");

    // applyPending should NOT apply unverified envelopes
    const res = await inboxService.applyPending(async () => {
      throw new Error("Should not be called for rejected envelopes");
    });
    expect(res.applied).toBe(0);
  });

  it("Invariant #6: Tombstone service prevents silent revive and tracks deletions for sync", async () => {
    await db.transaction(async (tx) => {
      await tombstoneService.record(
        "widgets",
        "wid_deleted_1",
        "usr_alice",
        "del_op_99",
        "org_acme",
        "grp_coventry",
        "inventory",
        tx,
      );
    });

    // Invariant #6: isDeleted must return true
    expect(await tombstoneService.isDeleted("widgets", "wid_deleted_1", "org_acme")).toBe(true);

    const pending = await tombstoneService.propagatePending();
    expect(pending.some((t) => t.entityId === "wid_deleted_1")).toBe(true);
  });
});
