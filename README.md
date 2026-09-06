# Tauri Local-First Platform Boilerplate

A development-grade **GitHub Template Repository and platform scaffold** for building cross-platform (Windows & Android), local-first business applications using **Tauri 2**, **React**, **TypeScript**, **SQLite**, **Drizzle ORM**, and **iroh** peer-to-peer data synchronisation.

The repository is not yet production-ready. The architecture and platform slices are being built incrementally; durable native persistence, secure identity storage, real P2P replication, complete native command governance, signing, and other production gates remain tracked in the [implementation status](docs/verification/status.md).

---

## Current capabilities

- **Monorepo platform scaffold**: TypeScript packages, Rust crates, feature registry, and a demo app that consumes public platform APIs.
- **Local data abstractions**: Repository and migration engines exist; the demo still uses an in-memory `sql.js` connection rather than durable native SQLite.
- **RBAC and session types**: Scoped `can()` / `require()` and in-memory sessions; trusted session context and cryptographic device identity are incomplete.
- **Feature manifests**: Registration, dependency ordering, permissions, and declared sync policies.
- **Native packaging**: Local unsigned Windows MSI/NSIS and Android APK builds; CI workflows exist. Signing is not configured.

## Target platform capabilities

These remain the product goals. They are not present as production behavior yet. See [implementation status](docs/verification/status.md).

- **Durable local-first SQLite** with native startup migrations.
- **P2P synchronization** over iroh, with a durable operation log and multi-device convergence.
- **Seven-layer pre-sync authorization** enforced on real transport, not only in-process simulations.
- **OS-backed private-key storage** with Ed25519 device identity that never crosses into TypeScript.
- **Signed Windows and Android release artifacts** with updater metadata and checksums.

---

## Repository Structure

```text
tauri-boilerplate/
├── apps/
│   └── demo/                     # Showcase application (Locations & Warehouses)
├── packages/                     # Core platform packages (TypeScript)
│   ├── core/                     # Errors, logging, correlation IDs, config
│   ├── database/                 # Connection abstraction, sql.js test adapter, migrations
│   ├── identity/                 # Device and session types (native identity is still a placeholder)
│   ├── authorization/            # Scoped RBAC engine (can / require)
│   ├── audit/                    # Append-only audit logging
│   ├── sync/                     # SyncManager & sync state machine
│   ├── sync-protocol/            # Sync operation formats, HLC timestamps, conflict policies
│   ├── feature-system/           # Feature manifests & dependency resolution
│   ├── ui/                       # shadcn/ui components, AppShell, DataTable
│   ├── import-export/            # SheetJS CSV/XLSX import and export engines
│   ├── hardware/                 # Keyboard-wedge scanner (camera/plugin path is future work)
│   └── platform/                 # Bootstrap and package assembly
├── crates/                       # Rust library crates
│   ├── native-core/              # Tauri command helpers and error serialization
│   ├── identity-core/            # Placeholder device identifiers (secure storage is future work)
│   ├── sync-core/                # Transport types; iroh node is not implemented
│   └── crypto-core/              # HLC helpers; production signing is future work
├── features/                     # Reusable platform features
│   ├── identity-admin/           # User, device, role, and sync-group admin UI
│   ├── organisations/            # Organization management & membership lifecycle
│   └── example-feature/          # Reference feature implementation (template)
├── docs/                         # Comprehensive documentation suite & ADRs
│   ├── architecture/             # Target architecture plus current-status notes
│   ├── specifications/           # S-01–S-12 implementation contracts
│   ├── verification/             # Evidence-backed implementation status
│   ├── research/                 # Open technology spikes
│   ├── development/              # Developer guides, testing & agent invariants
│   ├── security/                 # Threat model & capability governance
│   ├── protocols/                # Handshake & sync wire format (target)
│   └── decisions/                # Architecture Decision Records (ADRs)
└── dist/                         # Generated installer and APK outputs
```

---

## Getting Started

### Prerequisites

