import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { AuthorizationError, createOperationContext, ValidationError } from "@platform/core";
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
  IrohSyncTransport,
  SyncManager,
  type TauriInvokeFn,
  ConflictEngine,
} from "@platform/sync";
import { SyncGroupService } from "@platform/authorization";
import { DeviceIdentityService } from "@platform/identity";

describe("Security Regression Suite — Sync & Pairing Authorization", () => {
  it("rejects malformed timestamps before they can influence LWW conflict resolution", () => {
    const envelope = (envelopeId: string, logicalTimestamp: string): SyncEnvelope => ({
      envelopeId,
      signedAt: "2026-10-10T00:00:00.000Z",
      signerPublicKey: `ed25519_pk_${"a".repeat(64)}`,
      signature: "b".repeat(128),
      operation: {
        operationId: envelopeId,
        applicationId: "app",
        organisationId: "org",
        syncGroupId: "group",
        featureId: "feature",
        entityType: "record",
        entityId: "record_1",
        operation: "update",
        payload: {},
        authorId: "user",
        deviceId: "device",
        logicalTimestamp,
        schemaVersion: 1,
        protocolVersion: 1,
      },
    });

    expect(() =>
      new ConflictEngine().resolve(
        { strategy: "lww" },
        envelope("local", "2026-10-10T00:00:00.000Z:0001:device_local"),
        envelope("remote", "not-a-valid-timestamp"),
      ),
    ).toThrow("Invalid HLC timestamp");
  });

  it("rejects an unsigned envelope ID override before it can occupy an inbox idempotency key", async () => {
    const envelope: SyncEnvelope = {
      envelopeId: "forged-envelope-id",
      signedAt: "2026-10-10T00:00:00.000Z",
      signerPublicKey: `ed25519_pk_${"a".repeat(64)}`,
      signature: "b".repeat(128),
      operation: {
        operationId: "signed-operation-id",
        applicationId: "app",
        organisationId: "org_acme",
        syncGroupId: "grp_coventry",
        featureId: "feature",
        entityType: "record",
        entityId: "record_1",
        operation: "update",
        payload: {},
        authorId: "user_admin",
        deviceId: "dev_admin",
        logicalTimestamp: "2026-10-10T00:00:00.000Z:0001:dev_admin",
        schemaVersion: 1,
        protocolVersion: 1,
      },
    };

    await expect(inboxService.receive(envelope, async () => true)).rejects.toThrow(
      "Envelope ID must match operation ID",
    );
    const rows = await db.query<{ count: number }>("SELECT COUNT(*) AS count FROM core_sync_inbox");
    expect(rows[0]?.count).toBe(0);
  });

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

  it("does not authorize a peer from caller-provided organisation metadata", async () => {
    const manager = new SyncManager({ db, deviceId: "dev_local", organisationId: "org_acme" });
    const observed: string[] = [];
    manager.onStateChange((state) => observed.push(state));

    await manager.connect({
      peerId: "peer_unverified",
      deviceId: "dev_peer",
      organisationId: "org_acme",
      supportedSyncGroups: ["group_acme"],
    });

    expect(observed).not.toContain("AUTHORISED");
    expect(manager.getPeerState("peer_unverified")).toBe("ERROR");
    expect(manager.getDiagnostics()).toEqual([]);
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
        last_seen_at TEXT,
        is_local INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE core_permissions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT
      );
      CREATE TABLE core_roles (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        organisation_id TEXT NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE core_role_permissions (
        id TEXT PRIMARY KEY,
        role_id TEXT NOT NULL,
        permission_id TEXT NOT NULL,
        scope_constraints_json TEXT
      );
      CREATE TABLE core_user_roles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        organisation_id TEXT NOT NULL,
        granted_at TEXT NOT NULL
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
      INSERT INTO core_permissions (id, name) VALUES ('perm_sync_manage', 'sync.manage');
      INSERT INTO core_roles (id, created_at, updated_at, organisation_id, name)
      VALUES ('role_admin', 'now', 'now', 'org_acme', 'Admin');
      INSERT INTO core_role_permissions (id, role_id, permission_id)
      VALUES ('role_perm_sync_manage', 'role_admin', 'perm_sync_manage');
      INSERT INTO core_user_roles (id, user_id, role_id, organisation_id, granted_at)
      VALUES ('user_role_admin', 'user_admin', 'role_admin', 'org_acme', 'now');
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

  it("rejects pairing when the selected sync group belongs to another organisation", async () => {
    await db.execute(
      "INSERT INTO core_sync_groups (id, created_at, updated_at, organisation_id, name) VALUES ('grp_other_org', 'now', 'now', 'org_other', 'Other organisation');",
    );

    await expect(
      pairingService.requestPairing(
        {
          handshake: createValidHandshake({ deviceId: "dev_cross_org" }),
          syncGroupId: "grp_other_org",
        },
        baseValidationOpts,
        ctx,
      ),
    ).rejects.toThrow(AuthorizationError);

    const devices = await db.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM core_devices WHERE device_id = ?",
      ["dev_cross_org"],
    );
    const requests = await db.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM core_membership_requests WHERE device_id = ?",
      ["dev_cross_org"],
    );
    expect(devices[0]?.count).toBe(0);
    expect(requests[0]?.count).toBe(0);
  });

  it("binds peer membership to the authenticated context, never an unsigned user ID", async () => {
    const input = {
      handshake: createValidHandshake({
        deviceId: "dev_user_binding",
        nonce: "4".repeat(32),
      }),
      syncGroupId: "grp_coventry",
      // Simulate a stale or hostile caller attempting to inject an identity that
      // is not part of the signed handshake. This property is no longer in the API.
      userId: "user_victim",
    } as never;

    const result = await pairingService.requestPairing(input, baseValidationOpts, ctx);
    const [request] = await db.query<{ user_id: string | null }>(
      "SELECT user_id FROM core_membership_requests WHERE id = ?",
      [result.requestId],
    );
    const [device] = await db.query<{ user_id: string | null }>(
      "SELECT user_id FROM core_devices WHERE device_id = ?",
      ["dev_user_binding"],
    );

    expect(request?.user_id).toBe("user_admin");
    expect(device?.user_id).toBe("user_admin");
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
      HandshakeValidator.requireValid(handshake, { ...baseValidationOpts, seenNonces }, "corr_2"),
    ).rejects.toThrow(ValidationError);
  });

  it("Layer 4 & 5: Unapproved devices cannot sync under any condition", async () => {
    await identity.registerDevice({
      deviceId: "dev_pending_1",
      publicKey: "pk_1",
      platform: "windows",
      applicationId: "tauri-boilerplate-demo",
    });

    const canSync = await pairingService.canSync("dev_pending_1", "grp_coventry");
    expect(canSync).toBe(false);
  });

  it("rejects pending, suspended, revoked, and unregistered devices even with active membership", async () => {
    await identity.registerDevice({
      deviceId: "dev_status_gate",
      publicKey: "pk_status_gate",
      platform: "windows",
      applicationId: "tauri-boilerplate-demo",
    });
    await db.execute(
      `INSERT INTO core_sync_group_members
        (id, group_id, device_id, user_id, status, joined_at)
       VALUES ('member_status_gate', 'grp_coventry', 'dev_status_gate', 'user_admin', 'ACTIVE', 'now')`,
    );

    for (const status of ["PENDING_APPROVAL", "SUSPENDED", "REVOKED", "UNREGISTERED"] as const) {
      await identity.updateDeviceStatus("dev_status_gate", status);
      expect(await pairingService.canSync("dev_status_gate", "grp_coventry")).toBe(false);
    }

    for (const status of ["APPROVED", "ACTIVE"] as const) {
      await identity.updateDeviceStatus("dev_status_gate", status);
      expect(await pairingService.canSync("dev_status_gate", "grp_coventry")).toBe(true);
    }
  });

  it("requires sync.manage before approving a pairing request", async () => {
    await db.execute(`
      INSERT INTO core_membership_requests
        (id, device_id, group_id, user_id, requested_at, status)
      VALUES ('req_pending', 'dev_pending', 'grp_coventry', 'user_requester', 'now', 'PENDING');
    `);
    await db.execute(`
      INSERT INTO core_sync_group_members
        (id, group_id, device_id, user_id, status, joined_at)
      VALUES ('member_active', 'grp_coventry', 'dev_pending', 'user_requester', 'ACTIVE', 'now');
    `);

    const unauthorizedContext = createOperationContext({
      deviceId: "dev_guest",
      organisationId: "org_acme",
      userId: "user_guest",
    });

    await expect(pairingService.approvePairing("req_pending", unauthorizedContext)).rejects.toThrow(
      AuthorizationError,
    );
    await expect(
      syncGroups.rejectMembership("req_pending", unauthorizedContext, "Not authorized"),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      syncGroups.revokeMembership(
        "dev_pending",
        "grp_coventry",
        unauthorizedContext,
        "Not authorized",
      ),
    ).rejects.toThrow(AuthorizationError);

    const [request] = await db.query<{ status: string }>(
      "SELECT status FROM core_membership_requests WHERE id = ?",
      ["req_pending"],
    );
    const decisions = await db.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM core_membership_decisions WHERE request_id = ?",
      ["req_pending"],
    );
    expect(request?.status).toBe("PENDING");
    expect(decisions?.[0]?.count).toBe(0);
    const [membership] = await db.query<{ status: string }>(
      "SELECT status FROM core_sync_group_members WHERE id = ?",
      ["member_active"],
    );
    const revocations = await db.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM core_revocations WHERE device_id = ?",
      ["dev_pending"],
    );
    expect(membership?.status).toBe("ACTIVE");
    expect(revocations?.[0]?.count).toBe(0);
  });

  it("prevents an authorised user from deciding membership in another organisation", async () => {
    await db.execute(
      "INSERT INTO core_sync_groups (id, created_at, updated_at, organisation_id, name) VALUES ('grp_other_org', 'now', 'now', 'org_other', 'Other organisation');",
    );
    await db.execute(
      "INSERT INTO core_membership_requests (id, device_id, group_id, user_id, requested_at, status) VALUES ('req_other_org', 'dev_other_org', 'grp_other_org', 'user_other', 'now', 'PENDING');",
    );
    await db.execute(
      "INSERT INTO core_sync_group_members (id, group_id, device_id, user_id, status, joined_at) VALUES ('member_other_org', 'grp_other_org', 'dev_other_org', 'user_other', 'ACTIVE', 'now');",
    );

    await expect(syncGroups.approveMembership("req_other_org", ctx)).rejects.toThrow(
      AuthorizationError,
    );
    await expect(
      syncGroups.rejectMembership("req_other_org", ctx, "Cross-tenant rejection"),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      syncGroups.revokeMembership("dev_other_org", "grp_other_org", ctx, "Cross-tenant revocation"),
    ).rejects.toThrow(AuthorizationError);

    const [request] = await db.query<{ status: string }>(
      "SELECT status FROM core_membership_requests WHERE id = ?",
      ["req_other_org"],
    );
    const [member] = await db.query<{ status: string }>(
      "SELECT status FROM core_sync_group_members WHERE id = ?",
      ["member_other_org"],
    );
    const decisions = await db.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM core_membership_decisions WHERE request_id = ?",
      ["req_other_org"],
    );
    const revocations = await db.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM core_revocations WHERE group_id = ?",
      ["grp_other_org"],
    );

    expect(request?.status).toBe("PENDING");
    expect(member?.status).toBe("ACTIVE");
    expect(decisions?.[0]?.count).toBe(0);
    expect(revocations?.[0]?.count).toBe(0);
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
    expect(await pairingService.canSync("dev_coventry_1", "grp_coventry")).toBe(true);

    // Device 1 CANNOT sync Birmingham data
    expect(await pairingService.canSync("dev_coventry_1", "grp_birmingham")).toBe(false);

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
    expect(await pairingService.canSync("dev_laptop_temp", "grp_coventry")).toBe(true);

    // Revoke device
    await syncGroups.revokeMembership(
      "dev_laptop_temp",
      "grp_coventry",
      ctx,
      "Device reported lost",
    );
    await identity.updateDeviceStatus("dev_laptop_temp", "REVOKED");

    // Immediately rejected
    expect(await pairingService.canSync("dev_laptop_temp", "grp_coventry")).toBe(false);
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

  it("Invariant #4 & #5: IrohSyncTransport integrates with InboxService without leaking private keys", async () => {
    const mockInvoke = async (cmd: string, _args?: Record<string, unknown>) => {
      if (cmd === "sync_start_endpoint") {
        return { endpoint_id: "node_sec_01", addr_json: "{}" };
      }
      if (cmd === "sync_connect_peer") {
        return "node_peer_02";
      }
      if (cmd === "sync_send_envelope") {
        return undefined;
      }
      return undefined;
    };

    let pushIncoming: ((event: { payload: unknown }) => void) | undefined;
    const mockListen = async (_event: string, handler: (event: { payload: unknown }) => void) => {
      pushIncoming = handler;
      return () => {};
    };

    const transport = new IrohSyncTransport({
      invoke: mockInvoke as unknown as TauriInvokeFn,
      listen: mockListen as any,
    });

    await transport.connect("peer_remote", "node_peer_02");

    // Invariant #5: Ensure transport never stores or exposes private keys
    const transportKeys = Object.keys(transport);
    expect(transportKeys.some((k) => k.toLowerCase().includes("private"))).toBe(false);

    // Invariant #4: When an envelope arrives across iroh transport, it must pass verification before apply
    let receivedByHandler = false;
    transport.onReceive(async (_peerId, envelope) => {
      receivedByHandler = true;
      // Pass to inbox service with strict verification (which rejects forged signatures)
      const record = await inboxService.receive(envelope, async () => false);
      expect(record.verificationStatus).toBe("REJECTED");
    });

    const forgedEnvelope: SyncEnvelope = {
      envelopeId: "env_tampered_01",
      signedAt: new Date().toISOString(),
      signerPublicKey: "ed25519_pk_" + "f".repeat(64),
      signature: "0".repeat(128),
      operation: {
        operationId: "env_tampered_01",
        applicationId: "tauri-boilerplate-demo",
        organisationId: "org_acme",
        syncGroupId: "grp_coventry",
        featureId: "inventory",
        entityType: "widgets",
        entityId: "wid_fake_01",
        operation: "create",
        payload: { name: "Forged Widget" },
        authorId: "usr_attacker",
        deviceId: "dev_attacker",
        logicalTimestamp: "0000018f1000_0000_dev_attacker",
        schemaVersion: 1,
        protocolVersion: 1,
      },
    };

    await transport.handleIncomingMessage({
      sender_endpoint_id: "node_peer_02",
      payload_json: JSON.stringify(forgedEnvelope),
    });

    expect(receivedByHandler).toBe(true);
  });
});
