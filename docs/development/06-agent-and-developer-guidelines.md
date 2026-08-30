# Agent and Developer Guidelines

---

## Mandatory reading for AI agents

Before modifying any code in this repository, an AI agent must read:

1. [`development/01-repository-structure.md`](./01-repository-structure.md) — where things live, what must not be modified
2. [`architecture/02-architecture-principles.md`](../architecture/02-architecture-principles.md) — the non-negotiable rules
3. This document — mandatory behaviour
4. The topic document in `docs/architecture/` most relevant to the component being modified

If the task involves a specific package or feature, also read the relevant ADR in `docs/decisions/` before making changes.

---

## Non-negotiable agent rules

These rules must not be relaxed without a new ADR and human review.

### Data access rules

```
1. NEVER access SQLite directly from React components or TypeScript feature code.
   All data access: UI → service → repository → database package → Rust → SQLite.

2. NEVER open a database connection from a feature package.
   One connection, owned by packages/database. Features use repositories.

3. NEVER use raw DELETE for synchronisable records.
   Use tombstone pattern: set deleted_at, deleted_by, delete_operation_id.
```

### Authorisation rules

```
4. NEVER write if (user.role === 'admin') or any role-check in feature code.
   Always use: authorization.require('permission.name', resourceScope).

5. NEVER skip the authorisation check in a service method.
   Every public service method that modifies data must call require() before the write.

6. NEVER add permissions directly into feature UI components.
   UI can use can() to show/hide elements, but the backend service always re-checks.

7. NEVER grant a Tauri capability as 'allow-all'.
   Every capability grant must be narrowly scoped and commented.
```

### Synchronisation rules

```
8. NEVER synchronise an entity type without a registered sync policy in the FeatureManifest.
   The build validator rejects this — do not attempt to work around it.

9. NEVER transmit data before passing all seven authorisation layers.
   The order is fixed: iroh connection → identity → handshake → organisation →
   device auth → sync-group → data-scope → sync.

10. NEVER implement "download all, filter locally".
    Authorised namespaces only. The sync engine receives only the allowed namespace list.
```

### Security rules

```
11. NEVER store private keys in TypeScript, React state, localStorage, sessionStorage,
    or SQLite. Private keys exist only in crates/identity-core + OS secure storage.

12. NEVER return private key material from a Tauri command.
    Commands return only DeviceIdentity (public material).

13. NEVER log private keys, credentials, plaintext passwords, or sensitive personal data
    at any log level. This includes debug and trace.

14. NEVER silently weaken a security rule. If a rule must change, write an ADR,
    update the security test, update the changelog Security section.
```

### Research rules

```
15. NEVER implement a RESEARCH REQUIRED item by guessing or using remembered API knowledge.
    Read the current official documentation. Build a spike. Write an ADR.
    This applies especially to: Tauri, iroh, Drizzle, TanStack.

16. NEVER add a dependency without documenting: purpose, license, maintenance status,
    bundle impact, Android compatibility, Windows compatibility, security implications,
    and alternatives considered.
```

### Documentation rules

```
17. Update documentation when changing a protocol, a public API, or a security rule.
    Code changes without documentation updates are incomplete.

18. Report unresolved research questions in the PR description or as a TODO comment
    with a reference to the relevant research item in doc 17.

19. Never mark a RESEARCH REQUIRED item as resolved without an ADR that records the
    spike code, the findings, and the decision.
```

---

## Contract-first development

Before any parallel implementation work begins, establish stable interfaces for the services that multiple components depend on. Implementations can change; interfaces must be agreed first.

### Core interfaces to agree before Phase 2 parallel work

```typescript
// These interfaces must be approved before parallel agent streams begin

interface IdentityProvider {
  getDeviceIdentity(): Promise<DeviceIdentity>;
  getCurrentSession(): Session | null;
  establishSession(credentials: Credentials): Promise<Session>;
  invalidateSession(): void;
}

interface AuthorizationService {
  can(
    subject: Subject,
    permission: PermissionName,
    resource?: ResourceScope,
  ): AuthorizationDecision;
  require(permission: PermissionName, resource?: ResourceScope): void;
  effectivePermissions(): EffectivePermissions;
}

interface SyncManager {
  connect(peerId: string): Promise<void>;
  disconnect(peerId: string): Promise<void>;
  status(): SyncStatus;
  diagnostics(): SyncDiagnostic[];
  requestSync(groupId: string): Promise<void>;
}

interface SyncGroupService {
  createGroup(
    input: CreateGroupInput,
    ctx: OperationContext,
  ): Promise<SyncGroup>;
  requestMembership(
    groupId: string,
    ctx: OperationContext,
  ): Promise<MembershipRequest>;
  approve(requestId: string, ctx: OperationContext): Promise<void>;
  reject(
    requestId: string,
    reason: string,
    ctx: OperationContext,
  ): Promise<void>;
  revoke(
    deviceId: string,
    groupId: string,
    reason: string,
    ctx: OperationContext,
  ): Promise<void>;
  canSync(deviceId: string, groupId: string): Promise<boolean>;
}

interface AuditService {
  emit(
    event: Omit<AuditEvent, "id" | "timestamp">,
    tx?: Transaction,
  ): Promise<void>;
}

interface DatabaseService {
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  healthCheck(): Promise<HealthResult>;
}

interface FileService {
  openFile(filters: FileFilter[]): Promise<FileHandle>;
  saveFile(content: Blob, filename: string): Promise<void>;
  revealFile(path: string): Promise<void>;
}

interface BarcodeScanner {
  scan(): Promise<BarcodeResult>;
  scans(): Observable<BarcodeResult>;
  isAvailable(): boolean;
}

interface FeatureRegistry {
  register(options: FeatureRegistrationOptions): void;
  isInstalled(featureId: string): boolean;
  getFeature(featureId: string): RegisteredFeature | null;
  allFeatures(): RegisteredFeature[];
}
```

