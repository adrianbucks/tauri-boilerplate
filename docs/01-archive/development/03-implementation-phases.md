# 05 — Implementation Phases

This document is the original phased engineering plan. Keep it as the reference for what each phase must produce.

- **Current work order:** [development/roadmap.md](./roadmap.md)
- **Evidence of what exists:** [verification/status.md](../verification/status.md)
- TypeScript platform packages already exist; several Phase 0 research gates (SQLite binding, secure storage, iroh) are still open. Do not wait for a greenfield Phase 0 before continuing the roadmap.

Work still proceeds so that later phases do not skip earlier P0 gates.

## Overview

The six phases below remain the acceptance structure. The repository already contains TypeScript platform packages, so work is no longer a greenfield Phase 0. Open research gates still block **stabilising** production persistence, identity, and sync — they do not require deleting existing packages.

P0 gates from earlier phases must still be closed before calling a later milestone complete. Current sequencing is [roadmap.md](./roadmap.md).

---

## Milestones

| Milestone                  | Phase | Status     | Description                                                                                                                    |
| -------------------------- | ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| M1 — Bootable Platform     | 1     | Partial    | TypeScript platform scaffold, migration engine, feature registry, and demo boot                                                |
| M2 — Secure Local Platform | 2     | Partial    | Identity types, RBAC, audit, sync groups, UI, and demo app slices exist; secure storage and durable persistence are incomplete |
| M3 — P2P Proof             | 3     | Scaffolded | Handshake and pairing simulations exist; real iroh transport and signed peer proof are absent                                  |
| M4 — Replication Decision  | 4     | Partial    | HLC/conflict policy types and a simulation harness exist; durable operation replication is absent                              |
| M5 — Complete Platform     | 5     | Partial    | Import/export, hardware abstraction, and vertical-slice demo exist; production integration remains incomplete                  |
| M6 — Release Pipeline      | 6     | Partial    | Windows and Android packaging are verified; signing and production release governance remain incomplete                        |

---

## Phase 0 — Architecture Spikes and ADRs

**Goal**: Prove every high-risk assumption before committing to any platform abstraction.

**Original rule**: spikes lived in `apps/platform-spike/` and were deleted afterwards. That directory is not in the current repo. Remaining spikes should still be throwaway or clearly isolated, recorded in an ADR, and must not guess evolving APIs.

### Spike 0.1 — Repository Bootstrap

Set up the repository skeleton:

```
pnpm workspace + Turborepo
Tauri 2 shell (apps/platform-spike/)
React + Vite + TypeScript
shadcn/ui minimal setup
ESLint + Prettier + Rustfmt + Clippy
GitHub Actions skeleton (lint + typecheck only at this stage)
.gitignore (including dist/, keys, secrets)
CHANGELOG.md initial entry
```

**Acceptance**: `pnpm turbo build` passes. `pnpm turbo lint` passes. `pnpm turbo typecheck` passes.

### Spike 0.2 — Tauri Windows + Android

Prove on **real physical hardware** (not emulator). Packaging is verified; several launch and signing items remain open:

- [x] Windows `.msi` / NSIS installer **builds** (local and `build.yml`)
- [x] Android APK **builds** (local and `build.yml`; JDK 17)
- [ ] Windows installer launches on target hardware as a signed production artefact
- [ ] Android APK launches on a physical device (API 35+)
- [x] React/Vite frontend loads inside Tauri webview in development
- [x] TypeScript can call a Tauri command (`get_device_identity`)
- [x] Rust returns structured errors via `native-core`
- [ ] Capability matrix complete and CI-checked (currently a narrow default capability set)
- [ ] Production bundle sizes recorded
- [ ] Updater signing key generation documented and used in CI

**ADR output**: `docs/decisions/ADR-002-tauri-architecture.md`

### Spike 0.3 — SQLite + Drizzle + Tauri

Determine the supported integration path. Test both candidate architectures:

**Option A** (preferred — validate this first):

```
React → typed repository → Tauri command → Rust/sqlx → SQLite
Drizzle ORM used only for TypeScript schema types
drizzle-kit used for migration file generation
Migrations applied by Rust at startup
```

**Option B** (fallback — validate only if Option A has blockers):

