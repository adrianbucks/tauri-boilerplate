import * as XLSX from "xlsx";
import type { ExportDefinition } from "../types.js";

export class ExportEngine {
  /**
   * Generates a CSV string representation of records based on ExportDefinition.
   */
  static toCsv<T>(records: T[], definition: ExportDefinition<T>): string {
    const headerRow = definition.columns
      .map((c) => this.escapeCsv(c.header))
      .join(",");
    const dataRows = records.map((record) =>
      definition.columns
        .map((col) => {
          const val = col.accessor(record);
          return this.escapeCsv(
            val === null || val === undefined ? "" : String(val),
          );
        })
        .join(","),
    );

    return [headerRow, ...dataRows].join("\r\n");
  }

  /**
   * Generates an XLSX binary buffer representation of records based on ExportDefinition.
   */
  static toXlsx<T>(records: T[], definition: ExportDefinition<T>): Uint8Array {
    const rawData = records.map((record) => {
      const rowObj: Record<string, unknown> = {};
      definition.columns.forEach((col) => {
        rowObj[col.header] = col.accessor(record) ?? "";
      });
      return rowObj;
    });

    const worksheet = XLSX.utils.json_to_sheet(rawData);
    const workbook = XLSX.utils.book_new();
    const sheetName = definition.sheetName ?? "Export";

    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    return new Uint8Array(buffer);
  }

  private static escapeCsv(value: string): string {
    if (
      value.includes(",") ||
      value.includes('"') ||
      value.includes("\n") ||
      value.includes("\r")
    ) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
