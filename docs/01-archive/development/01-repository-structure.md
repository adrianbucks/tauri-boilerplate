# 02 — Repository Structure

**Current vs target:** The layout below is the intended monorepo contract. Annotations mark where the live tree differs (no root `src-tauri/`, no `schema-validator` yet, no `tests/e2e` yet, workflows are `ci.yml` / `build.yml` / `release.yml`). Completeness of each package is in [verification/status.md](../verification/status.md).

## Separation philosophy

The most important structural rule is the **hard boundary between boilerplate and implementation**.

```
boilerplate zone           │  implementation zone
(managed by this repo)     │  (added by downstream developer)
───────────────────────────┼──────────────────────────────────
packages/                  │  features/<domain-a>/
crates/                    │  features/<domain-b>/
features/identity-admin/   │  apps/<their-app>/
features/organisations/    │
features/example-feature/  │
tooling/                   │
src-tauri/                 │
```

A downstream developer should **never need to add or edit files inside `packages/` or `crates/`** to implement their business logic. If they feel they need to, either:

- They are doing something that belongs in a `features/` package, or
- The boilerplate is missing a platform capability and they should open an upstream PR

---

## Full directory layout

```
tauri-boilerplate/
│
├── apps/
│   └── demo/                     ← Showcase application (Locations & Warehouses)
│       ├── src/                  ← React entry point + app-level routing
│       ├── src-tauri/            ← Tauri app manifest + Rust main.rs
│       ├── index.html
│       ├── vite.config.ts
│       ├── tsconfig.json
│       └── package.json
│
├── packages/                     ← TypeScript platform packages
│   ├── core/                     ← Errors, logging, config, correlation IDs, utilities
│   ├── database/                 ← Connection abstraction, sql.js adapter, migrations, repositories
│   ├── identity/                 ← Device and session types (native crypto is still a placeholder)
│   ├── authorization/            ← RBAC engine: can(), require(), permission registry
│   ├── audit/                    ← Append-only audit event service
│   ├── sync/                     ← SyncManager, pairing, sync state machine (no real transport)
│   ├── sync-protocol/            ← SyncOperation model, HLC, namespaces, versioning
│   ├── feature-system/           ← FeatureManifest, FeatureRegistry, dependency resolver
│   ├── ui/                       ← Current primitives, AppShell, DataTable
│   ├── import-export/            ← Import/export engines (no native file-picker yet)
│   ├── hardware/                 ← Keyboard-wedge scanner (camera plugin is future work)
│   └── platform/                 ← Platform bootstrap (wires all packages together)
│
├── features/                     ← Reusable platform-level feature packages
│   ├── identity-admin/           ← Admin services: users, devices, organisations, sync groups
│   ├── organisations/            ← Organisation model, membership state machine
│   └── example-feature/          ← Minimal template — copy this to start a new feature
│
├── crates/                       ← Rust library crates (shared across apps)
│   ├── native-core/              ← Tauri command helpers, error serialisation
│   ├── identity-core/            ← Placeholder device identifiers (secure storage is future work)
│   ├── sync-core/                ← Transport types; iroh node is not implemented
│   └── crypto-core/              ← HLC helpers (production signing is future work)
│
├── apps/demo/src-tauri/          ← Demo Tauri app (there is no root src-tauri/)
│
├── tooling/
│   ├── feature-validator/        ← Manifest + dependency validation
│   └── schema-validator/         ← Target: Drizzle schema linting (not present)
│
├── docs/
│   ├── README.md                 ← Documentation hub
│   ├── architecture/             ← Target architecture plus current-status notes
│   ├── specifications/           ← S-01–S-12 implementation contracts
│   ├── verification/             ← Evidence-backed implementation status
│   ├── research/                 ← Open technology spikes
│   ├── development/              ← Developer guides and agent rules
│   ├── security/                 ← Security model and command contracts
│   ├── protocols/                ← Target handshake and sync wire format
│   ├── decisions/                ← ADRs
│   └── roadmap/                  ← Historical plans (not implementation proof)
│
├── tests/
│   ├── integration/              ← Cross-package integration tests
│   ├── sync/                     ← In-process sync harness (not multi-device P2P)
│   ├── security/                 ← RBAC and sync-authorization regressions
│   └── e2e/                      ← Target: end-to-end Tauri tests (not present)
│
├── dist/                         ← Build output (gitignored)
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                ← Lint, typecheck, test
│   │   ├── build.yml             ← Native package build
│   │   └── release.yml           ← Tag-triggered release workflow (unsigned)
│   └── PULL_REQUEST_TEMPLATE.md
│
├── AGENTS.md                     ← AI agent rules (summary; full rules in development/06)
├── ARCHITECTURE.md               ← Platform architecture one-pager
├── CHANGELOG.md                  ← Keep a Changelog format, semver
├── CONTRIBUTING.md               ← How to contribute upstream improvements
├── README.md                     ← "How to use this boilerplate" for downstream devs
│
├── package.json                  ← Root workspace package.json
├── pnpm-workspace.yaml           ← pnpm workspace definition
├── turbo.json                    ← Turborepo pipeline configuration
└── Cargo.toml                    ← Rust workspace root
```