```
React → Drizzle → tauri-plugin-sql bridge → SQLite
```

Tests that must pass for the chosen path:

- [ ] Create database and open connection
- [ ] Define a Drizzle table
- [ ] Generate migration with `drizzle-kit generate`
- [ ] Apply migration at startup
- [ ] CRUD operations (create, read, update, delete)
- [ ] Transaction commits atomically
- [ ] Transaction rolls back on error
- [ ] Concurrent read operations work
- [ ] Migration upgrade (v1 → v2) works
- [ ] Migration failure does not corrupt the database

**ADR output**: `docs/decisions/ADR-003-sqlite-access.md`, `docs/decisions/ADR-004-drizzle-integration.md`

### Spike 0.4 — iroh Connectivity

Prove basic P2P connectivity on real hardware:

- [ ] Windows → Windows (same LAN)
- [ ] Windows → Android (same LAN)
- [ ] Windows → Windows (different networks via relay fallback)
- [ ] Disconnect and reconnect without error
- [ ] iroh node initialises correctly on Android (API 35+)

**ADR output**: `docs/decisions/ADR-012-iroh-transport.md`

### Spike 0.5 — iroh-docs Replication (CRITICAL)

This is the single most important Phase 0 research item. Build the prototype described below and answer **all 15 questions** before making the decision.

**Prototype scenario**:

```
Device A creates document, writes records
Device B joins document, receives records
Device A goes offline
Device B modifies records
Device A modifies records
Both reconnect
Observe: replication, ordering, conflicts, authorship,
         partial sync, namespace handling
```

**15 questions that must be answered**:

1. Can one iroh-docs document represent a sync group namespace?
2. Can multiple entity types coexist safely within a document?
3. Can data be selectively replicated within a namespace?
4. Can revoked peers be prevented from receiving future updates?
5. Can historical data access be restricted after revocation?
6. Can membership changes be represented safely?
7. How are document authors identified and verified?
8. What happens with offline writes — are they correctly merged on reconnect?
9. What is the conflict model — last-write-wins, causal, or other?
10. Can SQLite remain the query layer while iroh-docs handles replication storage?
11. How does the system handle large datasets (10k+ entities per namespace)?
12. What are the memory implications on Android with multiple documents open?
13. Can documents be partitioned by warehouse/sync-group to contain blast radius?
14. How are deleted records represented — tombstones, or implicit?
15. Can tombstones be safely garbage-collected without resurrecting data on old peers?

**Decision gate** — choose one path:

| Option            | Architecture                                                               |
| ----------------- | -------------------------------------------------------------------------- |
| A — iroh-docs     | SQLite ↕ sync adapter ↕ iroh-docs ↕ iroh                                   |
| B — custom op log | SQLite ↕ operation log ↕ custom reconciliation ↕ iroh                      |
| C — hybrid        | iroh transport + custom domain op model, iroh-docs primitives where useful |

**ADR output**: `docs/decisions/ADR-013-iroh-docs-evaluation.md`, `docs/decisions/ADR-014-conflict-resolution.md`

### Spike 0.6 — Identity and Secure Storage

Research and prototype:

- [ ] Device keypair generation (Ed25519 or equivalent — document choice)
- [ ] Stronghold on Windows: does it work reliably?
- [ ] Windows DPAPI / Credential Manager: is it sufficient?
- [ ] Android Keystore via Tauri: accessible from Rust?
- [ ] Key never touches TypeScript layer: verify the boundary
- [ ] Key survives application reinstall (if expected to persist)

**ADR output**: `docs/decisions/ADR-006-identity-model.md`, `docs/decisions/ADR-019-secure-storage.md`

### Spike 0.7 — RBAC + Sync-Group Authorisation Prototype

Smallest possible version to prove the model is sound:

- [ ] `can(subject, 'inventory.read', { warehouseId: 'COV' })` evaluates correctly
- [ ] `require()` throws `AuthorizationError` on denial
- [ ] A sync group with two approved members passes authorisation
- [ ] A device not in the group fails authorisation
- [ ] A revoked device fails authorisation
- [ ] Permission scopes correctly restrict by `warehouseId`

