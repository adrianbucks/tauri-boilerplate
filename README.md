# Tauri Local-First Platform Boilerplate

A production-grade **GitHub Template Repository** for building cross-platform (Windows & Android), local-first business applications using **Tauri 2**, **React**, **TypeScript**, **SQLite**, **Drizzle ORM**, and **iroh** peer-to-peer data synchronisation.

---

## Key Features

- **Local-First Architecture**: Immediate local database operations via SQLite; no blocking network calls during business operations.
- **P2P Synchronization**: Decentralized peer-to-peer data replication powered by iroh with no central server required.
- **7-Layer Pre-Sync Security Stack**: Peer verification, application handshake, organization isolation, device auth, sync group access, and data-scoped permissions before any sync occurs.
- **Modular Feature Architecture**: Domain business features are isolated inside `features/` with declarative manifests, migrations, and permission registries.
- **Cross-Platform**: Targets modern Windows (Windows 10/11) and modern Android (API 35+) from one unified codebase.
- **Production Build Pipeline**: Automated CI workflows producing signed Windows installers (`.msi`, NSIS `.exe`) and Android APKs (`.apk`).

---

## Repository Structure

```text
tauri-boilerplate/
├── apps/
│   └── demo/                     # Showcase application (Locations & Warehouses)
├── packages/                     # Core platform packages (TypeScript)
│   ├── core/                     # Errors, logging, correlation IDs, config
│   ├── database/                 # SQLite connection, Drizzle ORM, migrations
│   ├── identity/                 # Cryptographic device identity, session types
│   ├── authorization/            # Scoped RBAC engine (can / require)
│   ├── audit/                    # Append-only audit logging
│   ├── sync/                     # SyncManager & sync state machine
│   ├── sync-protocol/            # Sync operation formats, HLC timestamps, conflict policies
│   ├── feature-system/           # Feature manifests & dependency resolution
│   ├── ui/                       # shadcn/ui components, AppShell, DataTable
│   ├── import-export/            # Spreadsheet import/export & native file dialogs
│   ├── hardware/                 # Barcode scanner (keyboard wedge & Android plugin)
│   └── platform/                 # Bootstrap and package assembly
├── crates/                       # Rust library crates
│   ├── native-core/              # Tauri command bridges & error serialization
│   ├── identity-core/            # Secure key storage & keypair generation
│   ├── sync-core/                # iroh P2P transport & replication adapter
│   └── crypto-core/              # Signing, verification & HLC clock
├── features/                     # Reusable platform features
│   ├── identity-admin/           # User, device, role, and sync-group admin UI
│   ├── organisations/            # Organization management & membership lifecycle
│   └── example-feature/          # Reference feature implementation (template)
├── docs/                         # Comprehensive documentation suite & ADRs
│   ├── architecture/             # Subsystem design & architecture specifications
│   ├── development/              # Developer guides, testing & agent invariants
│   ├── security/                 # Threat model & capability governance
│   ├── protocols/                # P2P handshake & sync wire format
│   └── decisions/                # Architecture Decision Records (ADRs)
└── dist/                         # Generated installer and APK outputs
```

---

## Getting Started

### Prerequisites

- **Node.js**: `v20+` LTS
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

Compile the Rust binary in release mode and generate signed installers (`.msi`, NSIS `.exe` on Windows):

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
pnpm test:security      # 7-layer sync and RBAC security regression tests
pnpm test:sync          # P2P sync harness and conflict tests

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
| `pnpm build:tauri`      | Compiles the production Tauri desktop release installer (`.msi`, `.exe`)         |
| `pnpm preview`          | Previews the compiled production web bundle locally (`http://localhost:4173`)    |
| `pnpm tauri <cmd>`      | Executes Tauri CLI commands directly against `@apps/demo`                        |
| `pnpm test`             | Runs all unit test suites across all packages                                    |
| `pnpm test:security`    | Executes the 7-layer security and RBAC regression suite                          |
| `pnpm test:integration` | Runs full platform integration tests                                             |
| `pnpm test:sync`        | Runs P2P sync convergence tests                                                  |
| `pnpm typecheck`        | Validates TypeScript types across all workspace packages                         |
| `pnpm lint`             | Runs Turborepo linter across all packages                                        |
| `pnpm clean`            | Cleans build artifacts and `node_modules`                                        |
| `pnpm format`           | Formats all code with Prettier                                                   |

---

## Documentation

Full architectural documentation and implementation specifications are located in [`docs/`](./docs/README.md):

1. [Documentation Hub & Master Index](./docs/README.md)
2. [Architecture Overview & Principles](./docs/architecture/02-architecture-principles.md)
3. [Repository Structure & Boundary Rules](./docs/development/01-repository-structure.md)
4. [Database & Schema Specifications](./docs/architecture/03-database-and-schema.md)
5. [Build, Release and Versioning](./docs/development/05-build-release-and-versioning.md)
6. [Agent & Developer Guidelines (10 Critical Invariants)](./docs/development/06-agent-and-developer-guidelines.md)
7. [Architecture Decision Records (ADRs)](./docs/decisions/ADR-001-repository-and-monorepo.md)

---

## License

MIT
