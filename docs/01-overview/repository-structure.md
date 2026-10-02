# Repository Structure

## Separation philosophy

The most important structural rule is the **hard boundary between boilerplate and implementation**.

```
boilerplate zone               │  implementation zone
(managed by this repo)         │  (added by downstream developer)
───────────────────────────────┼───────────────────────────────────────
packages/                      │  features/<your-domain>/
crates/                        │  apps/<your-app>/
features/identity-admin/       │
features/organisations/        │
features/example-feature/      │
tooling/                       │
```

A downstream developer should **never need to add or edit files inside `packages/` or `crates/`** to implement their business logic. If they feel they need to, either:

- They are doing something that belongs in a `features/` package, or
- The boilerplate is missing a platform capability and they should open an upstream PR.

---

## Full directory layout

```
tauri-boilerplate/
│
├── apps/
│   ├── demo/                       ← Showcase application (Locations & Widgets domain)
│   │   ├── src/                    ← React entry point + app-level routing
│   │   ├── src-tauri/              ← Tauri app manifest + Rust lib.rs
│   │   │   ├── src/lib.rs          ← Native Tauri commands (db_*, sync_*, auth_*)
│   │   │   ├── capabilities/       ← Tauri capability files (narrowly scoped)
│   │   │   └── Cargo.toml
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── minimal-consumer/           ← Second consumer app proving platform domain-neutrality
│       ├── src/notes/              ← Field Notes domain (independent of apps/demo)
│       └── src-tauri/             ← Standalone Tauri crate (com.tauri.boilerplate.minimal-consumer)
│
├── packages/                       ← TypeScript platform packages (@platform/*)
│   ├── core/                       ← Errors, logging, config, correlation IDs, utilities
│   ├── database/                   ← Connection abstraction, NativeDatabaseConnection, migrations, repositories
│   ├── identity/                   ← Device and session types, UserSessionService, TrustedOperationContext
│   ├── authorization/              ← RBAC engine: can(), requireTrusted(), SyncGroupService
│   ├── audit/                      ← Append-only audit event service
│   ├── sync/                       ← OutboxService, InboxService, IrohSyncTransport, TombstoneService
│   ├── sync-protocol/              ← SyncEnvelope, HandshakeValidator, ConflictRegistry, HLC
│   ├── tasks/                      ← TaskQueueService, TaskWorker, OutboxSyncWorker, BackoffPolicy
│   ├── feature-system/             ← FeatureManifest, FeatureRegistry, dependency resolver
│   ├── ui/                         ← shadcn/ui components, AppShell, DataTable
│   ├── import-export/              ← SheetJS CSV/XLSX import and export engines
│   ├── hardware/                   ← Keyboard-wedge barcode scanner abstraction
│   └── platform/                   ← Platform bootstrap (wires all packages together)
│
├── features/                       ← Reusable platform-level feature packages
│   ├── identity-admin/             ← Admin: users, devices, roles, sync groups
│   ├── organisations/              ← Organisation management & membership lifecycle
│   └── example-feature/            ← Reference feature template (copy this to start)
│
├── crates/                         ← Rust library crates (shared across apps)
│   ├── native-core/                ← Tauri command helpers, DurableDatabase, error serialisation
│   ├── identity-core/              ← DeviceKeyProvider (Ed25519), protected key storage
│   ├── sync-core/                  ← IrohSyncEndpoint (iroh 1.2.0 QUIC), transport framing
│   └── crypto-core/               ← HLC implementation, canonical serialisation helpers
│
├── tests/
│   ├── integration/                ← Cross-package platform integration tests
│   ├── sync/                       ← In-process sync harness and conflict policy tests
│   └── security/                   ← RBAC, auth boundary, sync-authorization regressions
│
├── tooling/
│   └── feature-validator/         ← Feature manifest and dependency validation
│
├── docs/                           ← This documentation suite
│
├── .github/
│   └── workflows/
│       ├── ci.yml                  ← Lint, typecheck, test on every push
│       ├── build.yml               ← Native package builds
│       └── release.yml             ← Tag-triggered release workflow
│
├── AGENTS.md                       ← AI agent rules (pointer to 04-guides/agent-guide.md)
├── ARCHITECTURE.md                 ← One-page platform architecture overview
├── CHANGELOG.md                    ← Keep a Changelog format
├── CONTRIBUTING.md                 ← Contribution guidelines
├── README.md                       ← Getting started for downstream developers
├── package.json                    ← Root workspace package.json
├── pnpm-workspace.yaml             ← pnpm workspace definition
├── turbo.json                      ← Turborepo pipeline configuration
├── Cargo.toml                      ← Rust workspace root
└── rust-toolchain.toml             ← Pinned Rust toolchain version
```

