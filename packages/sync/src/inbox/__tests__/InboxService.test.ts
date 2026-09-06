import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import type { SyncEnvelope } from "@platform/sync-protocol";
import { InboxService } from "../InboxService.js";

describe("InboxService", () => {
  let db: MemoryDatabaseConnection;
  let service: InboxService;

  const validEnvelope: SyncEnvelope = {
    envelopeId: "env_inbox_01",
    signedAt: "2026-09-06T12:00:00.000Z",
    signerPublicKey: "ed25519_pk_" + "a".repeat(64),
    signature: "b".repeat(128),
    operation: {
      operationId: "env_inbox_01",
      applicationId: "tauri-boilerplate-demo",
      organisationId: "org_acme",
      syncGroupId: "grp_warehouse",
      featureId: "inventory",
      entityType: "items",
      entityId: "item_99",
      operation: "update",
      payload: { name: "Widget B", quantity: 50 },
      authorId: "usr_bob",
      deviceId: "dev_device_2",
      logicalTimestamp: "2026-09-06T12:00:00.000Z:0001:dev_device_2",
      schemaVersion: 1,
      protocolVersion: 1,
    },
  };

  beforeEach(async () => {
    db = new MemoryDatabaseConnection(":memory:");
    await db.init();

    await db.execute(`
      CREATE TABLE IF NOT EXISTS core_sync_inbox (
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
    `);

    service = new InboxService(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("receives and verifies a valid envelope", async () => {
    const record = await service.receive(
      validEnvelope,
      async (_pk, _bytes, _sig) => true,
    );

    expect(record.envelopeId).toBe("env_inbox_01");
    expect(record.verificationStatus).toBe("VERIFIED");
    expect(record.applyStatus).toBe("PENDING");
  });

  it("marks verification_status as REJECTED if signature verification returns false", async () => {
    const record = await service.receive(
      validEnvelope,
      async (_pk, _bytes, _sig) => false,
    );

    expect(record.verificationStatus).toBe("REJECTED");
  });

  it("handles duplicate envelope_id idempotently", async () => {
    const record1 = await service.receive(
      validEnvelope,
      async () => true,
    );
    const record2 = await service.receive(
      validEnvelope,
      async () => true,
    );

    expect(record1.id).toBe(record2.id);
    const pending = await service.getByApplyStatus("PENDING");
    expect(pending).toHaveLength(1);
  });

  it("applies pending verified envelopes in logical_timestamp order", async () => {
    const envelope1 = {
      ...validEnvelope,
      envelopeId: "env_order_2",
      operation: {
        ...validEnvelope.operation,
        operationId: "env_order_2",
        logicalTimestamp: "2026-09-06T12:00:00.000Z:0002:dev_device_2",
      },
    };
    const envelope2 = {
      ...validEnvelope,
      envelopeId: "env_order_1",
      operation: {
        ...validEnvelope.operation,
        operationId: "env_order_1",
        logicalTimestamp: "2026-09-06T12:00:00.000Z:0001:dev_device_2",
      },
    };

    await service.receive(envelope1, async () => true);
    await service.receive(envelope2, async () => true);

    const appliedIds: string[] = [];
    const res = await service.applyPending(async (rec) => {
      appliedIds.push(rec.envelopeId);
    });

    expect(res.applied).toBe(2);
    expect(res.failed).toBe(0);
    expect(res.conflicts).toBe(0);
    expect(appliedIds).toEqual(["env_order_1", "env_order_2"]);
  });

  it("records CONFLICT status when applyFn throws a conflict error", async () => {
    await service.receive(validEnvelope, async () => true);

    const res = await service.applyPending(async () => {
      throw new Error("Conflict detected during apply");
    });

    expect(res.conflicts).toBe(1);
    expect(res.applied).toBe(0);

    const conflicts = await service.getByApplyStatus("CONFLICT");
    expect(conflicts).toHaveLength(1);
  });
});
