import * as XLSX from "xlsx";
import {
  DatabaseError,
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

const XLSX_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] as const;
const XLS_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;

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

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, {
        type: "array",
        sheetRows: MAX_IMPORT_ROWS + 2,
      });
    } catch (error) {
      throw new ValidationError({
        message: `Spreadsheet parsing failed: ${error instanceof Error ? error.message : String(error)}`,
        userMessage: "The uploaded file could not be read as a spreadsheet",
        correlationId: "imp_parse_failed",
        cause: error,
      });
    }
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
    if (!worksheet) {
      throw new ValidationError({
        message: `Spreadsheet worksheet '${firstSheetName}' is missing`,
        userMessage: "The uploaded spreadsheet is incomplete",
        correlationId: "imp_missing_worksheet",
      });
    }

    const worksheetRange = worksheet["!ref"];
    let worksheetBounds: XLSX.Range | undefined;
    if (worksheetRange) {
      let estimatedCells: number;
      try {
        worksheetBounds = XLSX.utils.decode_range(worksheetRange);
        const rowCount = worksheetBounds.e.r - worksheetBounds.s.r + 1;
        const columnCount = worksheetBounds.e.c - worksheetBounds.s.c + 1;
        if (
          rowCount < 0 ||
          columnCount < 0 ||
          !Number.isSafeInteger(rowCount) ||
          !Number.isSafeInteger(columnCount)
        ) {
          throw new Error("Invalid worksheet range");
        }
        if (rowCount > MAX_IMPORT_ROWS + 1) {
          throw new ValidationError({
            message: "Worksheet exceeds the maximum row count",
            userMessage: "The uploaded worksheet has too many rows",
            correlationId: "imp_row_limit",
          });
        }
        estimatedCells = rowCount * columnCount;
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        throw new ValidationError({
          message: `Spreadsheet worksheet range is invalid: ${error instanceof Error ? error.message : String(error)}`,
          userMessage: "The uploaded spreadsheet dimensions are invalid",
          correlationId: "imp_invalid_worksheet_range",
          cause: error,
        });
      }
      if (estimatedCells > MAX_IMPORT_CELLS) {
        throw new ValidationError({
          message: "Worksheet range exceeds the maximum cell count",
          userMessage: "The uploaded worksheet has too many cells",
          correlationId: "imp_cell_limit",
        });
      }
    }

    if (worksheetBounds) {
      const headers = new Set<string>();
      for (let column = worksheetBounds.s.c; column <= worksheetBounds.e.c; column += 1) {
        const cellAddress = XLSX.utils.encode_cell({ r: worksheetBounds.s.r, c: column });
        const cell = worksheet[cellAddress];
        const header = String(cell?.w ?? cell?.v ?? "").trim();
        const normalizedHeader = header.toLocaleLowerCase();
        if (!normalizedHeader) {
          throw new ValidationError({
            message: `Worksheet contains an empty header at column ${column + 1}`,
            userMessage: "Every imported column must have a heading",
            correlationId: "imp_empty_header",
          });
        }
        if (headers.has(normalizedHeader)) {
          throw new ValidationError({
            message: `Worksheet contains duplicate header '${header}'`,
            userMessage: "The uploaded worksheet contains duplicate column headings",
            correlationId: "imp_duplicate_header",
          });
        }
        headers.add(normalizedHeader);
      }
    }

    let rows: Record<string, unknown>[];
    try {
      rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        defval: null,
        raw: false,
      });
    } catch (error) {
      throw new ValidationError({
        message: `Spreadsheet row conversion failed: ${error instanceof Error ? error.message : String(error)}`,
        userMessage: "The uploaded spreadsheet rows could not be read",
        correlationId: "imp_row_conversion_failed",
        cause: error,
      });
    }
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
        if (typeof value === "string" && value.length > MAX_IMPORT_CELL_STRING_LENGTH) {
          throw new ValidationError({
            message: "Worksheet contains an oversized cell",
            userMessage: "The uploaded worksheet contains a value that is too large",
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

  private assertAcceptedFormat(
    buffer: ArrayBuffer | Uint8Array,
    acceptedFormats: ImportDefinition<unknown>["acceptedFormats"],
  ): void {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const startsWith = (signature: readonly number[]) =>
      signature.every((byte, index) => bytes[index] === byte);

    let detected: "csv" | "xlsx" | "xls";
    if (startsWith(XLSX_SIGNATURE)) {
      detected = "xlsx";
    } else if (startsWith(XLS_SIGNATURE)) {
      detected = "xls";
    } else {
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (text.includes("\0")) throw new Error("binary content");
        detected = "csv";
      } catch {
        throw new ValidationError({
          message: "Import file format could not be identified",
          userMessage: "The uploaded file format is not supported",
          correlationId: "imp_unknown_format",
        });
      }
    }

    if (!acceptedFormats.includes(detected)) {
      throw new ValidationError({
        message: "Import format is not accepted: " + detected,
        userMessage: "The uploaded file format is not accepted for this import",
        correlationId: "imp_format_not_accepted",
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
      try {
        const result = definition.validateRow(rawRow, rowIndex);
        if (result.errors !== undefined && !Array.isArray(result.errors)) {
          throw new TypeError("Row validation errors must be an array");
        }
        if (result.errors && result.errors.length > 0) {
          for (const validationError of result.errors) {
            if (
              validationError === null ||
              typeof validationError !== "object" ||
              typeof validationError.columnKey !== "string" ||
              typeof validationError.message !== "string"
            ) {
              throw new TypeError("Row validation returned a malformed error entry");
            }
            errors.push({
              rowIndex,
              columnKey: validationError.columnKey,
              message: validationError.message,
              invalidValue: validationError.invalidValue,
            });
          }
        } else if (result.valid && result.data !== undefined) {
          validRows.push(result.data);
        } else {
          errors.push({
            rowIndex,
            columnKey: "",
            message: result.valid
              ? "Row validation succeeded without producing data"
              : "Row validation failed without providing an error",
            invalidValue: undefined,
          });
        }
      } catch (error) {
        errors.push({
          rowIndex,
          columnKey: "",
          message: `Row validation threw: ${error instanceof Error ? error.message : String(error)}`,
          invalidValue: undefined,
        });
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
    definition: Pick<ImportDefinition<T>, "validateRow" | "acceptedFormats">,
  ): ImportValidationResult<T> {
    this.assertAcceptedFormat(buffer, definition.acceptedFormats);
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
    this.assertAcceptedFormat(buffer, definition.acceptedFormats);
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
      const failedRows = new Set(validation.errors.map((error) => error.rowIndex)).size;
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
        failedRows,
        errors: validation.errors,
        durationMs: Date.now() - startTime,
      };
    }

    // 3. Execute atomic transactional commit
    try {
      return await this.db.transaction(async (tx) => {
        const { importedCount } = await definition.commit(validation.validRows, ctx, tx);
        if (
          !Number.isSafeInteger(importedCount) ||
          importedCount < 0 ||
          importedCount > validation.validRows.length
        ) {
          throw new ValidationError({
            message: `Import commit returned invalid importedCount ${importedCount} for ${validation.validRows.length} valid row(s)`,
            userMessage: "The import could not be completed consistently.",
            correlationId: "imp_invalid_commit_count",
          });
        }

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
    } catch (error) {
      try {
        await this.audit.emit({
          eventType: "IMPORT_FAILED",
          userId: ctx.userId,
          deviceId: ctx.deviceId,
          organisationId: ctx.organisationId,
          correlationId: ctx.correlationId,
          metadata: {
            entityName: definition.entityName,
            totalRows: validation.totalRows,
            phase: "commit",
            errorName: error instanceof Error ? error.name : "UnknownError",
          },
        });
      } catch (auditError) {
        throw new DatabaseError({
          message: "Import transaction failed and its failure audit could not be recorded",
          userMessage: "The import failed and the failure could not be recorded",
          correlationId: ctx.correlationId,
          cause: new AggregateError([error, auditError]),
        });
      }
      throw error;
    }
  }
}