This is a throwaway prototype — not the production implementation.

**ADR output**: `docs/decisions/ADR-007-rbac.md`, `docs/decisions/ADR-008-scoped-authorisation.md`, `docs/decisions/ADR-009-sync-group-model.md`

### Phase 0 completion checklist

```
- [x] ADR-001 through ADR-014 written (several record intent, not closed spikes)
- [x] ADR-019 written (secure storage direction; implementation still placeholder)
- [x] apps/platform-spike/ not present
- [ ] All spike acceptance criteria met
- [ ] iroh-docs decision recorded with a current spike ([R-06](../research/R-06-iroh-transport-and-iroh-docs.md), ADR-013)
- [ ] Production SQLite binding recorded with a current spike ([R-02](../research/R-02-sqlite-persistence-and-migrations.md))
- [ ] Secure storage path implemented ([R-04](../research/R-04-identity-cryptography-and-secure-storage.md))
```

---

## Phase 1 — Bootable Platform (Milestone 1)

**Goal**: A runnable, CI-passing Tauri app with SQLite, Drizzle, migrations, and a working feature registry.

### 1.1 — `packages/core`

- `PlatformError` type hierarchy (all error codes)
- Rust/TypeScript error serialisation bridge
- Structured logging interface (levels, mandatory fields, what must never be logged)
- `generateCorrelationId()` utility
- Typed application configuration interface (build config, runtime config, security policy)
- UTC timestamp utilities
- HLC placeholder (empty interface — implementation in Phase 4)

### 1.2 — `packages/database`

- SQLite connection abstraction (singleton per app)
- Drizzle schema type registration
- `drizzle-kit generate` + runtime migration apply
- Repository base class with typed query helpers
- Transaction API
- Database health check
- Full core platform schema (see [architecture/03](../architecture/03-database-and-schema.md))

### 1.3 — `packages/feature-system`

- `FeatureManifest` interface
- `registerFeature()` API
- Build-time dependency graph (cycle detection, hard/optional dependency resolution)
- Feature migration ordering
- Permission registration
- `tooling/feature-validator/` build script

### 1.4 — `features/example-feature`

- Complete, documented reference feature
- Demonstrates: manifest, schema, migrations, repository, service, pages, components, permissions, tests
- Used as the copy-paste starting point for downstream developers

### 1.5 — `apps/demo` skeleton

- Tauri application shell
- React router setup
- Platform bootstrap sequence
- Registers `example-feature`
- SQLite initialises and migrations run on startup
- Basic AppShell layout (placeholder navigation)

### 1.6 — CI (Phase 1)

```yaml
# .github/workflows/ci.yml
jobs:
  lint: pnpm turbo lint
  typecheck: pnpm turbo typecheck
  test: pnpm turbo test
  rust-test: cargo test --workspace
  build-check: pnpm turbo build (frontend only, not Tauri binary)
```

**Milestone 1 acceptance**: `pnpm turbo build` passes, `apps/demo` launches on Windows with SQLite initialised and `example-feature` registered.

---

## Phase 2 — Secure Local Platform (Milestone 2)

**Goal**: Identity, RBAC, audit, and sync groups working entirely locally — no P2P yet.

### 2.1 — `crates/crypto-core`

- Key pair generation (algorithm per ADR-006)
- Signing and verification functions
- HLC implementation (if custom sync route chosen per ADR-013)

### 2.2 — `crates/identity-core`

- Device keypair generate + store (backend per ADR-019)
- Private key never returned to Tauri command caller
- `get_device_public_key()` → returns only public material

### 2.3 — `packages/identity`

- `DeviceIdentity`, `UserIdentity`, `Session` TypeScript interfaces
- First-launch identity initialisation flow
- Tauri commands: `getDeviceIdentity()`, `getCurrentSession()`, `registerUser()`

### 2.4 — `packages/authorization`

- `can(subject, permission, resource): AuthorizationDecision`
- `require(permission, resource): void` (throws on denial)
- Role-to-permission bindings loaded from database
- Scope evaluation for `organisation`, `sync_group`, `warehouse`
- Permission name validation (hierarchical format enforced)

### 2.5 — `packages/audit`