---

## `packages/` internal layout convention

Every package inside `packages/` follows the same layout:

```
packages/<name>/
├── src/
│   ├── index.ts               ← Public API barrel export
│   ├── <topic>/
│   │   ├── <Service>.ts
│   │   ├── types.ts
│   │   └── <Service>.test.ts  ← Co-located unit tests
│   └── internal/              ← Not exported from index.ts
├── package.json
└── tsconfig.json
```

**Rules**:

- Only symbols exported from `src/index.ts` are part of the public API.
- `internal/` modules must never be imported from outside the package.
- Every package has its own `package.json` with `"name": "@platform/<name>"`.

---

## `features/` internal layout convention

Every feature follows this structure:

```
features/<name>/
├── src/
│   ├── index.ts               ← Feature manifest export
│   ├── manifest.ts            ← FeatureManifest definition
│   ├── schema/                ← Drizzle table definitions
│   ├── migrations/            ← Feature-specific .sql migration files
│   ├── repositories/          ← Data access layer (extends BaseRepository)
│   ├── services/              ← Business logic (uses authorization engine)
│   ├── pages/                 ← React page components
│   ├── components/            ← React UI components
│   └── permissions.ts         ← Permission name constants
├── tests/
│   ├── unit/
│   └── integration/
├── package.json
└── tsconfig.json
```

See `features/example-feature/` for a complete, documented reference implementation.

---

## `apps/demo/` layout

```
apps/demo/
├── src/
│   ├── main.tsx               ← React entry point
│   ├── App.tsx                ← Router setup, feature registration
│   ├── hooks/
│   │   └── usePlatform.tsx    ← Platform initialisation and context
│   └── routes/                ← Route definitions
├── src-tauri/
│   ├── src/
│   │   ├── main.rs            ← Tauri entry point
│   │   └── lib.rs             ← Native command handlers (db_*, sync_*, auth_*, etc.)
│   ├── capabilities/
│   │   └── default.json       ← Scoped least-privilege capability definitions
│   ├── tauri.conf.json        ← Tauri application manifest
│   └── Cargo.toml
├── public/                    ← Static assets
├── index.html
├── vite.config.ts
└── package.json
```

---

## Rust workspace layout

```
Cargo.toml (workspace root)
    members:
        crates/native-core          ← library crate
        crates/identity-core        ← library crate
        crates/sync-core            ← library crate
        crates/crypto-core          ← library crate
        apps/demo/src-tauri         ← Tauri application crate (demo-app-native)
        apps/minimal-consumer/src-tauri  ← Tauri application crate (minimal-consumer-native)
```

Tauri application crates reference library crates as path dependencies. Library crates must compile independently without Tauri-specific APIs.

---

## Naming conventions

### Package names

```
@platform/core
@platform/database
@platform/identity
@platform/authorization
@platform/audit
@platform/sync
@platform/sync-protocol
@platform/tasks
@platform/feature-system
@platform/ui
@platform/import-export
@platform/hardware
@platform/platform
```

### Feature names

```
@features/identity-admin
@features/organisations
@features/example-feature
```

### Rust crates

```
native-core
identity-core
sync-core
crypto-core
demo-app-native
minimal-consumer-native
```

### File naming conventions

| Type            | Convention                    | Example               |
| --------------- | ----------------------------- | --------------------- |
| React component | PascalCase                    | `DataTable.tsx`       |
| React page      | PascalCase + Page suffix      | `WidgetListPage.tsx`  |
| Service         | camelCase + Service suffix    | `syncGroupService.ts` |
| Repository      | camelCase + Repository suffix | `widgetRepository.ts` |
| Types file      | camelCase + .types suffix     | `sync.types.ts`       |
| Rust module     | snake_case                    | `sync_core.rs`        |

---

## Package dependency direction

Allowed import directions (lower → higher is forbidden):

```
core
  ↑
database / identity / authorization / audit / sync-protocol
  ↑
sync / import-export / hardware / feature-system / tasks
  ↑
platform
  ↑
features/*
  ↑
apps/*
```

**Forbidden imports:**

- `packages/database` importing from `features/*`
- `packages/core` importing from any other `packages/*`
- `features/*` importing from `apps/*`
- Any feature importing from another feature's `internal/` modules
- Any `packages/*` or `crates/*` containing domain-specific business logic (Invariant #10)
