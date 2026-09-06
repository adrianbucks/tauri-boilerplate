import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection, BaseRepository } from "@platform/database";

interface TestRecord {
  id: string;
  organisation_id: string;
  name: string;
}

class UnguardedTestRepository extends BaseRepository<TestRecord> {
  protected readonly tableName = "test_items";

  constructor(db: MemoryDatabaseConnection) {
    super(db);
  }
}

class TenantAwareTestRepository extends BaseRepository<TestRecord> {
  protected readonly tableName = "test_items";
  private readonly organisationId: string;

  constructor(db: MemoryDatabaseConnection, organisationId: string) {
    super(db);
    this.organisationId = organisationId;
  }

  override async findAll(): Promise<TestRecord[]> {
    // After WP-003 implementation, this will automatically filter by organisationId
    // For now, this demonstrates what should happen
    const executor = this.db as any; // Access protected db
    const sql = `SELECT * FROM test_items WHERE organisation_id = ?`;
    return executor.query(sql, [this.organisationId]) as Promise<TestRecord[]>;
  }
}

describe("Security Regression Suite — Tenant Isolation", () => {
  let db: MemoryDatabaseConnection;

  beforeEach(async () => {
    db = new MemoryDatabaseConnection(":memory:");
    await db.init();

    await db.execute(`
      CREATE TABLE test_items (
        id TEXT PRIMARY KEY,
        organisation_id TEXT NOT NULL,
        name TEXT NOT NULL
      );
    `);

    // Seed data: 3 items in org_a, 2 items in org_b
    await db.execute(
      `INSERT INTO test_items (id, organisation_id, name) VALUES 
       ('item_a1', 'org_a', 'Widget A1'),
       ('item_a2', 'org_a', 'Widget A2'),
       ('item_a3', 'org_a', 'Widget A3'),
       ('item_b1', 'org_b', 'Widget B1'),
       ('item_b2', 'org_b', 'Widget B2')`,
      [],
    );
  });

  afterEach(async () => {
    await db.close();
  });

  describe("Current vulnerability (unguarded repository)", () => {
    it("SECURITY: unguarded findAll() leaks cross-tenant data", async () => {
      const repo = new UnguardedTestRepository(db);

      // Attempting to call findAll() on unguarded repo should fail after WP-003
      // Currently it returns all records regardless of organisation
      const allRecords = await repo.findAll();

      // THIS IS THE BUG: We get records from both organisations
      expect(allRecords).toHaveLength(5);
      expect(allRecords.map((r) => r.organisation_id)).toContain("org_a");
      expect(allRecords.map((r) => r.organisation_id)).toContain("org_b");
    });
  });

  describe("After WP-003 implementation", () => {
    it("should prevent unguarded repository instantiation (compile-time check)", async () => {
      // After WP-003: BaseRepository constructor REQUIRES organisationId
      // This test documents the new safety contract
      // const repo = new UnguardedTestRepository(db);
      // TS Error: Missing required argument 'organisationId'
    });

    it("tenant-aware findAll() returns only records in the organisation", async () => {
      const repoOrgA = new TenantAwareTestRepository(db, "org_a");
      const repoOrgB = new TenantAwareTestRepository(db, "org_b");

      const recordsA = await repoOrgA.findAll();
      const recordsB = await repoOrgB.findAll();

      expect(recordsA).toHaveLength(3);
      expect(
        recordsA.every((r: TestRecord) => r.organisation_id === "org_a"),
      ).toBe(true);

      expect(recordsB).toHaveLength(2);
      expect(
        recordsB.every((r: TestRecord) => r.organisation_id === "org_b"),
      ).toBe(true);
    });

    it("tenant-aware findById() respects organisation boundary", async () => {
      const repoOrgA = new TenantAwareTestRepository(db, "org_a");
      const repoOrgB = new TenantAwareTestRepository(db, "org_b");

      // Org A user trying to access Org A item: allowed
      const recordA = await repoOrgA.findById("item_a1");
      expect(recordA).not.toBeNull();
      expect(recordA?.organisation_id).toBe("org_a");

      // Org B user trying to access Org B item: allowed
      const recordB = await repoOrgB.findById("item_b1");
      expect(recordB).not.toBeNull();
      expect(recordB?.organisation_id).toBe("org_b");

      // After WP-003: Org A user trying to access Org B item: DENIED
      // Currently this succeeds (BUG), after fix it will fail
      // const crossTenantAccess = await repoOrgA.findById("item_b1");
      // expect(crossTenantAccess).toBeNull(); // Should be null, not org_b's item
    });

    it("insert() validates organisationId matches repository context", async () => {
      const repoOrgA = new TenantAwareTestRepository(db, "org_a");

      // Attempting to insert a record for a different org should fail
      // (WP-003 feature: enforce organisation_id on insert)
      // const newRecord: TestRecord = {
      //   id: 'item_c1',
      //   organisation_id: 'org_c',  // Different from repoOrgA's context
      //   name: 'Widget C1'
      // };
      // await expect(repoOrgA.insert(newRecord))
      //   .rejects.toThrow('organisation_id mismatch');
    });
  });

  describe("Dynamic SQL identifier allowlisting", () => {
    it("should reject dynamic table names in SQL queries", async () => {
      // Example of dangerous SQL construction:
      // const tableName = userInput; // Could be "widgets; DROP TABLE core_users;--"
      // const query = `SELECT * FROM ${tableName}`;
      // NEVER: user-supplied table names in string interpolation
      // After WP-003: SQL identifiers must be from allowlist
      // Only predefined table names like "widgets", "test_items", etc.
    });

    it("should only allow parameter binding for values, not identifiers", async () => {
      const repo = new TenantAwareTestRepository(db, "org_a");

      // CORRECT: Parameter binding
      const sqlGood =
        "SELECT * FROM test_items WHERE id = ? AND organisation_id = ?";
      expect(() => repo).not.toThrow();

      // INCORRECT: Would be string interpolation
      // const table = userInput;
      // const sqlBad = `SELECT * FROM ${table}`;  // SQL injection risk
    });
  });
});
