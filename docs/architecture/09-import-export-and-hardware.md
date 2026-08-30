# 12 — Import, Export and Hardware

---

## Import/export package: `packages/import-export`

```
packages/import-export/
├── src/
│   ├── index.ts
│   ├── import/
│   │   ├── ImportEngine.ts         ← Orchestrates the import workflow
│   │   ├── ImportDefinition.ts     ← Interface that features implement
│   │   ├── FileDetector.ts         ← Detects format from file extension/content
│   │   ├── WorkbookParser.ts       ← SheetJS integration
│   │   └── ColumnMapper.ts         ← Header matching
│   ├── export/
│   │   ├── ExportEngine.ts
│   │   └── FileWriter.ts           ← Tauri filesystem bridge
│   └── types.ts
```

---

## Import definition contract

Each feature defines how its entities are imported:

```typescript
// packages/import-export/src/import/ImportDefinition.ts

interface ImportDefinition<T> {
  /** Unique ID for this import type — used in audit events */
  id: string;

  /** Display name shown to user */
  label: string;

  /** Accepted file MIME types / extensions */
  acceptedTypes: string[]; // e.g., ['.xlsx', '.csv', '.xls']

  /** Column definitions for the mapping step */
  columns: ImportColumn[];

  /** Validates a single mapped row — called before commit */
  validateRow(row: unknown): ValidationResult;

  /** Transforms a validated row into the entity type */
  transformRow(row: unknown): T;

  /** Commits all transformed rows — called inside a database transaction */
  commit(rows: T[], ctx: OperationContext): Promise<ImportResult>;
}

interface ImportColumn {
  key: string;
  label: string;
  required: boolean;
  type: "string" | "number" | "date" | "boolean";
  exampleValue?: string;
}

interface ImportResult {
  successCount: number;
  errorCount: number;
  errors: ImportRowError[];
  correlationId: string;
}
```

**Rule**: The import engine does not directly manipulate feature tables. It calls `commit()`, which is owned by the feature. The feature's `commit()` method uses its own repository inside a transaction.

---

## Import workflow

```
User selects file (Tauri native dialog)
        ↓
Platform opens file via Tauri filesystem plugin
        ↓
FileDetector identifies format (XLSX, CSV, XLS, ...)
        ↓
WorkbookParser reads workbook + extracts sheets/headers
        ↓
ColumnMapper presents mapping UI (header → column)
        ↓
User confirms mapping
        ↓
ImportEngine calls validateRow() on each row
        ↓
Validation errors shown (with row numbers)
        ↓
User reviews errors → fix file OR proceed with valid rows
        ↓
User confirms
        ↓
Transaction begins:
  - ImportEngine calls commit() with all valid rows
  - commit() writes entities via feature repository
  - Audit event emitted: IMPORT_STARTED, IMPORT_COMPLETED / IMPORT_FAILED
  - Replication metadata created for each row (sync enqueued)
Transaction commits
        ↓
Success summary shown (X rows imported, Y errors skipped)
```

**Atomicity rule**: A failed import must not partially modify the database unless the feature explicitly supports chunked/partial imports with documented chunk boundaries.

---

## Spreadsheet engine: SheetJS CE

Candidate: https://github.com/SheetJS/sheetjs

**RESEARCH REQUIRED** — see R-011 in doc 17.

### Benchmark requirements

Before committing to SheetJS, test on real target hardware:

| File size | Rows    | Measure                                |
| --------- | ------- | -------------------------------------- |
| Small     | 1,000   | Parse time, memory                     |
| Medium    | 10,000  | Parse time, memory, UI responsiveness  |
| Large     | 50,000  | Parse time, memory, UI freeze duration |
| X-Large   | 100,000 | Parse time, memory, crash risk         |
| Extreme   | 250,000 | Android: does it crash?                |

Measure on both Windows and Android (physical devices, not emulators).

If SheetJS CE cannot handle the required file sizes without blocking the UI or exhausting Android memory, evaluate:

- Reading and parsing the file in Rust (streaming approach)
- Web Worker + SharedArrayBuffer for off-thread parsing
- Chunked streaming import (accept partial rows, commit in batches)

### Supported export formats

```typescript
exportCsv(data: unknown[], filename: string): Promise<void>
exportXlsx(data: unknown[], options: XlsxExportOptions, filename: string): Promise<void>
saveFile(content: Blob, filename: string): Promise<void>
openFile(filters: FileFilter[]): Promise<FileHandle>
revealFile(path: string): Promise<void>
```

PDF export is not planned. Only implement if a real, specific requirement exists.

---

## react-spreadsheet-import

Candidate UI for the column mapping step: https://github.com/UgnisSoftware/react-spreadsheet-import

