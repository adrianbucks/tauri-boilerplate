# Tauri Local-First Platform Boilerplate

A development-grade **GitHub Template Repository and platform scaffold** for building cross-platform (Windows & Android), local-first business applications using **Tauri 2**, **React**, **TypeScript**, **SQLite**, **Drizzle ORM**, and **iroh** peer-to-peer data synchronisation.

The repository is not yet production-ready. The architecture and platform slices are being built incrementally; durable native persistence, secure identity storage, real P2P replication, complete native command governance, signing, and other production gates remain tracked in the [implementation status](docs/verification/status.md).

---

## Current capabilities

- **Monorepo platform scaffold**: pnpm 10 workspaces + Turborepo + Cargo workspace covering 13 packages, 3 apps, and 4 native crates.
- **Durable native SQLite**: File-backed `rusqlite` persistence with WAL mode, foreign keys, and typed native gateway (`crates/native-core`, `@platform/database`).
- **Cryptographic device identity**: Native Ed25519 `DeviceKeyProvider` with protected seed custody in native memory; private keys never enter JavaScript.
- **Authentication & session trust**: Argon2id verification with 5-failure lockout cooldown window, issuing native-authenticated `TrustedOperationContext`.
- **RBAC & tenant isolation**: Central `requireTrusted()` permission engine with mandatory `organisationId` scope and cross-tenant mutation rejection.
- **Deterministic sync & live iroh P2P**: Canonical envelopes, mutual authenticated handshake, durable outbox/inbox queues, soft-delete tombstones, and live `iroh 1.2.0` QUIC transport.
- **Durable background task queue**: SQLite-backed task worker with jittered exponential backoff and `OutboxSyncWorker`.
- **Downstream adoption verified**: Secondary independent consumer application (`apps/minimal-consumer`) proves platform domain neutrality (Gate G-12 passed).

## Target platform capabilities (Open Gates)

- **Native OS background adapters** (WP-016): Android WorkManager and Windows Task Scheduler / system tray integration.
- **Signed release artifacts** (WP-018): Authenticode signing for Windows installers and release keystore signing for Android APKs.

---

## Repository Structure

```text
tauri-boilerplate/
├── apps/
│   ├── demo/                     # Reference application (Widgets, Locations, Warehouses)
│   └── minimal-consumer/         # Independent consumer app (Field Notes - Gate G-12)
├── packages/                     # Core platform packages (TypeScript)
│   ├── core/                     # Errors, logging, correlation IDs, config
│   ├── database/                 # NativeDatabaseConnection, Drizzle schema, BaseRepository
│   ├── identity/                 # User session service and device identity types
│   ├── authorization/            # Scoped RBAC engine (can / requireTrusted)
│   ├── audit/                    # Append-only audit logging (core_audit_events)
│   ├── sync/                     # OutboxService, InboxService, ConflictEngine, IrohSyncTransport
│   ├── sync-protocol/            # CanonicalSyncEnvelope, HLC timestamps, HandshakeProtocol
│   ├── tasks/                    # TaskQueueService, TaskWorker, OutboxSyncWorker, BackoffPolicy
│   ├── feature-system/           # Feature manifests & topological dependency resolution
│   ├── ui/                       # shadcn/ui components, AppShell, DataTable, theme tokens
│   ├── import-export/            # SheetJS CSV/XLSX import & export engines
│   ├── hardware/                 # Keyboard-wedge scanner abstraction
│   └── platform/                 # Bootstrap, migration runner, and platform assembly
├── crates/                       # Native Rust crates
│   ├── native-core/              # DurableDatabase, rusqlite WAL, SQL safety guard, Tauri IPC
│   ├── identity-core/            # Genuine Ed25519 DeviceKeyProvider, protected keyfile custody
│   ├── sync-core/                # IrohSyncEndpoint (iroh 1.2.0 QUIC over UDP, ALPN handler)
│   └── crypto-core/              # Cryptographic verification and canonical signing helpers
├── features/                     # Reusable platform features
│   ├── identity-admin/           # User, device, role, and sync-group admin UI
│   ├── organisations/            # Organization management & membership lifecycle
│   └── example-feature/          # Reference feature implementation (Widgets)
├── docs/                         # Canonical refactored documentation suite
│   ├── 01-overview/              # Project overview, tech stack, repository tour
│   ├── 02-architecture/          # System architecture, principles, persistence, sync, security
│   ├── 03-decisions/             # ADR index and 20 Architecture Decision Records
│   ├── 04-guides/                # Getting started, developer guide, agent guide, feature guide
│   ├── 05-reference/             # API contracts, sync protocol, capability matrix, error taxonomy
│   ├── 06-status/                # Evidence-backed current state, roadmap, work packages, gates
│   └── 07-in-development/        # Active development tracking, open gates, research register
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

Documentation is organized under [`docs/`](./docs/README.md):

1. **[Documentation Hub](./docs/README.md)** — Start here for overview and directory navigation.
2. **[Overview](./docs/01-overview/README.md)** — Project overview, technology baseline, and repository tour.
3. **[Architecture](./docs/02-architecture/README.md)** — Deep technical design across all subsystems (persistence, sync, security, tasks, etc.).
4. **[Decisions (ADRs)](./docs/03-decisions/README.md)** — Architecture Decision Records index and 20 canonical decisions.
5. **[Guides](./docs/04-guides/README.md)** — Getting started, developer workflows, AI agent guidelines, and downstream adoption.
6. **[Reference](./docs/05-reference/README.md)** — API contracts, sync protocol, capability matrix, and dependency graphs.
7. **[Status](./docs/06-status/README.md)** — Evidence-backed current state, roadmap, work packages (WP-001–WP-020), and acceptance gates.
8. **[In-Development](./docs/07-in-development/README.md)** — Active development tracking, open gates (WP-016, WP-018), and research register.

---

## License

MIT
