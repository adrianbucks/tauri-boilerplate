# Data and Database Architecture

## Current Implementation

The data architecture is implemented across `crates/native-core`, `packages/database`, and `packages/platform`:

- **Primary Production Store (`NativeDatabaseConnection`)**:
  - The runtime uses a native, file-backed SQLite database at `{app_data_dir}/platform.sqlite3` managed by `rusqlite` in `crates/native-core/src/database.rs`.
  - TypeScript communicates via typed Tauri commands (`db_query`, `db_execute`, `db_transaction`) implemented by `NativeDatabaseConnection`.
  - Durability and constraint invariants are verified by 5 regression tests in Rust: restart persistence across close/reopen, foreign key constraint enforcement, active WAL journal mode, and atomic transaction rollback on failure.
  - `MemoryDatabaseConnection` (backed by `sql.js`) is retained strictly as test infrastructure for fast, isolated TypeScript unit testing.

- **Migration Authority**:
  - `@platform/platform` owns the core platform schema migrations (`core-schema.sql`, `core-authentication.sql`, `core-replication.sql`).
  - Native startup applies core migrations in strict version order with checksum validation before any feature migrations run.
  - Feature migrations (e.g. `feature.example-feature`) are declared and owned strictly by features, never by platform core or demo startup.

- **Durable Replication & Task Queues**:
  - `core-replication.sql` establishes durable tables for `core_sync_outbox`, `core_sync_inbox`, and `core_sync_tombstones`.
  - Task state persistence is managed by `core_tasks` in `@platform/tasks`.

## Target storage model & Future Work

While the core persistence foundation is production-ready, the following enhancements remain on the roadmap:

1. **Encrypted Storage Layer (ADR-026)**: Deferred until key hierarchy, platform keystores (Windows DPAPI / Android Keystore), and migration semantics are proven.
2. **Automated Backup & Disaster Recovery**: Runtime routine to take atomic SQLite vacuum/backup snapshots without locking application operations.

SQLite configuration must be explicit:

- foreign keys enabled and verified;
- journal/WAL mode deliberately selected and verified;
- busy/locking policy defined;
- integrity checks available;
- backup/recovery procedure defined;
- migration engine authoritative;
- sensitive-data handling defined before encryption is introduced.

SQLite documents that foreign-key enforcement is disabled unless enabled and that WAL has its own persistence/checkpoint semantics. Treat these as runtime properties to configure and test, not documentation assumptions.

## Transaction rule

A business mutation should use one transaction when the following must be atomic:

```text
business state
+ audit event
+ replication/outbox metadata
```

The network must not be part of the local commit transaction.

## Repository rule

Repositories encapsulate persistence access. They must:

- use parameterised values;
- allowlist dynamic SQL identifiers such as `orderBy`;
- apply mandatory tenant scope where the repository owns tenant data;
- expose domain-appropriate methods instead of leaking arbitrary SQL to callers;
- accept a transaction client when participating in a larger atomic operation.

## Schema ownership

### Platform-owned core tables

Examples:

- `core_applications`
- `core_organisations`
- `core_users`
- `core_devices`
- `core_roles`
- `core_permissions`
- `core_role_permissions`
- `core_user_roles`
- `core_sync_groups`
- `core_sync_group_members`
- `core_sync_group_policies`
- `core_membership_requests`
- `core_membership_decisions`
- `core_revocations`
- `core_audit_events`
- `core_sync_peers`
- `core_sync_sessions`
- `core_sync_cursors`
- `core_sync_conflicts`
- migration tables

### Feature-owned tables

Feature packages own their domain tables and migrations. A feature must not create platform tables from application startup code.

## Migration policy

- migrations are immutable once applied;
- each migration has owner/version/name/checksum;
- checksum mismatch is a hard failure;
- upgrade tests cover old database → current database;
- fresh-install tests cover empty database → current database;
- failed migrations must leave the database in a recoverable state;
- feature migration ownership must be explicit.

## Synchronisable entity metadata

The existing `syncableEntityColumns` establishes the intended minimum metadata:

- entity identity;
- organisation;
- sync group;
- schema version;
- sync version;
- tombstone fields;
- data classification.

Do not treat these columns alone as a replication implementation. Durable operations, idempotency, signatures and conflict policy remain separate concerns.