**RESEARCH REQUIRED** — see R-011 in doc 17.

Confirm before adopting:

- Does it require Chakra UI or other conflicting runtime dependencies?
- Does it work with shadcn/ui in the same application?
- Is it maintained and compatible with current React version?

If it introduces unacceptable dependencies, the column mapping UI is built from scratch using `packages/ui` primitives — this is not a large component to build.

---

## File access: Tauri plugins

File access always goes through Tauri's native dialog and filesystem plugins. The webview never has arbitrary filesystem access.

```
React component
    ↓
useFilePicker() hook (packages/import-export)
    ↓
Tauri command (opens native dialog)
    ↓
User selects file (native OS picker)
    ↓
Tauri returns file handle (scoped access only)
    ↓
File content passed to import engine
```

Capability grants in `tauri.conf.json` must be:

- Scoped to specific directories where possible
- Granted only for `read` when importing
- Granted only for `write` when exporting, to the user-selected location
- Never granted as `allow-all`

---

## Hardware package: `packages/hardware`

```
packages/hardware/
├── src/
│   ├── index.ts
│   ├── barcode/
│   │   ├── BarcodeScanner.ts         ← Interface
│   │   ├── KeyboardWedgeScanner.ts   ← Windows implementation
│   │   └── TauriPluginScanner.ts     ← Android implementation
│   └── camera/
│       └── Camera.ts                 ← Interface (placeholder for future)
```

### Barcode scanner interface

```typescript
interface BarcodeScanner {
  /** Returns the next scanned barcode value */
  scan(): Promise<BarcodeResult>;

  /** Returns an observable stream of scans */
  scans(): Observable<BarcodeResult>;

  /** Is a hardware scanner available? */
  isAvailable(): boolean;
}

interface BarcodeResult {
  value: string;
  format: BarcodeFormat;
  scannedAt: string; // UTC ISO-8601
}
```

Platform-specific implementation stays behind this interface. Feature code always imports `BarcodeScanner` — never the platform-specific class.

---

## Windows barcode scanning (keyboard-wedge)

Most warehouse Windows environments use USB or Bluetooth barcode scanners that behave as keyboard devices (keyboard-wedge mode).

The platform provides a `BarcodeInput` component:

```typescript
// packages/ui/src/components/BarcodeInput/BarcodeInput.tsx

interface BarcodeInputProps {
  onScan: (value: string) => void;
  onError?: (error: BarcodeError) => void;
  /** Characters that terminate a scan (default: Enter) */
  terminators?: string[];
  /** Debounce ms — distinguish typed input from scanner bursts */
  debounceMs?: number;
  /** Minimum scan duration ms — fast input = scanner, slow = keyboard */
  minScanDurationMs?: number;
  /** Allow manual keyboard fallback when no scanner present */
  allowManualInput?: boolean;
  /** Auto-focus this input on mount */
  autoFocus?: boolean;
  validationPattern?: RegExp;
  placeholder?: string;
}
```

The `KeyboardWedgeScanner` implementation:

- Listens for keyboard events in a focused context
- Detects scanner bursts (high-speed character input) vs manual typing (slow input)
- Validates the scanned string before emitting `BarcodeResult`
- Supports configurable terminator characters (Enter, Tab, custom)

---

## Android barcode scanning

Evaluate the official Tauri barcode-scanner plugin: https://github.com/tauri-apps/plugins-workspace

**RESEARCH REQUIRED** — see doc 17. Must be tested on a physical Android device (API 35+). Emulator testing is not sufficient.

Questions to answer during the hardware spike:

- Does the plugin expose the camera preview inside the Tauri webview?
- Can it decode multiple barcode formats (Code128, EAN-13, QR, DataMatrix)?
- What are the permission requirements in the Android manifest?
- Does it work reliably on the target Android hardware models?

The `TauriPluginScanner` implementation wraps the plugin behind the `BarcodeScanner` interface. If the plugin does not meet requirements, evaluate MLKit Barcode Scanning via a custom Tauri plugin.

---

## Android lifecycle considerations

The sync engine, hardware interfaces, and background operations must tolerate Android lifecycle transitions:

| State      | Expected behaviour                                  |
| ---------- | --------------------------------------------------- |
| Foreground | Full operation                                      |
| Background | Sync pauses gracefully; no new connections          |
| Suspended  | All async operations cleaned up; no crashes         |
| Terminated | Clean shutdown; SQLite connection closed properly   |
| Restarted  | Full reinitialisation; SQLite migrations re-checked |

**RESEARCH REQUIRED** — see R-006 in doc 17: what background networking does Android reliably permit for Tauri applications on API 35+? Do not promise continuous background P2P sync until this is confirmed on physical hardware.
