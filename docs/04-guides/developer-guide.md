# Developer Guide & Workflow

This guide covers engineering workflows, package development, code style standards, and verification requirements for contributors.

---

## 1. Monorepo Architecture & Package Management

The repository uses `pnpm` workspaces coordinated by `Turborepo` alongside a native Cargo workspace.

```text
tauri-boilerplate/
├── packages/           # Domain-neutral platform infrastructure (@platform/*)
├── features/           # Modular domain capabilities (@features/*)
├── crates/             # Native Rust crates (native-core, identity-core, etc.)
├── apps/               # Executable application entry points (@apps/demo)
└── tests/              # Cross-cutting integration and security suites
```

### Dependency Rules

- **Unidirectional Flow**: `packages` must NEVER import from `features` or `apps`.
- **Domain Independence**: Features communicate through explicit interfaces, never tight coupling.
- **Explicit Workspace Protocol**: All inter-package dependencies use `workspace:*`.

---

## 2. Common Development Commands

### Building
```bash
# Build all TypeScript packages and applications
pnpm turbo build

# Build native Rust crates in release mode
cargo build --workspace --release
```

### Type Checking & Linting
```bash
# Run TypeScript compilation checks across all workspaces
pnpm turbo typecheck

# Check code formatting (Prettier)
pnpm format:check

# Auto-format all code
pnpm format

# Run Rust linter (Clippy) with strict warnings
cargo clippy --workspace --all-targets -- -D warnings

# Check Rust code formatting
cargo fmt --all -- --check
```

### Testing
```bash
# Run all fast unit tests
pnpm turbo test

# Run cross-package integration tests
pnpm test:integration

# Run security regression tests (RBAC, pairing, capabilities)
pnpm test:security

# Run synchronization and protocol tests
pnpm test:sync

# Run native Rust unit tests
cargo test --workspace
```

---

## 3. Engineering Conventions & Invariants

### 1. Mandatory Correlation IDs
Every state mutation, audit event, import job, and background task must receive or generate a `correlationId` (UUID v4) and propagate it down the call graph.

### 2. Tenant Isolation by Default
All domain queries must explicitly require `organisationId`. Never write repository queries that fetch records across tenant boundaries.

### 3. Error Handling
- Use typed error classes extending `PlatformError` from `@platform/core`.
- Include distinct error codes (`AUTH_DENIED`, `RECORD_NOT_FOUND`, `VERSION_CONFLICT`).
- Never swallow errors silently without logging or re-throwing.

### 4. Transactions
Atomic mutations across multiple tables (e.g. updating an entity + writing an audit event + queuing an outbox envelope) must execute inside a `db.transaction()` block:

```typescript
await db.transaction(async (tx) => {
  await repository.withTransaction(tx).update(entity);
  await auditService.withTransaction(tx).record(auditEvent);
  await outboxService.withTransaction(tx).enqueue(syncEnvelope);
});
```

---

## 4. Pre-PR Checklist

Before opening a pull request, ensure the complete verification pipeline succeeds:

- [ ] `pnpm format:check` passes without errors.
- [ ] `pnpm turbo typecheck` passes with zero type diagnostics.
- [ ] `pnpm test` and `pnpm test:security` pass completely.
- [ ] `cargo fmt --all -- --check` and `cargo clippy` pass without warnings.
- [ ] `cargo test --workspace` passes all Rust unit tests.
- [ ] Any security or permission changes have accompanying tests in `tests/security/`.
- [ ] Documentation in `docs/` is updated to reflect all functional or schema changes.
