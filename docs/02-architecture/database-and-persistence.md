# Database & Persistence

## Current Implementation

**Status**: ✅ Production-ready durable persistence foundation.

The data architecture is fully implemented across `crates/native-core`, `packages/database`, and `packages/platform`:

- **Primary store**: File-backed SQLite at `{app_data_dir}/platform.sqlite3` via `rusqlite`.
- **TypeScript bridge**: `NativeDatabaseConnection` communicates via typed Tauri commands (`db_query`, `db_execute`, `db_transaction`).
- **WAL mode**: Enabled via `PRAGMA journal_mode = WAL` — verified by Rust tests.
- **Foreign keys**: Enabled via `PRAGMA foreign_keys = ON` — verified by Rust tests.
- **Migration authority**: `@platform/platform` owns core migrations; features own their own.
- **Test adapter**: `MemoryDatabaseConnection` (backed by `sql.js`) retained for fast, isolated TypeScript unit tests only.

### Verified test evidence

```
cargo test -p native-core -- \
  restart_persistence_survives_close_and_reopen \
  foreign_key_enforcement_prevents_orphaned_records \
  wal_mode_is_enabled \
  integrity_check_passes \
  transaction_rollback_undoes_all_operations
test result: ok. 5 passed; 0 failed
```

---

## Architecture principles

- One SQLite database per application instance per device.
- No feature or UI component opens its own database connection.
- All data access: `UI → service → repository → @platform/database → Tauri IPC → rusqlite → SQLite`.
- Migrations are applied at application startup in version order.
- A failed migration must not corrupt the database — rollback or halt.

---

## Connection abstraction

```typescript
// packages/database/src/connection/DatabaseConnection.ts
export interface TransactionClient {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected?: number }>;
  savepoint<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T>;
}

export interface DatabaseConnection {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
  transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T>;
  healthCheck(): Promise<DatabaseHealth>;
  close(): Promise<void>;
}
```

Transaction clients are valid only while their callback is running. Native transaction callbacks collect writes and dispatch them atomically after the callback; intermediate reads are unsupported on that driver. Intentional nested work must use `tx.savepoint(...)`, which rolls back only the nested scope on failure. Independent top-level transactions on the memory adapter are serialized so they cannot be mistaken for nested scopes. A queued native write does not expose a meaningful affected-row count before native execution, so its `rowsAffected` result is optional.

### Production path (NativeDatabaseConnection)

```
React → typed service → typed repository
    → NativeDatabaseConnection
    → Tauri IPC (db_query / db_execute / db_transaction)
    → crates/native-core/src/database.rs
    → rusqlite → platform.sqlite3
```

### Test/development path (MemoryDatabaseConnection)

```
TypeScript unit tests
    → MemoryDatabaseConnection
    → sql.js (in-memory SQLite)
```

`sql.js` is never used in production. It is purely a test infrastructure adapter.

---

## Migration authority

### Platform migrations (`@platform/platform`)

Applied at native startup before any feature migrations:

| Migration                 | Contents                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `core-schema.sql`         | `core_organisations`, `core_users`, `core_devices`, `core_roles`, `core_permissions`, `core_role_permissions`, `core_user_roles` |
| `core-authentication.sql` | Authentication tables, credential verifiers, session state                                                                       |
| `core-replication.sql`    | `core_sync_outbox`, `core_sync_inbox`, `core_sync_tombstones`, `core_sync_groups`, `core_sync_group_members`                     |

### Feature migrations (`features/<name>/src/migrations/`)

Feature migrations run after platform migrations, in dependency order. Features must never create platform tables.

```
features/example-feature/src/migrations/
├── 0001_initial_widgets.sql
└── 0002_add_widget_category.sql
```

### Migration policy

- Migrations are immutable once applied.
- Each migration has `(owner, version, name, checksum)`.
- Checksum mismatch is a hard failure — no silent skip.
- Upgrade tests: old database → current schema.
- Fresh-install tests: empty database → current schema.
- Failed migrations leave the database in a recoverable state.

---

## Schema conventions

Every platform table follows:

```sql
-- Standard metadata columns
id          TEXT PRIMARY KEY    -- UUID/ULID
created_at  TEXT NOT NULL       -- UTC ISO-8601
updated_at  TEXT NOT NULL       -- UTC ISO-8601

-- Attributable tables additionally include:
created_by  TEXT REFERENCES core_users(id)
updated_by  TEXT REFERENCES core_users(id)
```

**Synchronisable entities** additionally require tombstone columns:

```sql
deleted_at          TEXT                   -- NULL if not deleted
deleted_by          TEXT REFERENCES core_users(id)
delete_operation_id TEXT                   -- Stable operation ID for idempotent replication
```

---

## Core platform tables

