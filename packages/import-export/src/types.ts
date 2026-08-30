import type { OperationContext } from "@platform/core";
import type { DatabaseConnection, TransactionClient } from "@platform/database";

export type ColumnType = "string" | "number" | "boolean" | "date";

export interface ImportColumn {
  readonly key: string;
  readonly label: string;
  readonly type: ColumnType;
  readonly required?: boolean | undefined;
  readonly description?: string | undefined;
}

export interface RowValidationError {
  readonly rowIndex: number;
  readonly columnKey: string;
  readonly message: string;
  readonly invalidValue: unknown;
}

export interface ImportValidationResult<T> {
  readonly validRows: T[];
  readonly errors: RowValidationError[];
  readonly totalRows: number;
}

export interface ImportDefinition<TRecord> {
  readonly id: string;
  readonly entityName: string;
  readonly acceptedFormats: readonly ("csv" | "xlsx" | "xls")[];
  readonly columns: readonly ImportColumn[];
  validateRow: (
    rawRow: Record<string, unknown>,
    rowIndex: number,
  ) => {
    valid: boolean;
    data?: TRecord | undefined;
    errors?: RowValidationError[] | undefined;
  };
  commit: (
    records: TRecord[],
    db: DatabaseConnection,
    ctx: OperationContext,
    tx?: TransactionClient,
  ) => Promise<{ importedCount: number }>;
}

export interface ImportSummary {
  readonly totalRowsProcessed: number;
  readonly successfulRows: number;
  readonly failedRows: number;
  readonly errors: readonly RowValidationError[];
  readonly durationMs: number;
}

export interface ExportColumn<T> {
  readonly header: string;
  readonly accessor: (
    record: T,
  ) => string | number | boolean | null | undefined;
}

export interface ExportDefinition<T> {
  readonly sheetName?: string | undefined;
  readonly columns: readonly ExportColumn<T>[];
}