- `emitAuditEvent(event: AuditEvent): void`
- Append-only (no update, no delete on `core_audit_events`)
- Minimum event catalogue (full list in [security model](../security/01-security-model.md))
- Attribution: `userId`, `deviceId`, `organisationId`, `correlationId`
- Extension point for future cryptographic chaining

### 2.6 — Sync group data layer (no networking)

- Full membership state machine: REQUESTED → APPROVED → ACTIVE → SUSPENDED → EXPIRED → REVOKED → REJECTED
- `createSyncGroup()`, `inviteMember()`, `requestMembership()`, `approve()`, `reject()`, `revoke()`
- `canSync(deviceId, groupId): boolean`
- Namespace string generation from validated identifiers

### 2.7 — `features/identity-admin` + `features/organisations`

- Admin UI: create/edit users, assign roles, approve/revoke devices
- Admin UI: create sync groups, manage members
- Organisation setup flow

### 2.8 — `apps/demo` Phase 2 additions

- Login / session screen
- Admin panel (via `identity-admin`)
- Permission-gated navigation (routes hidden/shown based on `can()`)

**Milestone 2 acceptance**: Admin can create a user, assign a role, create a sync group, approve a device, and revoke it — all locally, with audit events written.

---

## Phase 3 — P2P Proof (Milestone 3)

**Goal**: Two physical devices pair and exchange a sync group entity under all seven authorisation layers.

### 3.1 — `crates/sync-core` — Transport only

- iroh node initialise + shut down cleanly
- Peer discovery (mDNS + relay)
- Establish and tear down connection
- Android lifecycle: handle foreground/background/suspended/terminated

### 3.2 — Device pairing protocol

Full typed protocol:

```
discover
  ↓ exchange identities
  ↓ verify applicationId match
  ↓ verify organisationId
  ↓ request membership (write to local DB, propagate when connected)
  ↓ administrator approval (approval signed, per ADR-011)
  ↓ role assigned
  ↓ sync groups assigned
  ↓ sync session established
```

### 3.3 — Application handshake message

Handshake includes: `applicationId`, `applicationVersion`, `protocolVersion`, `supportedFeatures`, `supportedEntityVersions`, `deviceId`, `organisationId`. Incompatible protocol version → reject with clear error code.

### 3.4 — `packages/sync` — SyncManager

- Full `SyncState` machine (see [architecture/06](../architecture/06-synchronisation-and-p2p.md))
- `SyncDiagnostic` model
- Typed events observable by UI

### 3.5 — Security acceptance test

A device on the same Wi-Fi network as a Coventry sync group **must not** receive Coventry data unless:

1. It is an approved member of the Coventry sync group, AND
2. It has an ACTIVE membership, AND
3. It passes the data-scope authorisation check

This test must be implemented as an automated security regression test in `tests/security/`.

**Milestone 3 acceptance**: Two physical devices pair through the demo app, exchange a test entity, and the security rejection test passes.

---

## Phase 4 — Replication Decision (Milestone 4)

**Goal**: Full replication working end-to-end using the architecture selected in ADR-013.

### Path A — iroh-docs adapter

- Namespace-per-sync-group document
- Sync adapter bridges SQLite writes to iroh-docs documents
- SQLite remains the operational query layer

### Path B — Custom operation log

Full implementation of `packages/sync-protocol`:

- `SyncOperation` interface with all fields
- Idempotency guarantees (`operationId` UNIQUE, `already_applied` response)
- HLC ordering
- Conflict policy registry
- Tombstone model for deletes
- Offline queue state machine (pending → processing → applied → failed → quarantined)
- Unknown feature quarantine

**Milestone 4 acceptance**: Both devices offline → each makes writes → reconnect → operations reconciled correctly → conflict detected and handled per registered policy.

---

## Phase 5 — Complete Platform (Milestone 5)

**Goal**: All platform capabilities working; `apps/demo` exercises every capability.

### 5.1 — `packages/ui` complete

All shadcn/ui components, AppShell, DataTable with TanStack Table + Virtual.

### 5.2 — `packages/import-export`

Import workflow + SheetJS + file picker. Export CSV + XLSX.

### 5.3 — `packages/hardware`

