# R-02 --- SQLite Persistence and Migrations

## Question

What production database architecture is appropriate for durable
local-first SQLite state?

## Findings

The current in-memory `sql.js` connection is a test-oriented
implementation and must not be presented as production persistence.
SQLite WAL is part of persistent database state, and backup/recovery
procedures must account for it. Foreign-key enforcement must be
explicitly enabled and verified.

Drizzle supports SQLite schemas and generated/versioned migrations.
Development convenience operations such as schema push should not
replace release migrations.

## Required direction

- Use a durable native SQLite implementation in production.
- Configure and verify required pragmas on every connection.
- Separate core, feature and application migration ownership.
- Record migration owner, ID, checksum and application version.
- Fail on checksum mismatch.
- Do not execute arbitrary migration SQL by naïvely splitting on
  semicolons.
- Test restart persistence, rollback, concurrency and backup/recovery.

## Sources

- https://www.sqlite.org/wal.html
- https://www.sqlite.org/foreignkeys.html
- https://orm.drizzle.team/docs/sqlite/get-started-sqlite
- https://orm.drizzle.team/docs/migrations

## Research gate

Select and benchmark the exact native SQLite binding for Windows and
Android before freezing adapter APIs.