| Table                     | Purpose                                                |
| ------------------------- | ------------------------------------------------------ |
| `core_organisations`      | Organisation records                                   |
| `core_users`              | User accounts scoped to an organisation                |
| `core_devices`            | Physical device registrations with Ed25519 public keys |
| `core_roles`              | Named permission bundles, organisation-scoped          |
| `core_permissions`        | Hierarchical permission strings (`widgets.read`)       |
| `core_role_permissions`   | Role → permission assignments with scope constraints   |
| `core_user_roles`         | User → role assignments                                |
| `core_sync_groups`        | Replication peer groups                                |
| `core_sync_group_members` | Device membership in sync groups                       |
| `core_sync_outbox`        | Durable signed outbound operation queue                |
| `core_sync_inbox`         | Idempotent inbound operation queue                     |
| `core_sync_tombstones`    | Soft-delete records for replication-safe deletion      |
| `core_tasks`              | Durable background task state                          |
| `core_audit_events`       | Append-only security audit log                         |
| `core_migrations`         | Platform migration tracking with checksums             |
| `core_feature_migrations` | Per-feature migration tracking                         |

---

## Repository pattern

### Implementing a repository

```typescript
// features/example-feature/src/repositories/WidgetRepository.ts
import { BaseRepository } from "@platform/database";

export class WidgetRepository extends BaseRepository {
  async findByOrganisation(organisationId: string, options?: QueryOptions): Promise<Widget[]> {
    // Mandatory tenant scope — never query without organisationId
    return this.db.query("SELECT * FROM widgets WHERE organisation_id = ? AND deleted_at IS NULL", [
      organisationId,
    ]);
  }

  async create(data: CreateWidgetInput, tx?: Transaction): Promise<Widget> {
    // Use parameterised queries — never string concatenation
    const db = tx ?? this.db;
    await db.execute(
      "INSERT INTO widgets (id, name, organisation_id, created_at) VALUES (?, ?, ?, ?)",
      [data.id, data.name, data.organisationId, new Date().toISOString()],
    );
    return this.findById(data.id);
  }

  // ❌ NEVER raw DELETE for synchronisable records
  // ✅ ALWAYS use tombstone service
}
```

### Repository rules

- Use parameterised values — never string concatenation in SQL.
- Allowlist dynamic SQL identifiers such as `ORDER BY` column names.
- Apply mandatory tenant scope for tenant-owned data.
- Expose domain-appropriate methods instead of leaking arbitrary SQL.
- Accept a transaction client when participating in a larger atomic operation.

---

## Atomic business transactions

A single user operation commits business data, audit event, and replication metadata in one transaction:

```typescript
// features/example-feature/src/services/WidgetService.ts
async createWidget(
  input: CreateWidgetInput,
  ctx: TrustedOperationContext,
): Promise<Widget> {
  // 1. Validate input
  validateWidgetInput(input);

  // 2. Authorize
  await this.authorization.requireTrusted(ctx, "widgets.create", {
    organisationId: ctx.organisationId,
  });

  // 3. Atomic: business record + audit + outbox
  return this.db.transaction(async (tx) => {
    const widget = await this.widgetRepo.withTransaction(tx).create({
      ...input,
      organisationId: ctx.organisationId,
    });

    await this.audit.withTransaction(tx).record({
      eventType: "RECORD_CREATED",
      entityId: widget.id,
      userId: ctx.userId,
      correlationId: ctx.correlationId,
    });

    await this.outbox.withTransaction(tx).queueOperation(
      buildSyncEnvelope(widget, ctx),
    );

    return widget;
  });
  // Network sync happens asynchronously outside this transaction
}
```

---

## Tombstone pattern for synchronisable deletes

Never `DELETE` a row that may have been replicated to peers:

```typescript
// ✅ CORRECT — tombstone service
await tombstoneService.markDeleted({
  entityId: widget.id,
  namespace: "example/widgets",
  deletedBy: ctx.userId,
  deleteOperationId: generateOperationId(),
});

// ❌ FORBIDDEN
await db.execute("DELETE FROM widgets WHERE id = ?", [id]);
```

The `TombstoneService` records in `core_sync_tombstones` and propagates the soft-delete through the outbox to all peers, preventing resurrection of stale data by offline devices.

---

## SQLite configuration

The native `DurableDatabase` (`crates/native-core/src/database.rs`) configures SQLite on every connection open:

```rust
conn.execute_batch("
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
")?;
```

These are verified at startup by a `get_database_health` Tauri command.

---

## Durable replication queues

### Outbox (`core_sync_outbox`)

```sql
CREATE TABLE core_sync_outbox (
    id              TEXT PRIMARY KEY,
    created_at      TEXT NOT NULL,
    envelope_id     TEXT NOT NULL UNIQUE,
    envelope_json   TEXT, -- complete signed SyncEnvelope; nullable only for legacy rows
    organisation_id TEXT NOT NULL,
    sync_group_id   TEXT NOT NULL,
    feature_id      TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    operation       TEXT NOT NULL,
    payload_json    TEXT NOT NULL, -- operation payload, not the transport envelope
    author_id       TEXT NOT NULL,
    device_id       TEXT NOT NULL,
    logical_timestamp TEXT NOT NULL,
    schema_version  INTEGER NOT NULL,
    protocol_version INTEGER NOT NULL,
    signer_public_key TEXT NOT NULL,
    signature       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'PENDING',
    attempt_count   INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,
    sent_at         TEXT
);
```

