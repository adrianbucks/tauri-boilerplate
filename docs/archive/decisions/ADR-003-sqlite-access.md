# ADR-003: SQLite Access Strategy

**Status**: Accepted  
**Date**: 2026-08-30  
**Authors**: Antigravity Pair Programming

---

## Context

The platform is local-first: every device operates against a local SQLite database file. Business transactions must commit atomically alongside audit events and replication queue metadata before notifying the P2P network. We need to determine how SQLite connections and queries are managed between TypeScript and Rust in Tauri 2.

## Options Considered

### Option A: Direct Webview SQL Plugin (`tauri-plugin-sql`)

- The webview connects directly to SQLite via IPC strings (`SELECT ...`).
- _Downsides_:
  - Weak security boundary: exposing arbitrary raw SQL execution to the webview expands the attack surface.
  - Fragile transaction boundaries: coordinating multi-step transactions across asynchronous IPC turns risks locking issues and partial commits.
  - Native layer cannot participate in the transaction: the native background sync worker cannot atomically read or enqueue replication items within the same transaction.

### Option B: Native Rust SQLite via `rusqlite` / `sqlx` + Typed Repository Bridge (Chosen)

- The SQLite connection is owned entirely by Rust (`apps/demo/src-tauri` and `crates/native-core`).
- Configured with WAL (Write-Ahead Logging) mode, `PRAGMA foreign_keys = ON`, and optimized busy timeouts.
- TypeScript repositories call typed Tauri IPC commands or a batch query runner.
- Transactions are managed natively: a business operation (e.g. `create_record`) atomically executes table mutations, audit event recording, and sync queue enqueueing in a single native SQLite transaction.

## Decision

We adopt **Option B**:

1. SQLite connection pool and lifecycle are managed natively in Rust.
2. WAL mode is enabled by default for high-concurrency local reads and writes.
3. TypeScript features use typed repositories implementing the `BaseRepository` interface from `@platform/database`.

## Consequences

- Full transactional integrity across business data, audit records, and sync metadata.
- Secure by default: no arbitrary SQL injection gateway exposed to untrusted webview contexts.
- Clean foundation for background native sync workers.

## Implementation status

This ADR records the accepted target architecture. The current repository
does not yet satisfy it: the TypeScript test adapter is `sql.js`, the demo
still initializes `MemoryDatabaseConnection`, and the native SQLite bridge
is not implemented. See [S-01](../specifications/S-01-database-and-persistence.md)
and the [status matrix](../verification/status.md).
