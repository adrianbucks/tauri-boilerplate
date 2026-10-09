# Import, Export & Hardware Abstractions

## Current Implementation

**Status**: ✅ SheetJS-backed streaming import/export engines and high-speed keyboard-wedge hardware scanner abstraction implemented and verified.

Implemented across `packages/import-export` (`@platform/import-export`) and `packages/hardware` (`@platform/hardware`).

---

## 1. Import Pipeline Architecture

The platform separates file parsing, column validation, and transactional database commits into clean pipeline phases:

```
[ User Selects File ]
         │ (Tauri native file dialog via scoped capability)
         ▼
[ Bounded Stream Parsing ]
         │ SheetJS parser with size, row, and timeout limits
         ▼
[ Column Mapping & Schema Validation ]
         │ validateRow() checks types, constraints, and required fields
         ▼
[ Interactive Preview & Error Summary ]
         │ Reports invalid rows with exact row indices and reasons
         ▼
[ Transactional Domain Commit ]
         │ commit() executed in SQLite transaction
         ├── Audit log emission (IMPORT_STARTED, IMPORT_COMPLETED)
         └── Outbox replication queue entries (if entity is synchronisable)
```

---

## 2. Import Definition Contract

Features define their import schema using `ImportDefinition<TRecord>`:

```typescript
// packages/import-export/src/types.ts

export type ColumnType = "string" | "number" | "boolean" | "date";

export interface ImportColumn {
  readonly key: string;
  readonly label: string;
  readonly type: ColumnType;
  readonly required?: boolean;
  readonly description?: string;
}

export interface RowValidationError {
  readonly rowIndex: number;
  readonly columnKey: string;
  readonly message: string;
  readonly invalidValue: unknown;
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
    data?: TRecord;
    errors?: RowValidationError[];
  };
  commit: (
    records: TRecord[],
    db: DatabaseConnection,
    ctx: OperationContext,
    tx?: TransactionClient,
  ) => Promise<{ importedCount: number }>;
}
```

### Safety & Boundary Rules

1. **Feature Owns Commit**: The generic import engine never executes direct `INSERT` queries into feature tables. It delegates commits to the feature's `commit()` implementation.
2. **Transactional Atomicity**: All valid records in a batch are committed within a single database transaction. If an unhandled database error occurs, changes roll back completely.
3. **Resource Guardrails**:
   - Max file size: 50MB
   - Max rows: 50,000 per import
   - Parser timeout: 30 seconds

---

## 3. Export Pipeline & CSV Injection Defense

The export engine formats entity collections into downloadable workbooks (XLSX, CSV):

```typescript
export interface ExportColumn<T> {
  readonly header: string;
  readonly accessor: (record: T) => string | number | boolean | null | undefined;
}

export interface ExportDefinition<T> {
  readonly sheetName?: string;
  readonly columns: readonly ExportColumn<T>[];
}
```

### Spreadsheet Formula Injection Protection

Spreadsheet applications (Excel, LibreOffice) interpret values starting with `=`, `+`, `-`, or `@` as active executable formulas.

The export engine sanitizes all exported string values:

- Prepends a single quote (`'`) to any cell value that starts with `=, +, -, @, \t, \r`.
- Ensures downstream user environments are immune to CSV injection attacks.

---

## 4. Hardware Scanner Abstraction

The hardware subsystem (`@platform/hardware`) provides a unified barcode and RFID scanner interface:

```typescript
// packages/hardware/src/scanner/types.ts

export type BarcodeFormat =
  | "QR_CODE"
  | "DATA_MATRIX"
  | "CODE_128"
  | "CODE_39"
  | "EAN_13"
  | "EAN_8"
  | "UPC_A"
  | "UPC_E"
  | "UNKNOWN";

export interface BarcodeScanResult {
  readonly text: string;
  readonly format?: BarcodeFormat;
  readonly timestamp: string; // ISO-8601 UTC
  readonly deviceType: "keyboard-wedge" | "camera" | "hardware-plugin";
}

export interface BarcodeScanner {
  readonly isAvailable: boolean;
  startListening(listener: (result: BarcodeScanResult) => void): void;
  stopListening(): void;
}
```

### Keyboard Wedge Detection

Barcode scanners configured as USB/Bluetooth HID devices emulate rapid keyboard entry:

```typescript
export interface KeyboardWedgeOptions {
  /** Maximum elapsed time (ms) between keystrokes (default 50ms) */
  maxInterKeyDelayMs?: number;
  /** Suffix character/key denoting end of barcode scan (default 'Enter') */
  terminatorKey?: string;
  /** Minimum length of scanned barcode string (default 3) */
  minScanLength?: number;
}
```

- **Keystroke Timing Analysis**: If inter-key delays exceed `maxInterKeyDelayMs`, the buffer resets (user manual typing is ignored).
- **Terminator Detection**: Scans terminate cleanly on `Enter` or configured suffix.
- **Focus Neutrality**: Listens to global document keydown events without requiring a focused text input box.