- **Node.js**: `v24+` LTS
- **pnpm**: `v9+` or `v10+` (`npm install -g pnpm`)
- **Rust & Cargo**: Latest stable Rust toolchain (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- **Tauri Prerequisites**: Follow official [Tauri 2 system dependencies guide](https://v2.tauri.app/start/prerequisites/) for Windows/Linux/macOS
- **Android SDK & NDK** _(optional)_: For Android compilation targeting API 35+

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/tauri-boilerplate.git
cd tauri-boilerplate

# Install all workspace dependencies
pnpm install
```

---

## Running the Application

### 1. Development Mode

#### Web Browser Development

Run the Vite development server with Hot Module Replacement (HMR) at `http://localhost:5173`:

```bash
# Run web dev server across workspace
pnpm dev

# Or directly target the demo application
pnpm dev:web
```

#### Native Desktop Application (Tauri 2)

Launch the desktop window with Rust backend compilation and web live-reloading:

```bash
# Launch the native desktop application in dev mode
pnpm dev:tauri
```

---

### 2. Production Builds

#### Web Production Bundle

Compile TypeScript packages and bundle the production web assets into `apps/demo/dist`:

```bash
# Build all workspace packages and the demo web bundle
pnpm build

# Or build specifically the web frontend
pnpm build:web
```

#### Preview Production Web Build

Locally preview the generated production web bundle at `http://localhost:4173`:

```bash
pnpm preview
```

#### Native Desktop Release Bundle (Windows / macOS / Linux)

Compile the Rust binary in release mode and generate unsigned installers (`.msi`, NSIS `.exe` on Windows). Production signing is not configured:

```bash
# Build the native desktop installer and binaries
pnpm build:tauri
```

The output installers and binaries are generated in `apps/demo/src-tauri/target/release/bundle/`.

#### Android Mobile Build

Generate release Android APK bundles:

```bash
pnpm tauri android build
```

---

## Quality Assurance & Testing

```bash
# Run all unit tests across the monorepo (Vitest)
pnpm test

# Run specific test suites
pnpm test:integration   # End-to-end platform workflows
pnpm test:security      # RBAC, pairing, and sync-authorization regression tests
pnpm test:sync          # In-process sync harness and conflict-policy tests

# Typecheck and lint across all packages
pnpm typecheck
pnpm lint

# Format code with Prettier
pnpm format
pnpm format:check
```

---

## Scripts Reference

| Command                 | Purpose                                                                          |
| ----------------------- | -------------------------------------------------------------------------------- |
| `pnpm dev`              | Starts development servers across the workspace with Turborepo                   |
| `pnpm dev:web`          | Launches the `@apps/demo` Vite web development server (`http://localhost:5173`)  |
| `pnpm dev:tauri`        | Compiles Rust backend and launches native Tauri desktop application in dev mode  |
| `pnpm build`            | Builds all packages and compiles the production web bundle into `apps/demo/dist` |
| `pnpm build:web`        | Builds the `@apps/demo` web application bundle                                   |
| `pnpm build:tauri`      | Compiles the unsigned Tauri desktop installer (`.msi`, `.exe`)                   |
| `pnpm preview`          | Previews the compiled production web bundle locally (`http://localhost:4173`)    |
| `pnpm tauri <cmd>`      | Executes Tauri CLI commands directly against `@apps/demo`                        |
| `pnpm test`             | Runs all unit test suites across all packages                                    |
| `pnpm test:security`    | Executes RBAC and sync-authorization regression tests                            |
| `pnpm test:integration` | Runs cross-package platform integration tests                                    |
| `pnpm test:sync`        | Runs the in-process sync harness                                                 |
| `pnpm typecheck`        | Validates TypeScript types across all workspace packages                         |
| `pnpm lint`             | Runs Turborepo linter across all packages                                        |
| `pnpm clean`            | Cleans build artifacts and `node_modules`                                        |
| `pnpm format`           | Formats all code with Prettier                                                   |

---

## Documentation

Documentation is in [`docs/`](./docs/README.md). Architecture pages keep target patterns; [implementation status](./docs/verification/status.md) is the evidence-backed current view.

1. [Documentation hub](./docs/README.md)
2. [Implementation status](./docs/verification/status.md)
3. [Development roadmap](./docs/development/roadmap.md)
4. [Architecture principles](./docs/architecture/02-architecture-principles.md)
5. [Repository structure](./docs/development/01-repository-structure.md)
6. [Agent and developer guidelines](./docs/development/06-agent-and-developer-guidelines.md)
7. [Architecture Decision Records](./docs/decisions/ADR-001-repository-and-monorepo.md)

---

## License

MIT
