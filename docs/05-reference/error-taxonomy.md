# Error Taxonomy & Diagnostics Reference

This document catalogs the standard error codes, severity levels, and exception types across TypeScript packages and Rust native crates.

---

## 1. Core Error Class: `PlatformError` (`@platform/core`)

All custom errors in TypeScript inherit from `PlatformError`:

```typescript
export class PlatformError extends Error {
  readonly code: PlatformErrorCode;
  readonly severity: ErrorSeverity;
  readonly correlationId: string;
  readonly details?: Record<string, unknown>;

  constructor(options: {
    message: string;
    code: PlatformErrorCode;
    severity?: ErrorSeverity;
    correlationId?: string;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = "PlatformError";
    this.code = options.code;
    this.severity = options.severity ?? "error";
    this.correlationId = options.correlationId ?? generateCorrelationId();
    this.details = options.details;
    this.cause = options.cause;
  }
}
```

---

## 2. Standard Error Codes Catalogue

| Error Code             | Category           | Typical Cause                                            | HTTP / IPC Mapping  |
| :--------------------- | :----------------- | :------------------------------------------------------- | :------------------ |
| `VALIDATION_ERROR`     | Data Integrity     | Input field format violation or failed schema assertion  | 400 Bad Request     |
| `AUTHENTICATION_ERROR` | Identity           | Invalid password, expired session, locked account        | 401 Unauthorized    |
| `AUTHORIZATION_ERROR`  | Security           | Lacking required permission string or cross-tenant query | 403 Forbidden       |
| `CONFLICT_ERROR`       | Concurrency / Sync | Version mismatch, concurrent edits on same entity        | 409 Conflict        |
| `DATABASE_ERROR`       | Persistence        | SQLite constraint failure, busy timeout, locked file     | 500 Internal Error  |
| `MIGRATION_ERROR`      | Persistence        | Checksum mismatch or invalid migration SQL               | 500 Internal Error  |
| `SYNC_ERROR`           | Replication        | Peer connection timeout, QUIC stream error, NAK received | 502 Bad Gateway     |
| `COMPATIBILITY_ERROR`  | Protocol / Version | Incompatible schema version or unsupported feature       | 422 Unprocessable   |
| `FILE_ERROR`           | File / IO          | File size exceeds limit or malformed spreadsheet         | 400 Bad Request     |
| `HARDWARE_ERROR`       | Hardware / Device  | Scanner disconnect or unreadable barcode stream          | 503 Unavailable     |
| `NETWORK_ERROR`        | Transport          | No network interface available, DNS failure              | 504 Gateway Timeout |
| `INTERNAL_ERROR`       | System             | Unhandled runtime exception or invariant violation       | 500 Internal Error  |

---

## 3. Rust Error Mapping (`crates/native-core`)

The Rust native core defines `PlatformError` corresponding to the TypeScript representation:

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct PlatformError {
    pub code: String,
    pub message: String,
    pub details: Option<serde_json::Value>,
}

impl PlatformError {
    pub fn validation(msg: impl Into<String>) -> Self { ... }
    pub fn auth_failed(msg: impl Into<String>) -> Self { ... }
    pub fn permission_denied(msg: impl Into<String>) -> Self { ... }
    pub fn database(msg: impl Into<String>) -> Self { ... }
}
```

When native commands return `Err(PlatformError)`, Tauri automatically serializes the error structure into a rejected Promise in the TypeScript webview.