Operations are atomically enqueued alongside business mutations. `OutboxSyncWorker` polls in batches and transmits the complete `envelope_json` via `IrohSyncTransport`. Migration 7 adds this column. Existing rows have no recoverable complete envelope and remain blocked until repaired; the worker fails visibly rather than transmitting only `payload_json`.

### Inbox (`core_sync_inbox`)

```sql
CREATE TABLE core_sync_inbox (
    id              TEXT PRIMARY KEY,
    envelope_id     TEXT NOT NULL UNIQUE,  -- idempotency key
    namespace       TEXT NOT NULL,
    payload         TEXT NOT NULL,
    received_at     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
    -- ON CONFLICT (envelope_id) DO NOTHING ensures idempotency
);
```

Incoming envelopes are signature-verified before insertion and applied in HLC logical timestamp order.

---

## Storage Compaction & Data Pruning (`@platform/maintenance`, WP-022 / Gate G-014)

Local-first, replicated desktop and mobile databases naturally accumulate operational rows across queues, task histories, audit logs, and soft-delete markers. To prevent unbounded SQLite file growth and maintain sub-millisecond query performance, the platform includes a standalone, extensible maintenance package: **`@platform/maintenance`**.

### The 5 Compaction Invariants

1. **No Premature Outbox Pruning (Invariants #3 & #4)**: Never delete `PENDING` or `FAILED` outbox envelopes. Only records with `status = 'SENT'` past the retention window may be removed.
2. **Safe Inbox Deduplication Window**: Never prune inbox deduplication markers before the clock skew and replay tolerance threshold (default: 30 days) to prevent replay vulnerabilities.
3. **Replicated Tombstone Compaction (Invariant #6)**: Never prune soft-delete tombstones where `replicated_at IS NULL`. Only tombstones confirmed across cluster peers past the GC cutoff may be pruned.
4. **Active Task Protection**: Never delete or interrupt `PENDING` or `RUNNING` background tasks.
5. **Durable Space Reclamation**: Execute SQLite `VACUUM` post-pruning to return reclaimed database pages to the host operating system filesystem.

### Subsystem Architecture

```text
packages/maintenance/
├── src/
│   ├── types.ts                      # PruningHandler SPI, DeclarativePruningPolicy, MaintenanceReport
│   ├── registry/
│   │   └── MaintenanceRegistry.ts    # Central registry for programmatic handlers & declarative rules
│   ├── orchestrator/
│   │   └── MaintenanceOrchestrator.ts# Inspection, batch deletion, cooperative AbortSignal & VACUUM
│   └── handlers/
│       ├── DeclarativeTablePruner.ts # Generic policy pruner for feature tables
│       ├── SyncOutboxPruner.ts       # Core replication outbox pruner
│       ├── SyncInboxPruner.ts        # Core replication inbox pruner
│       ├── BackgroundTasksPruner.ts  # Core background task pruner
│       ├── AuditEventsPruner.ts      # Core audit events pruner
│       └── ReplicatedTombstonePruner.ts # Cluster-acknowledged tombstone pruner
```

### Feature Extensibility (Invariant #10)

Downstream features define lifecycle pruning declaratively in their `FeatureManifest` without modifying core packages:

```typescript
export const domainManifest: FeatureManifest = {
  id: "sensor-telemetry",
  // ...
  pruningPolicies: [
    {
      id: "feature.sensor_readings",
      displayName: "Archived Sensor Readings",
      tableName: "sensor_readings",
      timestampColumn: "recorded_at",
      defaultRetentionDays: 30,
      filterCondition: "status = 'ARCHIVED'",
    },
  ],
};
```

When registered with `platform.registerFeature()`, policies are automatically registered into `platform.maintenanceRegistry`.
`filterCondition` is intentionally limited to one safe column comparison with a literal value (for example, `status = 'ARCHIVED'`); boolean clauses, SQL statements, and arbitrary expressions are rejected at manifest registration and again by the pruner.

### Background Execution & Diagnostics

- **Background Scheduling**: `StorageMaintenanceWorker` in `@platform/tasks` wraps `MaintenanceOrchestrator` for periodic unattended execution with deduplication key `maintenance:storage:${orgId}`.
- **Diagnostics UI**: The Diagnostics page (`apps/demo/src/pages/DiagnosticsPage.tsx`) provides a live overview of all registered pruners, candidate row counts, and an interactive "Run Storage Maintenance" action button with live result feedback.

---

## Future work

| Enhancement                          | ADR                | Status                                   |
| ------------------------------------ | ------------------ | ---------------------------------------- |
| Encrypted database layer (SQLCipher) | ADR-026            | Deferred — key hierarchy not yet defined |
| Automated backup/restore             | —                  | Not yet implemented                      |
| Backup encryption                    | Depends on ADR-026 | Deferred                                 |
