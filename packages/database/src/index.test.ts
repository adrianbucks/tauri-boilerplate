import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  MemoryDatabaseConnection,
  MigrationEngine,
  BaseRepository,
  type MigrationScript,
} from "./index.js";

interface TestItem {
  id: string;
  name: string;
  quantity: number;
  deleted_at?: string | null;
  deleted_by?: string | null;
  delete_operation_id?: string | null;
}

class TestItemRepository extends BaseRepository<TestItem> {
  protected readonly tableName = "test_items";
  protected override readonly supportsSoftDelete = true;
}

describe("@platform/database", () => {
  let db: MemoryDatabaseConnection;

  beforeEach(async () => {
    db = new MemoryDatabaseConnection(":memory:");
    await db.init();
  });

  afterEach(async () => {
    await db.close();
  });

  describe("MemoryDatabaseConnection", () => {
    it("executes health check and returns healthy on initial connection", async () => {
      const health = await db.healthCheck();
      expect(health.healthy).toBe(true);
      expect(health.walEnabled).toBe(true);
      expect(health.foreignKeysEnabled).toBe(true);
      expect(health.integrityCheck).toBe("ok");
    });

    it("executes queries with parameter binding", async () => {
      await db.execute("CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT);");
      await db.execute("INSERT INTO users (id, name) VALUES (?, ?);", [
        "u1",
        "Alice",
      ]);

      const rows = await db.query<{ id: string; name: string }>(
        "SELECT * FROM users WHERE id = ?;",
        ["u1"],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe("Alice");
    });

    it("rolls back transaction on error", async () => {
      await db.execute(
        "CREATE TABLE accounts (id TEXT PRIMARY KEY, balance INTEGER);",
      );
      await db.execute("INSERT INTO accounts (id, balance) VALUES (?, ?);", [
        "a1",
        100,
      ]);

      await expect(
        db.transaction(async (tx) => {
          await tx.execute("UPDATE accounts SET balance = 50 WHERE id = ?;", [
            "a1",
          ]);
          throw new Error("Simulated transaction failure");
        }),
      ).rejects.toThrow("Simulated transaction failure");

      const rows = await db.query<{ balance: number }>(
        "SELECT balance FROM accounts WHERE id = ?;",
        ["a1"],
      );
      expect(rows[0]?.balance).toBe(100);
    });
  });

  describe("MigrationEngine", () => {
    it("applies migrations sequentially and records them", async () => {
      const engine = new MigrationEngine(db);
      const migrations: MigrationScript[] = [
        {
          version: 1,
          name: "create_test_items",
          sql: "CREATE TABLE test_items (id TEXT PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL, deleted_at TEXT, deleted_by TEXT, delete_operation_id TEXT);",
          checksum: "chk_1",
        },
        {
          version: 2,
          name: "add_index",
          sql: "CREATE INDEX idx_test_items_name ON test_items(name);",
          checksum: "chk_2",
        },
      ];

      const result = await engine.applyMigrations(migrations);
      expect(result.appliedCount).toBe(2);

      const applied = await engine.getAppliedVersions();
      expect(applied).toEqual([1, 2]);

      // Running again should apply 0 new migrations
      const reRun = await engine.applyMigrations(migrations);
      expect(reRun.appliedCount).toBe(0);
    });

    it("executes semicolons inside SQL string literals", async () => {
      const engine = new MigrationEngine(db);

      await engine.applyMigrations([
        {
          version: 1,
          name: "create_message",
          sql: `
            CREATE TABLE messages (id TEXT PRIMARY KEY, body TEXT NOT NULL);
            INSERT INTO messages (id, body) VALUES ('m1', 'wait; then continue');
          `,
          checksum: "chk_message",
        },
      ]);

      const rows = await db.query<{ body: string }>(
        "SELECT body FROM messages WHERE id = ?",
        ["m1"],
      );
      expect(rows[0]?.body).toBe("wait; then continue");
    });

    it("rejects an applied migration when its checksum changes", async () => {
      const engine = new MigrationEngine(db);
      const migration: MigrationScript = {
        version: 1,
        name: "create_checksum_test",
        sql: "CREATE TABLE checksum_test (id TEXT PRIMARY KEY);",
        checksum: "original_checksum",
      };

      await engine.applyMigrations([migration]);

      await expect(
        engine.applyMigrations([
          { ...migration, checksum: "changed_checksum" },
        ]),
      ).rejects.toMatchObject({
        code: "MIGRATION_ERROR",
        message:
          "Migration checksum mismatch for platform:v1 ('create_checksum_test')",
      });
    });

    it("allows the same version for different owners", async () => {
      const engine = new MigrationEngine(db);

      const result = await engine.applyMigrations([
        {
          owner: "feature.organisations",
          version: 1,
          name: "create_organisations",
          sql: "CREATE TABLE organisations (id TEXT PRIMARY KEY);",
          checksum: "chk_org_1",
        },
        {
          owner: "feature.inventory",
          version: 1,
          name: "create_inventory",
          sql: "CREATE TABLE inventory (id TEXT PRIMARY KEY);",
          checksum: "chk_inventory_1",
        },
      ]);

      expect(result.appliedCount).toBe(2);
      const applied = await db.query<{ owner: string; version: number }>(
        "SELECT owner, version FROM core_migrations ORDER BY owner",
      );
      expect(applied).toEqual([
        { owner: "feature.inventory", version: 1 },
        { owner: "feature.organisations", version: 1 },
      ]);
    });
  });

  describe("BaseRepository", () => {
    it("supports insert, findById, findAll, update, and softDelete", async () => {
      await db.execute(`
        CREATE TABLE test_items (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          deleted_at TEXT,
          deleted_by TEXT,
          delete_operation_id TEXT
        );
      `);

      const repo = new TestItemRepository(db);

      // Insert
      await repo.insert({ id: "item_1", name: "Widget A", quantity: 10 });
      await repo.insert({ id: "item_2", name: "Widget B", quantity: 20 });

      // FindById
      const item1 = await repo.findById("item_1");
      expect(item1).toBeDefined();
      expect(item1?.name).toBe("Widget A");
      expect(item1?.quantity).toBe(10);

      // FindAll
      const all = await repo.findAll({
        orderBy: "quantity",
        orderDirection: "DESC",
      });
      expect(all).toHaveLength(2);
      expect(all[0]?.id).toBe("item_2");

      // Update
      await repo.update("item_1", { quantity: 15 });
      const updated = await repo.findById("item_1");
      expect(updated?.quantity).toBe(15);

      // SoftDelete
      await repo.softDelete("item_1", "user_admin");
      const deleted = await repo.findById("item_1");
      expect(deleted?.deleted_at).toBeDefined();
      expect(deleted?.deleted_by).toBe("user_admin");
      expect(deleted?.delete_operation_id?.startsWith("del_")).toBe(true);
    });

    it("excludes soft-deleted rows from findAll by default", async () => {
      await db.execute(`
        CREATE TABLE test_items (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          deleted_at TEXT,
          deleted_by TEXT,
          delete_operation_id TEXT
        );
      `);
      const repo = new TestItemRepository(db);
      await repo.insert({ id: "i1", name: "Active", quantity: 5 });
      await repo.insert({ id: "i2", name: "Deleted", quantity: 5 });
      await repo.softDelete("i2", "sys");

      const active = await repo.findAll();
      expect(active).toHaveLength(1);
      expect(active[0]?.id).toBe("i1");
    });
  });

  describe("Nested transactions (savepoints)", () => {
    it("commits outer and inner transactions independently", async () => {
      await db.execute(
        "CREATE TABLE ledger (id TEXT PRIMARY KEY, amount INTEGER);",
      );

      await db.transaction(async (outerTx) => {
        await outerTx.execute("INSERT INTO ledger (id, amount) VALUES (?, ?)", [
          "outer",
          100,
        ]);

        // Nested inner transaction (uses savepoint)
        await db.transaction(async (innerTx) => {
          await innerTx.execute(
            "INSERT INTO ledger (id, amount) VALUES (?, ?)",
            ["inner", 200],
          );
        });
      });

      const rows = await db.query<{ id: string; amount: number }>(
        "SELECT * FROM ledger ORDER BY id",
      );
      expect(rows).toHaveLength(2);
    });

    it("rolls back inner savepoint without affecting outer transaction", async () => {
      await db.execute(
        "CREATE TABLE ledger (id TEXT PRIMARY KEY, amount INTEGER);",
      );

      await db.transaction(async (outerTx) => {
        await outerTx.execute("INSERT INTO ledger (id, amount) VALUES (?, ?)", [
          "outer",
          100,
        ]);

        // Inner transaction that fails
        await expect(
          db.transaction(async (innerTx) => {
            await innerTx.execute(
              "INSERT INTO ledger (id, amount) VALUES (?, ?)",
              ["inner", 200],
            );
            throw new Error("Inner failure");
          }),
        ).rejects.toThrow("Inner failure");
      });

      // Only outer row committed
      const rows = await db.query<{ id: string }>(
        "SELECT id FROM ledger ORDER BY id",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe("outer");
    });
  });

  describe("MigrationEngine — failure handling", () => {
    it("does not record a failed migration and leaves DB clean", async () => {
      const engine = new MigrationEngine(db);

      const migrations: MigrationScript[] = [
        {
          version: 1,
          name: "valid_migration",
          sql: "CREATE TABLE valid_table (id TEXT PRIMARY KEY);",
          checksum: "chk_v",
        },
        {
          version: 2,
          name: "broken_migration",
          sql: "THIS IS NOT VALID SQL;;;",
          checksum: "chk_b",
        },
      ];

      await expect(engine.applyMigrations(migrations)).rejects.toThrow();

      // Only version 1 should be recorded
      const applied = await engine.getAppliedVersions();
      expect(applied).toEqual([1]);
    });
  });
});
