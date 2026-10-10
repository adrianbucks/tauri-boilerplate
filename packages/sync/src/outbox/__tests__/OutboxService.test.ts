import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { MAX_SYNC_ENVELOPE_SIZE_BYTES, type SyncEnvelope } from "@platform/sync-protocol";
import { OutboxService } from "../OutboxService.js";

describe("OutboxService", () => {
  let db: MemoryDatabaseConnection;
  let service: OutboxService;

  const validEnvelope: SyncEnvelope = {
    envelopeId: "env_test_01",
    signedAt: "2026-09-06T12:00:00.000Z",
    signerPublicKey: "ed25519_pk_" + "a".repeat(64),
    signature: "b".repeat(128),
    operation: {
      operationId: "env_test_01",
      applicationId: "tauri-boilerplate-demo",
      organisationId: "org_acme",
      syncGroupId: "grp_warehouse",
      featureId: "inventory",
      entityType: "items",
      entityId: "item_42",
      operation: "create",
      payload: { name: "Widget A", quantity: 100 },
      authorId: "usr_alice",
      deviceId: "dev_device_1",
      logicalTimestamp: "2026-09-06T12:00:00.000Z:0001:dev_device_1",
      schemaVersion: 1,
      protocolVersion: 1,
    },
  };

  beforeEach(async () => {
    db = new MemoryDatabaseConnection(":memory:");
    await db.init();

    await db.execute(`
      CREATE TABLE IF NOT EXISTS core_sync_outbox (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        envelope_id TEXT NOT NULL UNIQUE,
        envelope_json TEXT,
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
    `);

    service = new OutboxService(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("enqueues an envelope within a transaction", async () => {
    const record = await db.transaction(async (tx) => {
      return service.enqueue(validEnvelope, tx);
    });

    expect(record.envelopeId).toBe("env_test_01");
    expect(record.status).toBe("PENDING");
    expect(record.organisationId).toBe("org_acme");

    const batch = await service.pendingBatch("org_acme");
    expect(batch).toHaveLength(1);
    expect(batch[0]?.envelopeId).toBe("env_test_01");
    expect(JSON.parse(batch[0]!.envelopeJson)).toEqual(validEnvelope);
  });

  it("rejects malformed and oversized envelopes before writing", async () => {
    const malformed = { ...validEnvelope, envelopeId: "different_id" };
    await expect(db.transaction((tx) => service.enqueue(malformed, tx))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    const oversized: SyncEnvelope = {
      ...validEnvelope,
      operation: {
        ...validEnvelope.operation,
        payload: { data: "x".repeat(MAX_SYNC_ENVELOPE_SIZE_BYTES) },
      },
    };
    await expect(db.transaction((tx) => service.enqueue(oversized, tx))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    const rows = await db.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM core_sync_outbox",
    );
    expect(rows[0]?.count).toBe(0);
  });

  it("marks an outbox row as sent", async () => {
    await db.transaction(async (tx) => {
      await service.enqueue(validEnvelope, tx);
    });

    await service.markSent("env_test_01");

    const batch = await service.pendingBatch("org_acme");
    expect(batch).toHaveLength(0);

    const rows = await db.query<{ status: string; sent_at: string }>(
      "SELECT status, sent_at FROM core_sync_outbox WHERE envelope_id = ?",
      ["env_test_01"],
    );
    expect(rows[0]?.status).toBe("SENT");
    expect(rows[0]?.sent_at).toBeTruthy();
  });

  it.each([-1, 0, 1.5, 51, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid pending batch limit (%s)",
    async (limit) => {
      await expect(service.pendingBatch("org_acme", limit)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    },
  );

  it("uses a finite default batch limit", async () => {
    await db.transaction(async (tx) => {
      await service.enqueue(validEnvelope, tx);
    });

    expect(await service.pendingBatch("org_acme")).toHaveLength(1);
  });

  it("returns pending envelopes only for the requested organisation", async () => {
    const otherOrganisationEnvelope: SyncEnvelope = {
      ...validEnvelope,
      envelopeId: "env_other_org",
      operation: {
        ...validEnvelope.operation,
        operationId: "env_other_org",
        organisationId: "org_other",
      },
    };
    await db.transaction(async (tx) => {
      await service.enqueue(validEnvelope, tx);
      await service.enqueue(otherOrganisationEnvelope, tx);
    });

    expect((await service.pendingBatch("org_acme")).map((entry) => entry.organisationId)).toEqual([
      "org_acme",
    ]);
    expect((await service.pendingBatch("org_other")).map((entry) => entry.organisationId)).toEqual([
      "org_other",
    ]);
  });

  it("rejects a missing organisation before querying", async () => {
    await expect(service.pendingBatch(" ")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("fails visibly for legacy pending rows without a complete envelope", async () => {
    await db.transaction(async (tx) => {
      await service.enqueue(validEnvelope, tx);
    });
    await db.execute("UPDATE core_sync_outbox SET envelope_json = NULL");

    await expect(service.pendingBatch("org_acme")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects a persisted envelope whose tenant differs from its outbox row", async () => {
    await db.transaction(async (tx) => {
      await service.enqueue(validEnvelope, tx);
    });
    const forgedEnvelope = {
      ...validEnvelope,
      operation: { ...validEnvelope.operation, organisationId: "org_other" },
    };
    await db.execute("UPDATE core_sync_outbox SET envelope_json = ?", [
      JSON.stringify(forgedEnvelope),
    ]);

    await expect(service.pendingBatch("org_acme")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("increments attempt_count on markFailed and marks FAILED after max attempts", async () => {
    await db.transaction(async (tx) => {
      await service.enqueue(validEnvelope, tx);
    });

    await service.markFailed("env_test_01", 3);
    let rows = await db.query<{ status: string; attempt_count: number }>(
      "SELECT status, attempt_count FROM core_sync_outbox WHERE envelope_id = ?",
      ["env_test_01"],
    );
    expect(rows[0]?.attempt_count).toBe(1);
    expect(rows[0]?.status).toBe("PENDING");

    await service.markFailed("env_test_01", 3);
    await service.markFailed("env_test_01", 3);

    rows = await db.query<{ status: string; attempt_count: number }>(
      "SELECT status, attempt_count FROM core_sync_outbox WHERE envelope_id = ?",
      ["env_test_01"],
    );
    expect(rows[0]?.attempt_count).toBe(3);
    expect(rows[0]?.status).toBe("FAILED");
  });

  it("does not apply a late failure after an envelope has been sent", async () => {
    await db.transaction(async (tx) => {
      await service.enqueue(validEnvelope, tx);
    });

    await service.markSent("env_test_01");
    await service.markFailed("env_test_01", 1);

    const rows = await db.query<{ status: string; attempt_count: number; sent_at: string | null }>(
      "SELECT status, attempt_count, sent_at FROM core_sync_outbox WHERE envelope_id = ?",
      ["env_test_01"],
    );
    expect(rows[0]?.status).toBe("SENT");
    expect(rows[0]?.attempt_count).toBe(0);
    expect(rows[0]?.sent_at).toBeTruthy();
  });

  it("does not resurrect a terminally failed envelope as sent", async () => {
    await db.transaction(async (tx) => {
      await service.enqueue(validEnvelope, tx);
    });

    await service.markFailed("env_test_01", 1);
    await service.markSent("env_test_01");

    const rows = await db.query<{ status: string; attempt_count: number; sent_at: string | null }>(
      "SELECT status, attempt_count, sent_at FROM core_sync_outbox WHERE envelope_id = ?",
      ["env_test_01"],
    );
    expect(rows[0]?.status).toBe("FAILED");
    expect(rows[0]?.attempt_count).toBe(1);
    expect(rows[0]?.sent_at).toBeNull();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid maxAttempts value (%s) without changing the row",
    async (maxAttempts) => {
      await db.transaction(async (tx) => {
        await service.enqueue(validEnvelope, tx);
      });

      await expect(service.markFailed("env_test_01", maxAttempts)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      const rows = await db.query<{ status: string; attempt_count: number }>(
        "SELECT status, attempt_count FROM core_sync_outbox WHERE envelope_id = ?",
        ["env_test_01"],
      );
      expect(rows[0]).toMatchObject({ status: "PENDING", attempt_count: 0 });
    },
  );
});
