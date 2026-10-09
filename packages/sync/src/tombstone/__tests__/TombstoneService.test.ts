import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { TombstoneService } from "../TombstoneService.js";

describe("TombstoneService", () => {
  let db: MemoryDatabaseConnection;
  let service: TombstoneService;

  beforeEach(async () => {
    db = new MemoryDatabaseConnection(":memory:");
    await db.init();

    await db.execute(`
      CREATE TABLE IF NOT EXISTS core_sync_tombstones (
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
    `);

    service = new TombstoneService(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("records a tombstone atomically in a transaction and reports isDeleted as true", async () => {
    expect(await service.isDeleted("widgets", "w_123", "org_acme")).toBe(false);

    const record = await db.transaction(async (tx) => {
      return service.record(
        "widgets",
        "w_123",
        "usr_alice",
        "del_op_001",
        "org_acme",
        "grp_default",
        "inventory",
        tx,
      );
    });

    expect(record.entityId).toBe("w_123");
    expect(record.deleteOperationId).toBe("del_op_001");
    expect(record.replicatedAt).toBeNull();

    expect(await service.isDeleted("widgets", "w_123", "org_acme")).toBe(true);
    expect(await service.isDeleted("widgets", "w_123", "org_other")).toBe(false);
  });

  it("retrieves pending tombstones and marks them replicated", async () => {
    await db.transaction(async (tx) => {
      await service.record(
        "widgets",
        "w_999",
        "usr_bob",
        "del_op_002",
        "org_acme",
        "grp_default",
        "inventory",
        tx,
      );
    });

    const pending = await service.propagatePending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.deleteOperationId).toBe("del_op_002");

    await service.markReplicated("del_op_002");

    const pendingAfter = await service.propagatePending();
    expect(pendingAfter).toHaveLength(0);
  });
});
