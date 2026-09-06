# ADR-004: Drizzle ORM Integration and Migration Strategy

**Status**: Accepted  
**Date**: 2026-08-30  
**Authors**: Antigravity Pair Programming

---

## Context

The platform requires type-safe schema definitions in TypeScript and robust schema migrations for SQLite that execute deterministically on application startup.

## Options Considered

### Option A: Manual Raw SQL & Custom Migration Scripts

- Pure SQL files with custom migration tracking.
- _Downsides_: No type safety in TypeScript, manual synchronization between TypeScript types and SQL schemas, high error rate.

### Option B: Prisma

- Full-featured ORM.
- _Downsides_: Heavy engine binary, incompatible with mobile/Android WebView architecture in Tauri without complex workarounds.

### Option C: Drizzle ORM + Drizzle Kit (Chosen)

- Lightweight TypeScript-first schema definitions (`sqliteTable`).
- Zero heavy runtime dependencies.
- `drizzle-kit generate` produces standard SQL migration files (`.sql`) based on schema changes.
- Migrations are applied in order on application startup and recorded in `core_migrations` (platform) and `core_feature_migrations` (features).

## Decision

We adopt **Option C**:

1. **Schema Definition**: Platform tables defined in `@platform/database/src/schema/`; feature tables defined in `features/<name>/src/schema/`.
2. **Migration Generation**: Developers run `pnpm drizzle-kit generate` to output sequential `.sql` migration files.
3. **Migration Execution**: On application boot, the native migration runner verifies checksums and applies pending migrations inside an exclusive transaction before the application UI opens.
4. **Feature Migration Isolation**: Platform migrations (`core_*`) always execute before feature migrations.

## Consequences

- Full type safety for all entities in TypeScript.
- Clean SQL migration files committed to Git.
- Resilient startup sequence on both Windows and Android.
