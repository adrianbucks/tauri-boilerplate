# Database and Persistence Implementation Plan

## Current state

The repository currently provides a database abstraction and a
memory/sql.js implementation suitable for tests and demonstrations. The
production persistent SQLite path is not complete.

The migration system and schema abstractions are useful foundations, but
platform migrations, feature migrations and application migrations need
clearer ownership and isolation.

## Target state

```text
Application
   ↓
Service
   ↓
Repository
   ↓
Database API
   ↓
Persistent SQLite
```

No UI component or business service should open a raw database
connection.

## 1. Production SQLite runtime

Implement a native SQLite connection in Rust/Tauri.

Requirements:

- persistent database file;
- WAL mode;
- foreign key enforcement;
- busy timeout;
- transaction support;
- integrity checking;
- controlled connection lifecycle;
- safe database path resolution;
- database version management;
- crash recovery;
- backup/export hooks;
- platform-specific filesystem handling.

The TypeScript database abstraction should remain stable so application
code is not coupled to the Rust driver.

## 2. Database ownership

Use three conceptual migration domains:

```text
Platform migrations
Application migrations
Feature migrations
```

Recommended metadata:

```text
core_migrations
  version
  name
  checksum
  applied_at

core_feature_migrations
  feature_id
  version
  name
  checksum
  applied_at

core_application_migrations
  application_id
  version
  name
  checksum
  applied_at
```

At minimum, feature/version uniqueness must be scoped by owner rather
than using one global integer version.

## 3. Migration invariants

Every migration must:

- have a stable identifier;
- have an immutable checksum after release;
- execute transactionally where SQLite permits;
- record success;
- fail closed on checksum mismatch;
- provide a clear recovery path;
- never silently skip a changed migration;
- support ordered upgrades.

Do not implement SQL parsing using naïve `split(";")` logic for
general-purpose migrations.

## 4. Application database API

Expose an application-safe API such as:

```ts
interface Database {
  query<T>(...): Promise<T[]>;
  execute(...): Promise<ExecuteResult>;
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  migrate(): Promise<void>;
  healthCheck(): Promise<DatabaseHealth>;
}
```

Application repositories may use either:

- typed query builders;
- approved raw SQL through the database package;

but the choice must be documented. Drizzle should not be presented as
the runtime ORM if the runtime architecture actually uses Rust/SQLite
behind a repository abstraction.

## 5. Atomic local-first mutation

For a synchronisable mutation:

```text
BEGIN
  validate input
  authorise operation
  mutate business row
  write audit event
  write sync operation
  update tombstone if applicable
COMMIT
```

Network activity must never be required for the transaction to succeed.

## 6. Application-defined schemas

The platform must not own application tables.

Example consuming application:

```text
app_products
app_orders
app_order_lines
app_warehouses
```

The platform supplies the infrastructure needed to:

- register them;
- migrate them;
- query them;
- audit them;
- synchronise them if declared synchronisable.

## 7. Testing gates

Before marking persistence complete:

- reopen database and data remains;
- WAL is actually enabled;
- foreign keys reject invalid references;
- transaction rollback works;
- crash/restart recovery works;
- migrations upgrade successfully;
- migration checksum tampering is detected;
- feature migrations with identical version numbers coexist;
- application migrations are isolated;
- concurrent reads/writes behave predictably;
- backup/restore is tested.