The implementation can change without requiring every feature to change, as long as the interface contract is honoured.

---

## Coding standards

### TypeScript

```typescript
// tsconfig.json must include:
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true
}

// Rules:
// - No `any` in platform code unless unavoidable + commented
// - Explicit return types for all public API functions
// - Named exports preferred over default exports
// - No barrel re-exports in feature internal modules
// - Errors must be typed PlatformError — not thrown as raw strings
```

### Rust

```toml
# Cargo.toml workspace settings
[workspace.lints.rust]
unused = "deny"
deprecated = "warn"

[workspace.lints.clippy]
all = "warn"
```

```rust
// Rules:
// - rustfmt formatting enforced in CI
// - clippy warnings treated as errors in CI
// - All public Tauri commands must serialise errors to PlatformError
// - No unwrap() in production code — use ? operator and proper error types
// - Async Tauri commands use async_runtime appropriately
```

### Commit messages

Use Conventional Commits format:

```
feat(packages/database): add migration rollback support
fix(packages/authorization): fix scope evaluation for nested warehouseId
security(crates/sync-core): validate peer certificate before handshake
docs(docs/decisions): add iroh-docs spike results to ADR-013
chore(deps): update tauri to v2.x.y
```

Types: `feat`, `fix`, `security`, `perf`, `refactor`, `test`, `docs`, `chore`, `build`, `ci`

---

## Avoid premature abstraction

Do not build abstractions for hypothetical requirements:

- Multiple database engines (SQLite is the database)
- Multiple sync engines (iroh is the transport; the sync protocol is chosen in Phase 0)
- Multiple UI frameworks (shadcn/ui + Vanilla CSS)
- Multiple identity providers (one is chosen per ADR)
- Generic workflow DSL
- Generic form designer from JSON config
- Generic screen generator from metadata

Abstract only boundaries justified by the confirmed architecture. Every premature abstraction adds maintenance cost and complexity without adding value.

---

## Agent task decomposition guidance

When working on a complex task, follow this process:

1. Identify which package(s) the task belongs to
2. Read the relevant architecture documents for those packages
3. Read relevant ADRs before making design decisions
4. Inspect existing interfaces — do not duplicate platform functionality
5. Implement with tests
6. Run: `pnpm turbo lint typecheck test` and `cargo test --workspace`
7. Update documentation if contracts changed
8. Report unresolved research questions in the PR description

### Recommended parallel agent streams (for large implementation phases)

When multiple agents work in parallel, each must own a separate architectural boundary. They must not independently invent overlapping contracts.

The technical lead establishes interfaces first. Agents implement behind those interfaces.

| Agent stream | Packages / area                                              |
| ------------ | ------------------------------------------------------------ |
| A            | Repository tooling, CI, `packages/core`                      |
| B            | `packages/database` + Drizzle + migrations                   |
| C            | `crates/identity-core` + `packages/identity`                 |
| D            | `packages/authorization` + `packages/audit` + sync groups    |
| E            | iroh connectivity spike (`crates/sync-core` transport layer) |
| F            | iroh-docs spike (replication evaluation)                     |
| G            | `packages/ui` + AppShell + DataTable                         |
| H            | `packages/import-export` + hardware                          |
| I            | Testing infrastructure (harness + security suite)            |

Agents E and F run during Phase 0 as spike agents — their code is throwaway spike code, not production commits.

---

## Definition of done checklists

### Platform package done when

- [ ] Public API is stable and documented
- [ ] All public types are exported from `src/index.ts`
- [ ] Unit tests cover core behaviours and error paths
- [ ] No `any` types in public API surface
- [ ] Relevant ADR exists and references this implementation
- [ ] `pnpm turbo lint typecheck test` passes

### Feature done when

- [ ] Manifest is complete (id, version, dependencies, permissions, migrations, syncPolicies if applicable)
- [ ] All permissions used in code are declared in manifest
- [ ] All synchronisable entities have a sync policy
- [ ] Repository layer tested
- [ ] Service layer tested (including auth + audit calls)
- [ ] UI pages tested (at least smoke tests)
- [ ] Import/export defined if the feature requires it
- [ ] `pnpm turbo lint typecheck test` passes

### Security change done when

- [ ] Security test added or updated in `tests/security/`
- [ ] `### Security` entry added to CHANGELOG.md
- [ ] Relevant ADR updated if the security model changed
- [ ] `pnpm test:security` passes

### Release done when

- [ ] CHANGELOG.md updated with all changes
- [ ] Version bumped in root `package.json`
- [ ] All CI jobs pass
- [ ] GitHub Release created with signed Windows installer + Android APK
- [ ] SHA256 checksums attached to release
