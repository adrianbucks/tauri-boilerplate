# Technology Stack

## Current versions (pinned)

| Technology      | Version                             | Role                                                |
| --------------- | ----------------------------------- | --------------------------------------------------- |
| **Tauri**       | `@tauri-apps/cli` 2.11.4            | Native desktop/mobile shell                         |
| **React**       | 19                                  | Frontend framework                                  |
| **TypeScript**  | Latest stable                       | Frontend language                                   |
| **Vite**        | 6                                   | Frontend build tool                                 |
| **pnpm**        | 10.26.0                             | Package manager                                     |
| **Turborepo**   | 2.4.4                               | Monorepo task orchestration                         |
| **Drizzle ORM** | 0.39.3                              | TypeScript schema definitions and ORM abstractions  |
| **sql.js**      | Latest                              | In-memory database adapter (tests and web dev only) |
| **Rust**        | Edition 2021, repo-pinned toolchain | Native backend                                      |
| **rusqlite**    | Latest                              | Rust SQLite bindings (native persistence)           |
| **iroh**        | 1.2.0                               | P2P QUIC transport (production sync)                |
| **Vitest**      | 3                                   | TypeScript unit and integration tests               |
| **Node.js**     | 24 LTS                              | CI runtime                                          |

The exact Rust toolchain version is pinned in [`rust-toolchain.toml`](../../rust-toolchain.toml).

---

## Technology decisions explained

All major technology choices are documented as Architecture Decision Records (ADRs) in [`03-decisions/`](../03-decisions/). Key decisions:

| Decision                   | ADR                                                       | Summary                                                  |
| -------------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| Monorepo + pnpm/Turborepo  | [ADR-001](../03-decisions/ADR-001-monorepo-structure.md)  | Shared packages across apps; unified CI                  |
| Tauri 2 (not Electron)     | [ADR-002](../03-decisions/ADR-002-tauri-architecture.md)  | Smaller binary, native OS security, multi-platform       |
| Native SQLite via rusqlite | [ADR-003](../03-decisions/ADR-003-native-sqlite.md)       | Durable file-backed storage with WAL and foreign keys    |
| Drizzle ORM                | [ADR-004](../03-decisions/ADR-004-drizzle-integration.md) | TypeScript schema types without ORM abstraction overhead |
| React 19 + shadcn/ui       | [ADR-005](../03-decisions/ADR-005-ui-and-styling.md)      | Composable, accessible, customisable components          |
| iroh for P2P transport     | [ADR-012](../03-decisions/ADR-012-iroh-transport.md)      | Signed operation logs over direct iroh QUIC streams      |

---

## Why these choices?

### Tauri 2 over Electron

- **Binary size**: Tauri produces ~5 MB installers vs. Electron's ~80 MB.
- **OS security model**: Tauri's capability system enforces narrowly scoped native access.
- **Multi-platform**: Single Rust backend targets Windows + Android without separate wrappers.
- **Webview reuse**: Uses the OS WebView (Edge WebView2 on Windows, WebView on Android).

### rusqlite over sql.js

- **Durability**: File-backed SQLite survives process restarts. `sql.js` is in-memory only.
- **Performance**: Native Rust SQLite is significantly faster for large datasets.
- **WAL mode**: Native SQLite supports Write-Ahead Logging for concurrent reads.
- **Foreign keys**: Native enforcement via `PRAGMA foreign_keys = ON`.

> `sql.js` is retained as the test/development adapter only — the production path is always `rusqlite` via Tauri IPC.

### iroh for P2P transport

- **QUIC**: Encrypted, multiplexed streams over UDP with relay fallback for NAT traversal.
- **Endpoint model**: Single `iroh::Endpoint` per application; persistent node identity.
- **Operation logs**: Signed operation envelopes over direct streams (not iroh-docs key-value) to preserve tenant authorization, atomic outbox/inbox durability, and domain conflict semantics.

See [ADR-012](../03-decisions/ADR-012-iroh-transport.md) and the [research gate R-002](../07-in-development/research-register.md) for the full evaluation.

---

## Development tooling

| Tool       | Purpose                                                             |
| ---------- | ------------------------------------------------------------------- |
| `pnpm`     | Package installation and workspace script execution                 |
| `turbo`    | Parallel task execution with caching (`build`, `test`, `typecheck`) |
| `cargo`    | Rust compilation, testing, formatting, and linting                  |
| `prettier` | TypeScript/CSS code formatting                                      |
| `eslint`   | TypeScript linting                                                  |
| `clippy`   | Rust linting                                                        |
| `vitest`   | TypeScript test runner                                              |

### Key scripts

```bash
pnpm install            # Install all workspace dependencies
pnpm dev                # Start all dev servers
pnpm dev:web            # Vite dev server only (http://localhost:5173)
pnpm dev:tauri          # Native Tauri app in dev mode
pnpm build              # Build all packages + web frontend
pnpm build:tauri        # Build native installers
pnpm test               # Run all TypeScript tests
pnpm test:security      # RBAC + sync authorization regression tests
pnpm test:integration   # Cross-package integration tests
pnpm typecheck          # TypeScript type checking across all packages
pnpm lint               # ESLint across all packages
pnpm format             # Prettier formatting
cargo test --workspace  # All Rust tests
cargo clippy --workspace --all-targets -- -D warnings
```

---

## Dependency philosophy

- **Audit before adoption**: Every new dependency requires license verification, maintenance check, and an ADR or explicit justification comment.
- **Prefer writing over importing**: Simple utilities (HLC, UUID-like IDs, canonical serialisation) are written from scratch to reduce supply-chain risk.
- **Supply-chain security**: `pnpm audit` and `cargo audit` are integrated into CI (WP-018).
- **Lockfiles are committed**: Both `pnpm-lock.yaml` and `Cargo.lock` are committed to ensure reproducible builds.
