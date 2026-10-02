# ADR-003: Native Durable SQLite Persistence Strategy

## Status

Accepted

## Context

Initial prototypes utilized an in-memory `sql.js` (WASM) database. While acceptable for rapid test iterations, in-memory databases lose all state on application close, violate crash-durability requirements, and cannot enforce foreign keys reliably across application lifecycle restarts.

## Decision

1. Adopt native file-backed SQLite as the production persistence store, located at `{app_data_dir}/platform.sqlite3` and managed via Rust's `rusqlite` crate in `crates/native-core`.
2. Explicitly enforce durability and constraint invariants on every connection:
   - `PRAGMA foreign_keys = ON;`
   - `PRAGMA journal_mode = WAL;`
   - `PRAGMA busy_timeout = 5000;`
3. Expose persistence to TypeScript via typed Tauri IPC commands (`db_query`, `db_execute`, `db_transaction`) implemented by `NativeDatabaseConnection`.
4. Retain `MemoryDatabaseConnection` (`sql.js`) strictly as isolated test harness infrastructure for fast in-memory TypeScript unit tests.

## Consequences

- Guaranteed crash durability across application and system restarts.
- Strict foreign-key constraint enforcement preventing orphaned records.
- High-concurrency reads with non-blocking WAL mode.
- Verified by 5 regression tests in `crates/native-core/src/database.rs`.
