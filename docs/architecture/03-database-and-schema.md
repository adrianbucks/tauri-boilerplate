# 06 — Database and Schema

---

## Principles

- One SQLite database per application instance per device
- No feature or UI component opens its own database connection
- All data access goes through: `UI → service → repository → database package → SQLite`
- Migrations are applied at application startup in version order
- A failed migration must not corrupt the database — rollback or halt

---

## Database package: `packages/database`

### Responsibilities

```
packages/database/
├── src/
│   ├── index.ts                 ← Public API exports
│   ├── connection/
│   │   ├── DatabaseConnection.ts   ← Singleton connection wrapper
│   │   └── DatabaseHealth.ts       ← Health check, integrity check
│   ├── migrations/
│   │   ├── MigrationEngine.ts      ← Applies platform migrations at startup
│   │   └── FeatureMigrationEngine.ts ← Applies feature migrations after platform
│   ├── repository/
│   │   ├── BaseRepository.ts       ← Query helpers, typed results
│   │   └── TransactionRunner.ts    ← BEGIN / COMMIT / ROLLBACK wrapper
│   └── schema/
│       └── platform/               ← Core platform Drizzle schema definitions
```

### Connection rule

```typescript
// packages/database/src/connection/DatabaseConnection.ts
// Exported as a singleton — features must import this, never create their own

export interface DatabaseConnection {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  healthCheck(): Promise<HealthResult>;
}
```

No component outside `packages/database` may call SQLite APIs directly.

---

## Drizzle integration strategy

**Decision pending ADR-003/ADR-004 — use spike result.**

### Preferred path (validate in Spike 0.3)

```
React → typed service → typed repository
    → Tauri command
    → Rust sqlx
    → SQLite file
```

Drizzle ORM is used in TypeScript only for:

- Schema type definitions (tables as TypeScript objects)
- Type-safe query building against those types
- `drizzle-kit generate` to produce SQL migration files

Drizzle does not directly hold a connection to the database. The Rust layer manages the actual SQLite connection through `sqlx`.

### Migration workflow

```bash
# Developer workflow (on schema change):
pnpm drizzle-kit generate --name=add_sync_cursors

# This produces:
# packages/database/migrations/0005_add_sync_cursors.sql

# At application startup (Rust):
# Rust reads all *.sql files, applies in order, records in core_migrations
```

Migration files are committed to source control and are append-only — never edit a migration that has been applied in production.

---

## Core platform schema

### Schema conventions

Every platform table follows these conventions:

```sql
-- Standard metadata columns (all tables)
id          TEXT PRIMARY KEY    -- UUID/ULID (see ADR — identifier strategy)
created_at  TEXT NOT NULL       -- UTC ISO-8601
updated_at  TEXT NOT NULL       -- UTC ISO-8601

-- Attributable tables additionally include:
created_by  TEXT REFERENCES core_users(id)
updated_by  TEXT REFERENCES core_users(id)
```

**Synchronisable entities** additionally require:

```sql
entity_id       TEXT NOT NULL UNIQUE   -- The stable public identity of this record
organisation_id TEXT NOT NULL REFERENCES core_organisations(id)
sync_group_id   TEXT NOT NULL REFERENCES core_sync_groups(id)
schema_version  INTEGER NOT NULL DEFAULT 1
sync_version    INTEGER NOT NULL DEFAULT 0   -- Monotonic, incremented on each sync write
```

Do not add all columns to every table. Apply only what the table's purpose requires.

### Core tables

```sql
-- Organisation and membership
core_organisations      -- name, domain, settings
core_users              -- userId, organisationId, displayName, status
core_devices            -- deviceId, userId, publicKey, platform, status
core_memberships        -- userId, organisationId, status, role

-- Role-based access control
core_roles              -- id, name, organisationId, description
core_permissions        -- id, name (hierarchical: 'inventory.read'), description
core_role_permissions   -- roleId, permissionId, scopeConstraints (JSON)
core_user_roles         -- userId, roleId, organisationId, grantedBy, grantedAt

-- Sync infrastructure
core_sync_groups        -- id, name, organisationId, policy (JSON), status
core_sync_group_members -- groupId, deviceId, status, joinedAt, revokedAt
core_sync_group_policies -- groupId, namespace, rules (JSON)

-- Membership lifecycle
core_membership_requests  -- id, deviceId, groupId, requestedAt, status
core_membership_decisions -- id, requestId, decidedBy, decision, decidedAt, signature
core_revocations          -- id, deviceId, groupId, revokedBy, revokedAt, reason

-- Audit
core_audit_events       -- id, eventType, userId, deviceId, organisationId,
                        --   correlationId, timestamp, metadata (JSON)

-- Sync session state
core_sync_peers         -- id, deviceId, lastSeen, connectionMode, status
core_sync_sessions      -- id, peerId, startedAt, endedAt, state, bytesExchanged
core_sync_cursors       -- id, peerDeviceId, namespace, cursor (last applied position)
core_sync_conflicts     -- id, entityId, namespace, detectedAt, resolution, resolvedAt

-- Migration tracking
core_migrations         -- version, name, appliedAt, checksum
core_feature_migrations -- featureId, version, name, appliedAt, checksum

-- Application registry
core_applications       -- id, name, version, protocolVersion, installedAt
```

