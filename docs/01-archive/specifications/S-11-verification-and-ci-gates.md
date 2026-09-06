# S-11 --- Verification and CI Gates

**Status:** Ready\
**Priority:** P0

## CI layers

### Static

TypeScript typecheck/lint/format; Rust fmt/clippy; dependency and
lockfile checks.

### Unit

Database, identity, authorization, feature resolver, protocol and
conflict logic.

### Integration

Persistent SQLite, migrations, Tauri command boundary, feature
registration and sync protocol.

### Security

Cross-tenant access, revoked device, invalid signature, replay,
capability boundary, secret leakage and raw DELETE prevention.

### Sync

Duplicate operation, reordering, reconnect, retry, quarantine and
tombstones.

### Release

Actual Tauri packaging, artifact inspection, signing and target-specific
validation.

## Architecture tests

Automate the project's critical invariants:

1.  no DB bypass
2.  no hard-coded role checks
3.  syncable entity requires sync policy
4.  no data before seven-layer authorization
5.  no private-key leakage
6.  no raw DELETE for sync entities
7.  no broad Tauri capability
8.  security changes require tests
9.  feature/platform dependency boundaries

## Completion rule

Compilation alone is never a completion gate.

## Implemented baseline

CI runs format check, typecheck, unit tests, integration, security, and sync
gates, plus Rust fmt/clippy/test on the pinned toolchain. `pnpm verify`
reproduces the TypeScript sequence locally.

CI does not yet run ESLint as a separate job, architecture-invariant scanners,
signing checks, or E2E. Integration and security jobs cover the current
in-memory/in-process boundary, not durable SQLite or real iroh transport.