Barcode scanner on Windows (keyboard-wedge) and Android (plugin — tested on physical device).

### 5.4 — Diagnostics screen in `apps/demo`

Exportable diagnostic bundle (no secrets).

### 5.5 — Full vertical-slice in `apps/demo`

The complete Locations & Warehouses scenario (see [architecture/10](../architecture/10-demo-application.md)).

### 5.6 — Full test suite

All sync harness, security regression, property-based, and performance baseline tests.

**Milestone 5 acceptance**: Coverage in [verification/coverage-matrix.md](../verification/coverage-matrix.md) and [testing strategy](./04-testing-strategy.md) for the vertical slice.

---

## Phase 6 — Release Pipeline (Milestone 6)

**Goal**: Signed, installable Windows + Android builds produced automatically from CI.

### 6.1 — Full GitHub Actions pipeline

```
install → lint → format check → typecheck → unit tests →
Rust tests → integration tests → build → package → sign → publish
```

### 6.2 — Release workflow

Triggered by version tag (`v*`). Produces:

- Windows: `.msi`, `.exe` (NSIS), `.msi.sig`, `latest.json`
- Android: `.apk`, optional `.aab`
- Release notes from `CHANGELOG.md`
- SHA256 checksums
- GitHub Release with all artefacts attached

**Milestone 6 acceptance**: Pushing `git tag v1.0.0` produces a GitHub Release with signed Windows installer and Android APK, downloadable and installable on target hardware.

---

## Immediate next actions (ordered, start today)

| #   | Action                                                                                       | Phase |
| --- | -------------------------------------------------------------------------------------------- | ----- |
| 1   | Create repo skeleton: pnpm, Turborepo, GitHub Actions skeleton, `.gitignore`, `CHANGELOG.md` | 0     |
| 2   | Tauri Windows + Android spike on real hardware                                               | 0     |
| 3   | SQLite + Drizzle + Tauri spike — validate Option A path                                      | 0     |
| 4   | iroh connectivity spike — Windows ↔ Android                                                  | 0     |
| 5   | iroh-docs spike — answer all 15 questions                                                    | 0     |
| 6   | Identity + secure storage spike                                                              | 0     |
| 7   | RBAC + sync-group authorisation prototype                                                    | 0     |
| 8   | Write all ADRs from spike findings                                                           | 0     |
| 9   | Implement `packages/core` + `packages/database`                                              | 1     |
| 10  | Implement `packages/feature-system` + `features/example-feature`                             | 1     |
| 11  | Boot `apps/demo` with SQLite + feature registration                                          | 1     |
| 12  | Implement identity + authorisation + audit                                                   | 2     |
| 13  | Implement iroh transport + sync state machine                                                | 3     |
| 14  | Implement replication per ADR-013 decision                                                   | 4     |
| 15  | Implement UI + import/export + hardware                                                      | 5     |
| 16  | Complete vertical-slice demo + security test suite                                           | 5     |
| 17  | Release pipeline — signed installer + APK from CI                                            | 6     |

---

## Pull request sequence

```
PR-001  Repository bootstrap + tooling
PR-002  Tauri shell (apps/platform-spike deleted at end of Phase 0)
PR-003  packages/core
PR-004  packages/database + core schema
PR-005  packages/feature-system + tooling/feature-validator
PR-006  features/example-feature
PR-007  apps/demo skeleton (Milestone 1)
PR-008  crates/crypto-core + crates/identity-core
PR-009  packages/identity
PR-010  packages/authorization
PR-011  packages/audit
PR-012  Sync group data layer (no networking)
PR-013  features/identity-admin + features/organisations
PR-014  apps/demo Phase 2 additions (Milestone 2)
PR-015  crates/sync-core transport layer
PR-016  packages/sync (SyncManager)
PR-017  Pairing protocol (Milestone 3)
PR-018  packages/sync-protocol (Phase 4 — per ADR-013 decision)
PR-019  packages/ui complete
PR-020  packages/import-export
PR-021  packages/hardware
PR-022  apps/demo full vertical slice + diagnostics (Milestone 5)
PR-023  Full test suite
PR-024  Release pipeline (Milestone 6)
```

Security and synchronisation contracts are established before feature-heavy application development.
