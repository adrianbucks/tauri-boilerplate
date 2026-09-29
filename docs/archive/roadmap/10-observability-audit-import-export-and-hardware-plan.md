# Observability, Audit, Import/Export and Hardware Plan

## 1. Logging

Provide structured logs with:

- timestamp;
- level;
- correlation ID;
- component;
- operation;
- outcome;
- safe identifiers.

Never log:

- private keys;
- authentication secrets;
- full sensitive payloads;
- credentials.

Support configurable log levels.

## 2. Diagnostics

Diagnostics should cover:

```text
database health
identity state
session state
feature registry
sync peers
connection mode
pending operations
failed operations
conflicts
migration state
```

Diagnostics exports must redact secrets and sensitive data.

## 3. Audit

Audit events should be append-only and attributable to:

- user;
- device;
- organisation;
- operation;
- correlation ID;
- timestamp.

Audit storage must not become a second business database.

## 4. Import/export

The platform should provide generic infrastructure for:

- file selection;
- spreadsheet parsing;
- CSV;
- XLSX;
- validation;
- preview;
- error reporting;
- export.

The domain application defines:

- columns;
- mapping;
- validation rules;
- destination entities.

Import must execute through the same service/authorization pipeline as
normal business operations.

## 5. Hardware

Barcode scanning should expose a platform-neutral interface:

```ts
interface BarcodeScanner {
  start(): Promise<void>;
  stop(): Promise<void>;
  onScan(handler): Unsubscribe;
}
```

Implementations may include:

- keyboard wedge;
- Android native scanner;
- future Bluetooth/USB devices.

The consuming application decides what a scanned barcode means.

## 6. Hardware security

Scanner input must not bypass application validation or authorization.

A scan should enter the normal application workflow:

```text
scan
 ↓
parse
 ↓
domain lookup
 ↓
authorization
 ↓
business operation
```
