# ADR-003: Native Durable SQLite Persistence Strategy

**Status**: Accepted (Implemented & Verified)  
**Date**: 2026-08-30 (Updated 2026-09-28)  
**Authors**: Antigravity Pair Programming

---

## Context

The platform is local-first: every device operates against a local SQLite database file. Business transactions must commit atomically alongside audit events and replication queue metadata before notifying the P2P network. We evaluated how SQLite connections and queries should be managed between TypeScript and Rust in Tauri 2.

Initial prototypes utilized an in-memory `sql.js` (WASM) database. While acceptable for rapid test iterations, in-memory databases lose all state on application close, violate crash-durability requirements, and cannot enforce foreign keys reliably across application lifecycle restarts.

---

## Options Considered

### Option A: Direct Webview SQL Plugin (`tauri-plugin-sql`)

- The webview connects directly to SQLite via IPC strings (`SELECT ...`).
- **Downsides**:
  - Weak security boundary: exposing arbitrary raw SQL execution to the webview expands the attack surface.
  - Fragile transaction boundaries: coordinating multi-step transactions across asynchronous IPC turns risks locking issues and partial commits.
  - Native layer cannot participate in the transaction: the native background sync worker cannot atomically read or enqueue replication items within the same transaction.

### Option B: Native Rust SQLite via `rusqlite` + Typed Data Gateway (Chosen)

- The SQLite connection is owned and managed natively in Rust (`crates/native-core` and `apps/demo/src-tauri`).
- Configured with WAL (Write-Ahead Logging) mode, `PRAGMA foreign_keys = ON`, and optimized busy timeouts.
- TypeScript features use typed repositories implementing the `BaseRepository` interface from `@platform/database`.
- Arbitrary SQL execution is strictly guarded by `validate_safe_sql`, preventing unauthorized PRAGMA and attachment queries.

---

## Decision

We adopt **Option B**:

1. Adopt native file-backed SQLite as the production persistence store, located at `{app_data_dir}/platform.sqlite3` and managed via Rust's `rusqlite` crate in `crates/native-core`.
2. Explicitly enforce durability and constraint invariants on every connection:
   - `PRAGMA foreign_keys = ON;`
   - `PRAGMA journal_mode = WAL;`
   - `PRAGMA busy_timeout = 5000;`
3. Expose persistence to TypeScript via typed Tauri IPC commands (`db_query`, `db_execute`, `db_transaction`) implemented by `NativeDatabaseConnection`.
4. Retain `MemoryDatabaseConnection` (`sql.js`) strictly as isolated test harness infrastructure for fast in-memory TypeScript unit tests.

---

## Consequences

- Full transactional integrity across business data, audit records, and sync metadata.
- Guaranteed crash durability across application and system restarts.
- High-concurrency reads with non-blocking WAL mode.
- Verified by 5 regression tests in `crates/native-core/src/database.rs`.
