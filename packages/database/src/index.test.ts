import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  MemoryDatabaseConnection,
  NativeDatabaseConnection,
  MigrationEngine,
  BaseRepository,
  type MigrationScript,
  type TransactionClient,
} from "./index.js";
import { DatabaseError } from "@platform/core";

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

class UnsafeTableRepository extends BaseRepository<TestItem> {
  protected readonly tableName = "test_items; DROP TABLE test_items;--";
}

class PlainItemRepository extends BaseRepository<TestItem> {
  protected readonly tableName = "plain_items";
}

function nativeDatabaseHealthResponse(overrides: Record<string, unknown> = {}) {
  return {
    db_path: "test.db",
    sqlite_version: "3.46.0",
    journal_mode: "wal",
    foreign_keys_enabled: true,
    integrity_check: "ok",
    ...overrides,
  };
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
      expect(health.walEnabled).toBe(false);
      expect(health.foreignKeysEnabled).toBe(true);
      expect(health.integrityCheck).toBe("ok");
    });

    it("enforces foreign keys in the in-memory SQLite engine", async () => {
      await db.execute("CREATE TABLE parent (id TEXT PRIMARY KEY);");
      await db.execute(
        "CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id));",
      );

      await expect(
        db.execute("INSERT INTO child (id, parent_id) VALUES (?, ?);", ["c1", "missing"]),
      ).rejects.toThrow("Database execute failed");
    });

    it("marks the connection unhealthy when a required database invariant is disabled", async () => {
      await db.execute("PRAGMA foreign_keys = OFF;");

      const health = await db.healthCheck();

      expect(health.foreignKeysEnabled).toBe(false);
      expect(health.healthy).toBe(false);
    });

    it("executes queries with parameter binding", async () => {
      await db.execute("CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT);");
      await db.execute("INSERT INTO users (id, name) VALUES (?, ?);", ["u1", "Alice"]);

      const rows = await db.query<{ id: string; name: string }>(
        "SELECT * FROM users WHERE id = ?;",
        ["u1"],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe("Alice");
    });

    it("keeps the connection usable after query parameter binding fails", async () => {
      await expect(db.query("SELECT ? AS value;", [{}])).rejects.toThrow(DatabaseError);

      const rows = await db.query<{ value: number }>("SELECT 1 AS value;");
      expect(rows).toEqual([{ value: 1 }]);
    });

    it("rolls back transaction on error", async () => {
      await db.execute("CREATE TABLE accounts (id TEXT PRIMARY KEY, balance INTEGER);");
      await db.execute("INSERT INTO accounts (id, balance) VALUES (?, ?);", ["a1", 100]);

      await expect(
        db.transaction(async (tx) => {
          await tx.execute("UPDATE accounts SET balance = 50 WHERE id = ?;", ["a1"]);
          throw new Error("Simulated transaction failure");
        }),
      ).rejects.toThrow("Simulated transaction failure");

      const rows = await db.query<{ balance: number }>(
        "SELECT balance FROM accounts WHERE id = ?;",
        ["a1"],
      );
      expect(rows[0]?.balance).toBe(100);
    });

    it("resets transaction state when the connection closes during a transaction", async () => {
      let releaseCallback: (() => void) | undefined;
      let markCallbackStarted: (() => void) | undefined;
      const callbackGate = new Promise<void>((resolve) => {
        releaseCallback = resolve;
      });
      const callbackStarted = new Promise<void>((resolve) => {
        markCallbackStarted = resolve;
      });
      const transaction = db.transaction(async () => {
        markCallbackStarted?.();
        await callbackGate;
      });

      await callbackStarted;
      await db.close();
      releaseCallback?.();

      await expect(transaction).rejects.toThrow();
      await expect(db.query<{ value: number }>("SELECT 1 AS value;")).resolves.toEqual([
        { value: 1 },
      ]);
      await expect(
        db.transaction((tx) => tx.query<{ value: number }>("SELECT 2 AS value;")),
      ).resolves.toEqual([{ value: 2 }]);
    });

    it("serializes independent transactions while preserving each transaction's writes", async () => {
      await db.execute("CREATE TABLE transaction_rows (id TEXT PRIMARY KEY);");
      let releaseFirst: (() => void) | undefined;
      let markFirstStarted: (() => void) | undefined;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const firstStarted = new Promise<void>((resolve) => {
        markFirstStarted = resolve;
      });

      const first = db.transaction(async (tx) => {
        await tx.execute("INSERT INTO transaction_rows (id) VALUES (?)", ["first"]);
        markFirstStarted?.();
        await firstGate;
        throw new Error("rollback first transaction");
      });
      await firstStarted;

      const second = db.transaction(async (tx) => {
        await tx.execute("INSERT INTO transaction_rows (id) VALUES (?)", ["second"]);
      });
      releaseFirst?.();

      await expect(first).rejects.toThrow("rollback first transaction");
      await second;
      const rows = await db.query<{ id: string }>("SELECT id FROM transaction_rows;");
      expect(rows).toEqual([{ id: "second" }]);
    });

    it("keeps ordinary writes outside an in-flight transaction", async () => {
      await db.execute("CREATE TABLE isolated_rows (id TEXT PRIMARY KEY);");
      let releaseTransaction!: () => void;
      let markTransactionStarted!: () => void;
      const transactionGate = new Promise<void>((resolve) => {
        releaseTransaction = resolve;
      });
      const transactionStarted = new Promise<void>((resolve) => {
        markTransactionStarted = resolve;
      });

      const transaction = db.transaction(async (tx) => {
        await tx.execute("INSERT INTO isolated_rows (id) VALUES (?)", ["rolled_back"]);
        markTransactionStarted();
        await transactionGate;
        throw new Error("rollback isolated transaction");
      });
      await transactionStarted;

      let ordinaryWriteFinished = false;
      const ordinaryWrite = db
        .execute("INSERT INTO isolated_rows (id) VALUES (?)", ["outside"])
        .then(() => {
          ordinaryWriteFinished = true;
        });
      await Promise.resolve();
      await Promise.resolve();
      expect(ordinaryWriteFinished).toBe(false);

      releaseTransaction();
      await expect(transaction).rejects.toThrow("rollback isolated transaction");
      await ordinaryWrite;
      const rows = await db.query<{ id: string }>("SELECT id FROM isolated_rows;");
      expect(rows).toEqual([{ id: "outside" }]);
    });

    it("rejects use of a memory transaction client after its callback completes", async () => {
      let completedClient: TransactionClient | undefined;
      await db.transaction(async (tx) => {
        completedClient = tx;
      });

      await expect(completedClient?.execute("SELECT 1;")).rejects.toThrow(
        "Transaction client is no longer active",
      );
    });
  });

  describe("NativeDatabaseConnection transaction boundary (B-01)", () => {
    it("rejects initialization when the native database is unhealthy", async () => {
      const nativeDb = new NativeDatabaseConnection(async () =>
        nativeDatabaseHealthResponse({ foreign_keys_enabled: false }),
      );

      await expect(nativeDb.init()).rejects.toThrow(DatabaseError);
    });

    it("rejects malformed native database responses", async () => {
      const nativeDb = new NativeDatabaseConnection(async (command) => {
        if (command === "get_database_health") return nativeDatabaseHealthResponse();
        if (command === "db_query") return { rows: "invalid" };
        return { rows_affected: 1.5 };
      });

      await expect(nativeDb.query("SELECT 1 AS value")).rejects.toThrow(DatabaseError);
      await expect(nativeDb.execute("UPDATE items SET value = 1")).rejects.toThrow(DatabaseError);
    });

    it("sends migration statements as separate operations in one native transaction", async () => {
      let transactionOperations: unknown;
      const nativeDb = new NativeDatabaseConnection(async (command, args) => {
        if (command === "get_database_health") return nativeDatabaseHealthResponse();
        if (command === "db_query") return { rows: [] };
        if (command === "db_execute") return { rows_affected: 1 };
        if (command === "db_transaction") {
          transactionOperations = args?.operations;
          return {};
        }
        throw new Error(`Unexpected native command: ${command}`);
      });

      await new MigrationEngine(nativeDb).applyMigrations([
        {
          version: 1,
          name: "multi_statement",
          checksum: "chk_multi_statement",
          sql: "CREATE TABLE migration_first (id TEXT); CREATE TABLE migration_second (id TEXT);",
        },
      ]);

      expect(transactionOperations).toEqual([
        { type: "execute", sql: "CREATE TABLE migration_first (id TEXT);", params: [] },
        { type: "execute", sql: " CREATE TABLE migration_second (id TEXT);", params: [] },
        {
          type: "execute",
          sql: expect.stringContaining("INSERT INTO core_migrations"),
          params: expect.arrayContaining(["platform", 1, "multi_statement", "chk_multi_statement"]),
        },
      ]);
    });

    it("rejects txClient.query() inside transaction callback with DatabaseError", async () => {
      const mockInvoke = async (command: string) =>
        command === "get_database_health" ? nativeDatabaseHealthResponse() : {};
      const nativeDb = new NativeDatabaseConnection(mockInvoke as any);
      await nativeDb.init();

      await expect(
        nativeDb.transaction(async (tx) => {
          await tx.query("SELECT * FROM users;");
        }),
      ).rejects.toThrow(DatabaseError);
    });

    it("allows txClient.execute() inside transaction callback and executes atomically", async () => {
      let invokedCmd = "";
      let invokedArgs: any = null;
      const mockInvoke = async (cmd: string, args: any) => {
        if (cmd === "get_database_health") return nativeDatabaseHealthResponse();
        invokedCmd = cmd;
        invokedArgs = args;
        return { success: true };
      };
      const nativeDb = new NativeDatabaseConnection(mockInvoke as any);
      await nativeDb.init();

      const result = await nativeDb.transaction(async (tx) => {
        const writeResult = await tx.execute("INSERT INTO users VALUES (?);", ["u1"]);
        expect(writeResult.rowsAffected).toBeUndefined();
        return "success_val";
      });

      expect(result).toBe("success_val");
      expect(invokedCmd).toBe("db_transaction");
      expect(invokedArgs?.operations).toEqual([
        {
          type: "execute",
          sql: "INSERT INTO users VALUES (?);",
          params: ["u1"],
        },
      ]);
    });

    it("discards failed savepoint operations and closes nested transaction clients", async () => {
      let invokedArgs: any = null;
      const nativeDb = new NativeDatabaseConnection(async (command, args) => {
        if (command === "get_database_health") return nativeDatabaseHealthResponse();
        invokedArgs = args;
        return { success: true };
      });
      await nativeDb.init();
      let nestedClient: TransactionClient | undefined;

      await nativeDb.transaction(async (tx) => {
        await tx.execute("INSERT INTO rows VALUES (?)", ["outer"]);
        await expect(
          tx.savepoint(async (nested) => {
            nestedClient = nested;
            await nested.execute("INSERT INTO rows VALUES (?)", ["discard"]);
            throw new Error("rollback savepoint");
          }),
        ).rejects.toThrow("rollback savepoint");
        await tx.execute("INSERT INTO rows VALUES (?)", ["after"]);
      });

      expect(invokedArgs.operations).toEqual([
        { type: "execute", sql: "INSERT INTO rows VALUES (?)", params: ["outer"] },
        { type: "execute", sql: "INSERT INTO rows VALUES (?)", params: ["after"] },
      ]);
      await expect(nestedClient?.execute("SELECT 1;")).rejects.toThrow(
        "Transaction client is no longer active",
      );
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

      const rows = await db.query<{ body: string }>("SELECT body FROM messages WHERE id = ?", [
        "m1",
      ]);
      expect(rows[0]?.body).toBe("wait; then continue");
    });

    it("splits migration scripts without breaking trigger bodies", async () => {
      const engine = new MigrationEngine(db);
      await engine.applyMigrations([
        {
          version: 1,
          name: "create_trigger_tables",
          checksum: "chk_trigger",
          sql: `
            CREATE TABLE trigger_source (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE trigger_audit (source_id INTEGER NOT NULL, value TEXT NOT NULL);
            CREATE TRIGGER record_trigger_source_insert
            AFTER INSERT ON trigger_source
            BEGIN
              INSERT INTO trigger_audit (source_id, value) VALUES (NEW.id, NEW.value);
              UPDATE trigger_source
              SET value = CASE WHEN NEW.value = 'semi;colon' THEN 'trigger;ok' ELSE NEW.value END
              WHERE id = NEW.id;
            END;
            INSERT INTO trigger_source (value) VALUES ('semi;colon');
          `,
        },
      ]);

      await expect(db.query("SELECT value FROM trigger_source")).resolves.toEqual([
        { value: "trigger;ok" },
      ]);
      await expect(db.query("SELECT value FROM trigger_audit")).resolves.toEqual([
        { value: "semi;colon" },
      ]);
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
        engine.applyMigrations([{ ...migration, checksum: "changed_checksum" }]),
      ).rejects.toMatchObject({
        code: "MIGRATION_ERROR",
        message: "Migration checksum mismatch for platform:v1 ('create_checksum_test')",
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

    it("rejects empty insert records before building SQL", async () => {
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

      await expect(repo.insert({} as TestItem)).rejects.toThrow(
        "Repository insert requires at least one record field",
      );
      await expect(db.query("SELECT 1 AS value;")).resolves.toEqual([{ value: 1 }]);
    });

    it("rejects fields that normalize to the same SQL column", async () => {
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

      await expect(
        repo.insert({
          id: "i1",
          name: "Item",
          quantity: 1,
          createdAt: "first",
          created_at: "second",
        } as unknown as TestItem),
      ).rejects.toThrow("multiple fields for the same SQL column");
      await expect(
        repo.update("i1", { createdAt: "first", created_at: "second" } as Partial<TestItem>),
      ).rejects.toThrow("multiple fields for the same SQL column");
      await expect(db.query("SELECT 1 AS value;")).resolves.toEqual([{ value: 1 }]);
    });

    it("rejects unsafe table names before constructing repository SQL", async () => {
      const repository = new UnsafeTableRepository(db);

      await expect(repository.findById("i1")).rejects.toThrow("Invalid SQL table name");
      await expect(db.query("SELECT 1 AS value;")).resolves.toEqual([{ value: 1 }]);
    });

    it("rejects soft deletion for repositories without tombstone support", async () => {
      const repository = new PlainItemRepository(db);

      await expect(repository.softDelete("i1", "user_1")).rejects.toThrow(
        "does not support soft deletion",
      );
      await expect(db.query("SELECT 1 AS value;")).resolves.toEqual([{ value: 1 }]);
    });
  });

  describe("Nested transaction savepoints", () => {
    it("commits outer and inner transactions independently", async () => {
      await db.execute("CREATE TABLE ledger (id TEXT PRIMARY KEY, amount INTEGER);");

      await db.transaction(async (outerTx) => {
        await outerTx.execute("INSERT INTO ledger (id, amount) VALUES (?, ?)", ["outer", 100]);

        // Nested inner transaction (uses savepoint)
        await outerTx.savepoint(async (innerTx) => {
          await innerTx.execute("INSERT INTO ledger (id, amount) VALUES (?, ?)", ["inner", 200]);
        });
      });

      const rows = await db.query<{ id: string; amount: number }>(
        "SELECT * FROM ledger ORDER BY id",
      );
      expect(rows).toHaveLength(2);
    });

    it("rolls back inner savepoint without affecting outer transaction", async () => {
      await db.execute("CREATE TABLE ledger (id TEXT PRIMARY KEY, amount INTEGER);");

      await db.transaction(async (outerTx) => {
        await outerTx.execute("INSERT INTO ledger (id, amount) VALUES (?, ?)", ["outer", 100]);

        // Inner transaction that fails
        await expect(
          outerTx.savepoint(async (innerTx) => {
            await innerTx.execute("INSERT INTO ledger (id, amount) VALUES (?, ?)", ["inner", 200]);
            throw new Error("Inner failure");
          }),
        ).rejects.toThrow("Inner failure");
      });

      // Only outer row committed
      const rows = await db.query<{ id: string }>("SELECT id FROM ledger ORDER BY id");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe("outer");
    });
  });

  describe("MigrationEngine — failure handling", () => {
    it("rejects duplicate migration identities before applying any migration", async () => {
      const engine = new MigrationEngine(db);
      const migrations: MigrationScript[] = [
        {
          version: 1,
          name: "first_definition",
          sql: "CREATE TABLE should_not_exist (id TEXT PRIMARY KEY);",
          checksum: "chk_1a",
        },
        {
          version: 1,
          name: "duplicate_definition",
          sql: "CREATE TABLE also_should_not_exist (id TEXT PRIMARY KEY);",
          checksum: "chk_1b",
        },
      ];

      await expect(engine.applyMigrations(migrations)).rejects.toThrow(
        "Duplicate migration identity 'platform:1'",
      );
      await expect(
        db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [
          "should_not_exist",
        ]),
      ).resolves.toEqual([]);
    });

    it("rejects invalid migration metadata before creating migration state", async () => {
      const engine = new MigrationEngine(db);
      await expect(
        engine.applyMigrations([
          { version: 0, name: "invalid", sql: "SELECT 1;", checksum: "checksum" },
        ]),
      ).rejects.toThrow("Migration definitions require");
      await expect(
        db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [
          "core_migrations",
        ]),
      ).resolves.toEqual([]);
    });

    it("rejects gaps in a new migration sequence before creating migration state", async () => {
      const engine = new MigrationEngine(db);

      await expect(
        engine.applyMigrations([
          { version: 1, name: "initial", sql: "SELECT 1;", checksum: "chk_1" },
          { version: 3, name: "later", sql: "SELECT 3;", checksum: "chk_3" },
        ]),
      ).rejects.toMatchObject({
        code: "MIGRATION_ERROR",
        correlationId: "mig_sequence_platform_v2",
      });
      await expect(
        db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [
          "core_migrations",
        ]),
      ).resolves.toEqual([]);
    });

    it("rejects migration history missing from the supplied owner set", async () => {
      const engine = new MigrationEngine(db);
      await engine.applyMigrations([
        {
          version: 1,
          name: "initial_schema",
          sql: "CREATE TABLE migration_history (id TEXT PRIMARY KEY);",
          checksum: "initial_checksum",
          owner: "feature.widgets",
        },
      ]);

      await expect(
        engine.applyMigrations([
          {
            version: 2,
            name: "add_index",
            sql: "CREATE INDEX idx_migration_history_id ON migration_history(id);",
            checksum: "next_checksum",
            owner: "feature.widgets",
          },
        ]),
      ).rejects.toThrow("Applied migration 'feature.widgets:v1' is missing");
      await expect(
        db.query("SELECT version FROM core_migrations WHERE owner = ?", ["feature.widgets"]),
      ).resolves.toEqual([{ version: 1 }]);
    });

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
