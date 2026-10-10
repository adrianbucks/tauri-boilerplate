import * as XLSX from "xlsx";
import { ValidationError } from "@platform/core";
import type { ExportDefinition } from "../types.js";

export class ExportEngine {
  private static validateDefinition<T>(definition: ExportDefinition<T>): void {
    if (definition.columns.length === 0) {
      throw new ValidationError({
        message: "Export definition must contain at least one column",
        userMessage: "The export configuration is invalid",
        correlationId: "exp_empty_columns",
      });
    }

    const headers = new Set<string>();
    for (const column of definition.columns) {
      if (!column.header.trim()) {
        throw new ValidationError({
          message: "Export column headers must not be empty",
          userMessage: "The export configuration is invalid",
          correlationId: "exp_empty_header",
        });
      }
      const safeHeader = this.sanitizeSpreadsheetString(column.header);
      if (headers.has(safeHeader)) {
        throw new ValidationError({
          message: `Duplicate export column header '${column.header}'`,
          userMessage: "The export configuration contains duplicate columns",
          correlationId: "exp_duplicate_header",
        });
      }
      headers.add(safeHeader);
    }
  }

  private static validateSheetName(sheetName: string): void {
    if (
      !sheetName.trim() ||
      sheetName.length > 31 ||
      /[\\/?*\[\]:]/.test(sheetName) ||
      sheetName.startsWith("'") ||
      sheetName.endsWith("'")
    ) {
      throw new ValidationError({
        message: `Invalid XLSX worksheet name '${sheetName}'`,
        userMessage: "The export worksheet name is invalid",
        correlationId: "exp_sheet_name",
      });
    }
  }

  /**
   * Generates a CSV string representation of records based on ExportDefinition.
   */
  static toCsv<T>(records: T[], definition: ExportDefinition<T>): string {
    this.validateDefinition(definition);
    const headerRow = definition.columns
      .map((c) => this.escapeCsv(this.sanitizeSpreadsheetString(c.header)))
      .join(",");
    const dataRows = records.map((record) =>
      definition.columns
        .map((col) => {
          const val = col.accessor(record);
          return this.escapeCsv(
            val === null || val === undefined
              ? ""
              : typeof val === "string"
                ? this.sanitizeSpreadsheetString(val)
                : String(val),
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
    this.validateDefinition(definition);
    const sheetName = definition.sheetName ?? "Export";
    this.validateSheetName(sheetName);

    const rawData = records.map((record) => {
      const rowObj: Record<string, unknown> = {};
      definition.columns.forEach((col) => {
        const value = col.accessor(record);
        rowObj[this.sanitizeSpreadsheetString(col.header)] =
          typeof value === "string" ? this.sanitizeSpreadsheetString(value) : (value ?? "");
      });
      return rowObj;
    });

    const worksheet = XLSX.utils.json_to_sheet(rawData);
    const workbook = XLSX.utils.book_new();

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

  private static sanitizeSpreadsheetString(value: string): string {
    return /^[\s\uFEFF]*[=+\-@]/.test(value) ? `'${value}` : value;
  }
}
