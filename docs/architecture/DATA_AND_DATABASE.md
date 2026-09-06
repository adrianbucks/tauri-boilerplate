# Data and Database Architecture

## Current

`@platform/database` exposes `DatabaseConnection`, a `MemoryDatabaseConnection`, `MigrationEngine`, `BaseRepository` and Drizzle schema definitions. The demo currently uses `sql.js` in memory, while `@platform/platform` owns and applies the core schema migration bundle before feature migrations.

The schema models organisations, users, devices, memberships, roles, permissions, sync groups, membership requests/decisions, revocations, audit events, peers, sessions, cursors, conflicts and migrations.

## Target storage model

Production uses a native durable SQLite database owned by the platform runtime. JavaScript should consume typed platform operations rather than arbitrary SQL IPC.

The native runtime now has an owner/version/checksum-verified migration runner
and applies the shared platform core SQL artifact plus the demo's
`feature.example-feature` widget migration during Tauri startup. Each feature
must supply its own shared migration artifact when added to a native consumer;
the native application data gateway still needs to be connected before the
native database becomes the complete production application store.

Core migration version 2 adds durable authentication metadata and lockout
columns to `core_users`. These columns are schema preparation only; credential
verification and session issuance remain native authentication work.

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
