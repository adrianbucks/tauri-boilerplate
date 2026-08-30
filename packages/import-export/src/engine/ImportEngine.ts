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
    const workbook = XLSX.read(buffer, { type: "array" });
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

    return XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: null,
      raw: false,
    });
  }

  /**
   * Validates parsed spreadsheet rows against an ImportDefinition without committing.
   */
  validate<T>(
    rows: Record<string, unknown>[],
    definition: ImportDefinition<T>,
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
