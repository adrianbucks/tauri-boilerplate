# 02 — Repository Structure

---

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
│   ├── database/                 ← SQLite connection, Drizzle, migrations, repositories
│   ├── identity/                 ← DeviceIdentity, UserIdentity, Session interfaces
│   ├── authorization/            ← RBAC engine: can(), require(), permission registry
│   ├── audit/                    ← Append-only audit event service
│   ├── sync/                     ← SyncManager, SyncGroupService, sync state machine
│   ├── sync-protocol/            ← SyncOperation model, HLC, namespaces, versioning
│   ├── feature-system/           ← FeatureManifest, FeatureRegistry, dependency resolver
│   ├── ui/                       ← shadcn/ui components, AppShell, DataTable, design tokens
│   ├── import-export/            ← Import engine, SheetJS integration, file-picker bridge
│   ├── hardware/                 ← BarcodeScanner + Camera interfaces + implementations
│   └── platform/                 ← Platform bootstrap (wires all packages together)
│
├── features/                     ← Reusable platform-level feature packages
│   ├── identity-admin/           ← Admin UI: users, devices, organisations, sync groups
│   ├── organisations/            ← Organisation model, membership state machine
│   └── example-feature/          ← Minimal template — copy this to start a new feature
│
├── crates/                       ← Rust library crates (shared across apps)
│   ├── native-core/              ← Tauri command helpers, error serialisation
│   ├── identity-core/            ← Device keypair generation, secure storage abstraction
│   ├── sync-core/                ← iroh node, iroh-docs adapter or custom operation log
│   └── crypto-core/              ← Signing, verification, HLC implementation
│
├── src-tauri/                    ← Shared Rust workspace configuration
│   └── Cargo.toml                ← (member crates declared here)
│
├── tooling/
│   ├── feature-validator/        ← Build-time: manifest + dependency validation
│   └── schema-validator/         ← Drizzle schema linting rules
│
├── docs/
│   ├── architecture/             ← Architecture diagrams, system overview
│   ├── decisions/                ← ADR-001 through ADR-020+
│   ├── protocols/                ← Sync protocol spec, pairing protocol spec
│   ├── security/                 ← Security model, threat model, revocation design
│   └── development/              ← Getting started guide, dev environment setup
│
├── tests/
│   ├── integration/              ← Cross-package integration tests
│   ├── sync/                     ← Multi-device sync harness
│   ├── security/                 ← Authorisation/revocation regression suite
│   └── e2e/                      ← End-to-end Tauri application tests
│
├── dist/                         ← Build output (gitignored)
│   ├── windows/                  ← Windows installer (.msi, .exe, .nsis)
│   └── android/                  ← Android APK / AAB
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                ← Lint, typecheck, test
│   │   ├── build-windows.yml     ← Windows installer build
│   │   ├── build-android.yml     ← Android APK build
│   │   └── release.yml           ← Full release pipeline (triggered by version tags)
│   └── PULL_REQUEST_TEMPLATE.md
│
├── docs/                         ← This documentation set (architecture, development, security, protocols, decisions)
│   ├── README.md                     ← Documentation hub & master table of contents
│   ├── architecture/                 ← 10 subsystem architecture specifications
│   ├── development/                  ← 6 engineering & agent guideline documents
│   ├── security/                     ← Security model & governance
│   ├── protocols/                    ← 7-layer handshake & sync wire format specs
│   └── decisions/                    ← 16 Architecture Decision Records (ADR-001–ADR-020)
│
├── AGENTS.md                     ← AI agent rules (summary; full rules in doc 18)
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

`dist/` is always gitignored. Release artefacts are uploaded to GitHub Releases by the CI pipeline.

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
