import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { createOperationContext } from "@platform/core";
import {
  ImportEngine,
  ExportEngine,
  type ImportDefinition,
  type ExportDefinition,
} from "./index.js";

interface TestItem {
  id: string;
  sku: string;
  name: string;
  quantity: number;
}

describe("@platform/import-export", () => {
  let db: MemoryDatabaseConnection;
  let importEngine: ImportEngine;
  const ctx = createOperationContext({
    deviceId: "dev_test",
    organisationId: "org_acme",
    userId: "user_admin",
  });

  const testImportDef: ImportDefinition<TestItem> = {
    id: "import_test_items",
    entityName: "TestItem",
    acceptedFormats: ["csv", "xlsx"],
    columns: [
      { key: "sku", label: "SKU", type: "string", required: true },
      { key: "name", label: "Item Name", type: "string", required: true },
      { key: "quantity", label: "Quantity", type: "number", required: true },
    ],
    validateRow: (row, rowIndex) => {
      const sku = String(row["sku"] ?? row["SKU"] ?? "").trim();
      const name = String(row["name"] ?? row["Item Name"] ?? "").trim();
      const qty = parseInt(
        String(row["quantity"] ?? row["Quantity"] ?? "0"),
        10,
      );

      if (!sku) {
        return {
          valid: false,
          errors: [
            {
              rowIndex,
              columnKey: "sku",
              message: "SKU is required",
              invalidValue: sku,
            },
          ],
        };
      }

      return {
        valid: true,
        data: { id: `item_${sku.toLowerCase()}`, sku, name, quantity: qty },
      };
    },
    commit: async (records, dbConn, _ctx, tx) => {
      const executor = tx ?? dbConn;
      for (const rec of records) {
        await executor.execute(
          "INSERT INTO test_items (id, sku, name, quantity) VALUES (?, ?, ?, ?)",
          [rec.id, rec.sku, rec.name, rec.quantity],
        );
      }
      return { importedCount: records.length };
    },
  };

  const testExportDef: ExportDefinition<TestItem> = {
    sheetName: "ItemsExport",
    columns: [
      { header: "SKU", accessor: (r) => r.sku },
      { header: "Name", accessor: (r) => r.name },
      { header: "Quantity", accessor: (r) => r.quantity },
    ],
  };

  beforeEach(async () => {
    db = new MemoryDatabaseConnection(":memory:");
    await db.init();

    await db.execute(`
      CREATE TABLE test_items (
        id TEXT PRIMARY KEY,
        sku TEXT NOT NULL,
        name TEXT NOT NULL,
        quantity INTEGER NOT NULL
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
    `);

    importEngine = new ImportEngine(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("exports records to CSV format with proper headers and escaping", () => {
    const items: TestItem[] = [
      { id: "1", sku: "SKU-001", name: "Standard Bolt", quantity: 50 },
      { id: "2", sku: "SKU-002", name: 'Nut, Hex 1/2"', quantity: 100 },
    ];

    const csv = ExportEngine.toCsv(items, testExportDef);
    expect(csv).toContain("SKU,Name,Quantity");
    expect(csv).toContain("SKU-001,Standard Bolt,50");
    expect(csv).toContain('SKU-002,"Nut, Hex 1/2""",100');
  });

  it("exports records to XLSX binary buffer", () => {
    const items: TestItem[] = [
      { id: "1", sku: "SKU-001", name: "Standard Bolt", quantity: 50 },
    ];

    const buffer = ExportEngine.toXlsx(items, testExportDef);
    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("imports valid CSV buffer, commits atomically, and emits audit events", async () => {
    const csvContent =
      "SKU,Item Name,Quantity\r\nSKU-A1,Widget Alpha,25\r\nSKU-B2,Widget Beta,40";
    const buffer = new TextEncoder().encode(csvContent);

    const summary = await importEngine.executeImport(
      buffer,
      testImportDef,
      ctx,
    );

    expect(summary.successfulRows).toBe(2);
    expect(summary.failedRows).toBe(0);

    const rows = await db.query<TestItem>("SELECT * FROM test_items");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.sku).toBe("SKU-A1");

    const auditEvents = await db.query<{ event_type: string }>(
      "SELECT event_type FROM core_audit_events",
    );
    expect(auditEvents.some((e) => e.event_type === "IMPORT_STARTED")).toBe(
      true,
    );
    expect(auditEvents.some((e) => e.event_type === "IMPORT_COMPLETED")).toBe(
      true,
    );
  });

  it("aborts import transaction on validation failure with error report", async () => {
    const csvContent = "SKU,Item Name,Quantity\r\n,Missing SKU Widget,25";
    const buffer = new TextEncoder().encode(csvContent);

    const summary = await importEngine.executeImport(
      buffer,
      testImportDef,
      ctx,
    );

    expect(summary.successfulRows).toBe(0);
    expect(summary.failedRows).toBe(1);
    expect(summary.errors[0]?.message).toBe("SKU is required");

    // No rows inserted
    const rows = await db.query<TestItem>("SELECT * FROM test_items");
    expect(rows).toHaveLength(0);

    // Audit event recorded failure
    const auditEvents = await db.query<{ event_type: string }>(
      "SELECT event_type FROM core_audit_events WHERE event_type = ?",
      ["IMPORT_FAILED"],
    );
    expect(auditEvents).toHaveLength(1);
  });
});