Exact column definitions are a design task per table — the above represents required tables, not a complete DDL.

---

## Repository pattern

### Rule

Every feature that reads or writes data owns its own repository. Repositories never reach into another feature's tables directly. Cross-feature data access uses a service-to-service call.

### Repository convention

```typescript
// features/example-feature/src/repositories/widgetRepository.ts

import { BaseRepository } from '@platform/database';
import { widgets } from '../schema/widgets';

export class WidgetRepository extends BaseRepository {
  async findById(id: string): Promise<Widget | null> {
    // Use Drizzle query builder against typed schema
  }

  async findByOrganisation(
    organisationId: string,
    options?: QueryOptions
  ): Promise<Widget[]> { ... }

  async create(data: CreateWidgetInput): Promise<Widget> { ... }

  async update(id: string, data: UpdateWidgetInput): Promise<Widget> { ... }

  // NEVER: raw DELETE for synchronisable records
  // Instead: mark as deleted with tombstone
  async softDelete(id: string, deletedBy: string): Promise<void> { ... }
}
```

### Transaction boundary for business operations

```typescript
// features/example-feature/src/services/widgetService.ts

async createWidget(input: CreateWidgetInput, ctx: OperationContext): Promise<Widget> {
  return this.db.transaction(async (tx) => {
    // 1. Validate
    this.validate(input);

    // 2. Authorize
    this.auth.require('widgets.create', { organisationId: ctx.organisationId });

    // 3. Write business record
    const widget = await this.widgetRepo.create(input, tx);

    // 4. Write audit event (in same transaction)
    await this.audit.emit({
      eventType: 'RECORD_CREATED',
      entityId: widget.id,
      correlationId: ctx.correlationId,
    }, tx);

    // 5. Write replication metadata (in same transaction)
    await this.sync.enqueue({
      entityType: 'widget',
      entityId: widget.id,
      operation: 'create',
      correlationId: ctx.correlationId,
    }, tx);

    return widget;
  });
  // Network sync happens outside this transaction
}
```

---

## Feature schema and migrations

Each feature owns its own table namespace and migration sequence. Feature tables use a prefix matching the feature ID:

```sql
-- features/inventory/ tables:
inventory_items
inventory_locations
inventory_movements

-- features/warehouse/ tables:
warehouse_sites
warehouse_zones
```

Feature migration files live at `features/<name>/src/migrations/`:

```
features/inventory/src/migrations/
├── 0001_initial_inventory.sql
├── 0002_add_lot_tracking.sql
└── 0003_add_expiry_dates.sql
```

Platform migrations always run before feature migrations. Feature migrations run in dependency order.

---

## Database indexes

Indexes should be driven by actual query patterns — not added speculatively.

**Expected initial indexes**:

```sql
-- Core: queries by organisation
CREATE INDEX idx_users_organisation ON core_users(organisation_id);
CREATE INDEX idx_devices_user ON core_devices(user_id);
CREATE INDEX idx_sync_group_members_group ON core_sync_group_members(group_id);
CREATE INDEX idx_sync_group_members_device ON core_sync_group_members(device_id);

-- Audit: time-range queries
CREATE INDEX idx_audit_events_timestamp ON core_audit_events(timestamp);
CREATE INDEX idx_audit_events_organisation ON core_audit_events(organisation_id);

-- Sync: cursor lookups
CREATE INDEX idx_sync_cursors_peer_namespace ON core_sync_cursors(peer_device_id, namespace);
CREATE INDEX idx_sync_conflicts_entity ON core_sync_conflicts(entity_id, namespace);
```

Feature-specific indexes are owned by the feature and applied in the feature's migrations.

---

## Data integrity rules

Use database constraints everywhere:

```sql
NOT NULL     -- on every column that cannot be null
UNIQUE       -- on every business key
FOREIGN KEY  -- on every relationship (enforce at connection open time: PRAGMA foreign_keys = ON)
CHECK        -- on every enum-like field (e.g., status IN ('ACTIVE','REVOKED'))
```

TypeScript validation and DB constraints are complementary. Neither replaces the other.

---

## Tombstones for synchronisable deletes

Never execute a raw `DELETE` on a record that has been or may be synchronised.

```sql
-- Synchronisable records include a tombstone pattern:
ALTER TABLE inventory_items ADD COLUMN deleted_at TEXT;
ALTER TABLE inventory_items ADD COLUMN deleted_by TEXT REFERENCES core_users(id);
ALTER TABLE inventory_items ADD COLUMN delete_operation_id TEXT;

-- Queries always filter:
SELECT * FROM inventory_items WHERE deleted_at IS NULL;
```

The delete operation generates a `delete` sync operation that propagates the tombstone to peers. See doc 09 for full tombstone lifecycle and garbage collection.

---

## Backup strategy

**RESEARCH REQUIRED** — see doc 17, item R-007.

SQLite online backup API allows a consistent copy while the database is open. Evaluate:

- `sqlite3_backup_init` / `sqlite3_backup_step` API via sqlx
- Scheduled automatic backup to the user's configured backup location
- Manual export triggered from the diagnostics screen

The backup must be:

- Transactionally consistent (not a file copy while writes are in progress)
- Not blocked by active reads/writes
- Optionally encrypted (evaluate with the secure storage ADR)
