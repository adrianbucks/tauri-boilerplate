import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "@platform/core";
import {
  BaseRepository,
  MemoryDatabaseConnection,
  type DatabaseConnection,
} from "@platform/database";

interface ItemRecord {
  id: string;
  name: string;
  quantity: number;
}

class ItemRepository extends BaseRepository<ItemRecord> {
  protected readonly tableName = "security_items";
}

describe("Security Regression Suite — Repository SQL and Pagination Bounds", () => {
  let db: MemoryDatabaseConnection;
  let repository: ItemRepository;

  beforeEach(async () => {
    db = new MemoryDatabaseConnection(":memory:");
    await db.init();
    await db.execute(
      "CREATE TABLE security_items (id TEXT PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL);",
    );
    repository = new ItemRepository(db as DatabaseConnection);
    await repository.insert({ id: "item_1", name: "Original", quantity: 3 });
  });

  afterEach(async () => {
    await db.close();
  });

  it("rejects injected sort identifiers without changing stored rows", async () => {
    await expect(
      repository.findAll({ orderBy: "name; DROP TABLE security_items; --" }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(db.query("SELECT id FROM security_items")).resolves.toEqual([{ id: "item_1" }]);
  });

  it("rejects injected runtime update keys before executing SQL", async () => {
    const update = {
      "name = 'Changed'; DROP TABLE security_items; --": "Changed",
    } as unknown as Partial<ItemRecord>;

    await expect(repository.update("item_1", update)).rejects.toBeInstanceOf(ValidationError);

    await expect(
      db.query("SELECT name FROM security_items WHERE id = ?", ["item_1"]),
    ).resolves.toEqual([{ name: "Original" }]);
  });

  it("rejects injected runtime insert keys before executing SQL", async () => {
    const record = {
      id: "item_2",
      name: "Another",
      quantity: 4,
      "name) VALUES ('item_3', 'Injected', 5); DROP TABLE security_items; --": "Injected",
    } as unknown as ItemRecord;

    await expect(repository.insert(record)).rejects.toBeInstanceOf(ValidationError);

    await expect(db.query("SELECT COUNT(*) AS count FROM security_items")).resolves.toEqual([
      { count: 1 },
    ]);
  });

  it("rejects an invalid runtime sort direction", async () => {
    await expect(
      repository.findAll({
        orderBy: "name",
        orderDirection: "DESC; DROP TABLE security_items" as "DESC",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(db.query("SELECT id FROM security_items")).resolves.toEqual([{ id: "item_1" }]);
  });

  it("rejects invalid or unbounded pagination before querying rows", async () => {
    for (const limit of [-1, 1.5, Number.NaN, 1_001]) {
      await expect(repository.findAll({ limit })).rejects.toBeInstanceOf(ValidationError);
    }
    for (const offset of [-1, 1.5, Number.NaN]) {
      await expect(repository.findAll({ limit: 10, offset })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    await expect(repository.findAll({ offset: 1 })).rejects.toBeInstanceOf(ValidationError);

    await expect(db.query("SELECT id FROM security_items")).resolves.toEqual([{ id: "item_1" }]);
  });
});
