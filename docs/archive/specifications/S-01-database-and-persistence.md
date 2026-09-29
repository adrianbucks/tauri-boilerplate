# S-01 --- Database and Persistence

**Status:** Ready after driver-selection research gate\
**Priority:** P0

## Objective

Replace the in-memory production path with durable SQLite while
retaining a testable database abstraction.

## Target architecture

```text
Feature repository
      |
Platform database service
      |
Database adapter
      |
+-------------------+
| Production SQLite |
| Test SQLite       |
+-------------------+
```

## Required changes

- Remove `sql.js` from the production path.
- Initialise and verify required SQLite pragmas.
- Make migrations a startup readiness gate.
- Give core, feature and application migrations distinct ownership
  namespaces.
- Record owner, migration ID, checksum, applied timestamp and
  application version.
- Fail on checksum mismatch.
- Use a migration runner that understands SQL correctly; never naïvely
  split arbitrary SQL by semicolons.
- Ensure syncable business mutations and operation enqueue have an
  explicit atomicity strategy.

## Errors

Use stable categories such as `DatabaseOpenFailed`, `MigrationFailed`,
`MigrationChecksumMismatch`, `ConstraintViolation`, `TransactionFailed`,
`BusyTimeout` and `CorruptDatabase`.

## Tests

Persistence across restart; foreign-key enforcement; pragma
verification; deterministic migration order; checksum mismatch;
rollback; concurrency; backup/recovery including WAL state.

## Acceptance criteria

No production startup uses `:memory:`. All schema changes are versioned
and migration ownership is unambiguous.

## Research gate

Select and benchmark the production SQLite binding on Windows and
Android.