---

## Output directories

### `dist/` — build artefacts (gitignored)

```
dist/
├── windows/
│   ├── tauri-boilerplate-demo_X.Y.Z_x64.msi
│   ├── tauri-boilerplate-demo_X.Y.Z_x64-setup.exe    ← NSIS installer
│   ├── tauri-boilerplate-demo_X.Y.Z_x64.msi.sig      ← updater signature
│   └── latest.json                                     ← updater manifest
│
└── android/
    ├── app-release.apk
    ├── app-release.aab                                 ← Play Store bundle (optional)
    └── checksums.sha256
```

`dist/` is gitignored. Local native builds currently land under `apps/demo/src-tauri/target/`. Signed updater files (`.sig`, `latest.json`) are a target of [S-12](../specifications/S-12-release-and-distribution.md), not current CI output.

### Intermediate build output

| Path                          | Content                      | Gitignored |
| ----------------------------- | ---------------------------- | ---------- |
| `apps/demo/dist/`             | Vite frontend build          | ✅         |
| `apps/demo/src-tauri/target/` | Rust build artefacts         | ✅         |
| `packages/*/dist/`            | Compiled TypeScript packages | ✅         |
| `.turbo/`                     | Turborepo cache              | ✅         |
| `node_modules/`               | npm dependencies             | ✅         |

---

## `packages/` internal layout convention

Every package inside `packages/` follows the same layout:

```
packages/<name>/
├── src/
│   ├── index.ts               ← Public API barrel export
│   ├── <topic>/
│   │   ├── <Service>.ts
│   │   ├── <types>.ts
│   │   └── <Service>.test.ts  ← Co-located unit tests
│   └── internal/              ← Not exported from index.ts
├── package.json
└── tsconfig.json
```

**Rules**:

- Only symbols exported from `src/index.ts` are part of the public API
- `internal/` modules must never be imported from outside the package
- Every package has its own `package.json` with `"name": "@platform/<name>"`

---

## `features/` internal layout convention

Every feature follows this structure:

```
features/<name>/
├── src/
│   ├── index.ts               ← Feature manifest export
│   ├── manifest.ts            ← FeatureManifest definition
│   ├── schema/                ← Drizzle table definitions
│   ├── migrations/            ← Feature-specific migration files
│   ├── repositories/          ← Data access layer
│   ├── services/              ← Business logic
│   ├── pages/                 ← React page components
│   ├── components/            ← React UI components
│   └── permissions.ts         ← Permission definitions
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
│   ├── routes/                ← Route definitions
│   └── bootstrap/             ← Platform initialisation sequence
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   └── lib.rs
│   ├── icons/                 ← Application icons (all required sizes)
│   ├── capabilities/          ← Tauri capability files (narrowly scoped)
│   ├── tauri.conf.json        ← Tauri application manifest
│   └── Cargo.toml
├── public/                    ← Static assets
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## Rust workspace layout

```
Cargo.toml (workspace root)
    members:
        crates/native-core
        crates/identity-core
        crates/sync-core
        crates/crypto-core
        apps/demo/src-tauri      ← the Tauri application crate
```

Tauri application crates and reusable library crates have different packaging requirements. Application crates reference library crates as path dependencies. Library crates must compile independently without Tauri-specific APIs.

---

## pnpm workspace definition

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
  - "features/*"
  - "tooling/*"
  - "tests/*"
```

Downstream developers add their own entries:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "features/*"
  - "tooling/*"
  - "tests/*"
```

They do not need to modify any other configuration.

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
```

### File naming

| Type            | Convention                    | Example                 |
| --------------- | ----------------------------- | ----------------------- |
| React component | PascalCase                    | `DataTable.tsx`         |
| React page      | PascalCase + Page suffix      | `InventoryListPage.tsx` |
| Service         | camelCase + Service suffix    | `syncGroupService.ts`   |
| Repository      | camelCase + Repository suffix | `userRepository.ts`     |
| Types file      | camelCase + types suffix      | `sync.types.ts`         |
| Rust module     | snake_case                    | `sync_core.rs`          |

---

## Gitignore strategy

The root `.gitignore` covers:

```gitignore
# Build output
dist/
apps/*/dist/
apps/*/src-tauri/target/
packages/*/dist/

# Dependencies
node_modules/
.pnpm-store/

# Turborepo
.turbo/

# Environment
.env
.env.local
.env.*.local

# Keys and secrets — NEVER commit these
*.key
*.pem
*.p12
*.pfx
*.sig
*.keystore

# OS
.DS_Store
Thumbs.db
```

**Signing keys must never be committed.** They are stored in GitHub Actions Secrets and OS-level secure storage on developer machines.
