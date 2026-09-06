import * as XLSX from "xlsx";
import {
  ValidationError,
  getUtcIsoTimestamp,
  type OperationContext,
} from "@platform/core";
import type { DatabaseConnection } from "@platform/database";
import { AuditService } from "@platform/audit";
import type {
  ImportDefinition,
  ImportSummary,
  RowValidationError,
  ImportValidationResult,
} from "../types.js";

export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_SHEETS = 8;
export const MAX_IMPORT_ROWS = 10_000;
export const MAX_IMPORT_CELLS = 100_000;
export const MAX_IMPORT_CELL_STRING_LENGTH = 64 * 1024;
export const MAX_IMPORT_PARSE_MS = 5_000;

export class ImportEngine {
  private readonly db: DatabaseConnection;
  private readonly audit: AuditService;

  constructor(db: DatabaseConnection) {
    this.db = db;
    this.audit = new AuditService(db);
  }

  /**
   * Parses raw file buffer (CSV or XLSX) into an array of object records.
   */
  parseBuffer(buffer: ArrayBuffer | Uint8Array): Record<string, unknown>[] {
    const parseStartedAt = Date.now();
    if (buffer.byteLength > MAX_IMPORT_FILE_BYTES) {
      throw new ValidationError({
        message: "Import file exceeds the maximum allowed size",
        userMessage: "The uploaded file is too large",
        correlationId: "imp_file_size_limit",
      });
    }

    const workbook = XLSX.read(buffer, {
      type: "array",
      sheetRows: MAX_IMPORT_ROWS + 2,
    });
    this.assertParseBudget(parseStartedAt);
    if (workbook.SheetNames.length > MAX_IMPORT_SHEETS) {
      throw new ValidationError({
        message: "Workbook exceeds the maximum sheet count",
        userMessage: "The uploaded workbook has too many sheets",
        correlationId: "imp_sheet_limit",
      });
    }
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new ValidationError({
        message: "Spreadsheet contains no sheets",
        userMessage: "The uploaded file is empty",
        correlationId: "imp_empty_file",
      });
    }

    const worksheet = workbook.Sheets[firstSheetName];
    if (!worksheet) return [];

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: null,
      raw: false,
    });
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new ValidationError({
        message: "Worksheet exceeds the maximum row count",
        userMessage: "The uploaded worksheet has too many rows",
        correlationId: "imp_row_limit",
      });
    }

    let cellCount = 0;
    for (const row of rows) {
      cellCount += Object.keys(row).length;
      if (cellCount > MAX_IMPORT_CELLS) {
        throw new ValidationError({
          message: "Worksheet exceeds the maximum cell count",
          userMessage: "The uploaded worksheet has too many cells",
          correlationId: "imp_cell_limit",
        });
      }
      for (const value of Object.values(row)) {
        if (
          typeof value === "string" &&
          value.length > MAX_IMPORT_CELL_STRING_LENGTH
        ) {
          throw new ValidationError({
            message: "Worksheet contains an oversized cell",
            userMessage:
              "The uploaded worksheet contains a value that is too large",
            correlationId: "imp_cell_string_limit",
          });
        }
      }
    }
    this.assertParseBudget(parseStartedAt);
    return rows;
  }

  private assertParseBudget(parseStartedAt: number): void {
    if (Date.now() - parseStartedAt > MAX_IMPORT_PARSE_MS) {
      throw new ValidationError({
        message: "Spreadsheet parsing exceeded the resource budget",
        userMessage: "The uploaded file took too long to process",
        correlationId: "imp_parse_budget",
      });
    }
  }

  /**
   * Validates parsed spreadsheet rows against an ImportDefinition without committing.
   */
  validate<T>(
    rows: Record<string, unknown>[],
    definition: Pick<ImportDefinition<T>, "validateRow">,
  ): ImportValidationResult<T> {
    const validRows: T[] = [];
    const errors: RowValidationError[] = [];

    rows.forEach((rawRow, idx) => {
      const rowIndex = idx + 2; // 1-indexed, accounting for header row
      const result = definition.validateRow(rawRow, rowIndex);

      if (result.valid && result.data) {
        validRows.push(result.data);
      } else if (result.errors) {
        errors.push(...result.errors);
      }
    });

    return {
      validRows,
      errors,
      totalRows: rows.length,
    };
  }

  validateBuffer<T>(
    buffer: ArrayBuffer | Uint8Array,
    definition: Pick<ImportDefinition<T>, "validateRow">,
  ): ImportValidationResult<T> {
    return this.validate(this.parseBuffer(buffer), definition);
  }

  /**
   * Validates and imports records atomically within a single database transaction.
   * Emits audit logs on start and completion/failure.
   */
  async executeImport<T>(
    buffer: ArrayBuffer | Uint8Array,
    definition: ImportDefinition<T>,
    ctx: OperationContext,
  ): Promise<ImportSummary> {
    const startTime = Date.now();
    const rows = this.parseBuffer(buffer);

    // 1. Emit Audit: IMPORT_STARTED
    await this.audit.emit({
      eventType: "IMPORT_STARTED",
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      organisationId: ctx.organisationId,
      correlationId: ctx.correlationId,
      metadata: {
        entityName: definition.entityName,
        totalRows: rows.length,
      },
    });

    // 2. Validate all rows
    const validation = this.validate(rows, definition);

    // If any row fails validation, abort transaction (no partial imports)
    if (validation.errors.length > 0) {
      await this.audit.emit({
        eventType: "IMPORT_FAILED",
        userId: ctx.userId,
        deviceId: ctx.deviceId,
        organisationId: ctx.organisationId,
        correlationId: ctx.correlationId,
        metadata: {
          entityName: definition.entityName,
          errorCount: validation.errors.length,
          errors: validation.errors.slice(0, 10), // Truncated sample for audit
        },
      });

      return {
        totalRowsProcessed: validation.totalRows,
        successfulRows: 0,
        failedRows: validation.errors.length,
        errors: validation.errors,
        durationMs: Date.now() - startTime,
      };
    }

    // 3. Execute atomic transactional commit
    return this.db.transaction(async (tx) => {
      const { importedCount } = await definition.commit(
        validation.validRows,
        this.db,
        ctx,
        tx,
      );

      // 4. Emit Audit: IMPORT_COMPLETED
      await this.audit.emit(
        {
          eventType: "IMPORT_COMPLETED",
          userId: ctx.userId,
          deviceId: ctx.deviceId,
          organisationId: ctx.organisationId,
          correlationId: ctx.correlationId,
          metadata: {
            entityName: definition.entityName,
            importedCount,
            durationMs: Date.now() - startTime,
          },
        },
        tx,
      );

      return {
        totalRowsProcessed: validation.totalRows,
        successfulRows: importedCount,
        failedRows: 0,
        errors: [],
        durationMs: Date.now() - startTime,
      };
    });
  }
}
