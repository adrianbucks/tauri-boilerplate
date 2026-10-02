# Dependency Map & Package Boundaries

This reference maps the dependency graph and architectural boundaries across all TypeScript packages, domain features, applications, and Rust native crates.

---

## 1. Monorepo Dependency Graph

```text
┌─────────────────────────────────────────────────────────────┐
│                      apps/demo                              │
│         (Tauri Application Shell + UI Bootstrap)            │
└───────┬─────────────────────────────────────────────┬───────┘
        │                                             │
        ▼                                             ▼
┌───────────────────────────────┐     ┌───────────────────────────────┐
│     features/*                │     │     @platform/ui              │
│     (Domain Modules)          │     │     (Shadcn / Tokens / Shell) │
└───────┬───────────────────────┘     └───────────────┬───────────────┘
        │                                             │
        └──────────────────────┬──────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   Platform Infrastructure                   │
│                                                             │
│   @platform/feature-system ──┐                              │
│   @platform/authorization  ──┼──> @platform/database        │
│   @platform/identity       ──┤         │                    │
│   @platform/audit          ──┤         ▼                    │
│   @platform/sync-protocol  ──┼──> @platform/core            │
│   @platform/sync           ──┤                              │
│   @platform/tasks          ──┤                              │
│   @platform/import-export  ──┤                              │
│   @platform/hardware       ──┘                              │
└──────────────────────────────┬──────────────────────────────┘
                               │ Tauri IPC Gateway
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   Native Rust Crates                        │
│                                                             │
│   crates/native-core   (Bundled SQLite, SQL safety, IPC)    │
│   crates/identity-core (Argon2id, Ed25519 key custody)      │
│   crates/crypto-core   (Cryptographic primitives)           │
│   crates/sync-core     (iroh QUIC transport & relay mesh)   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Package Manifest Matrix

| Package / Crate            | Scope    | Primary Responsibility                                  | Dependencies                                                               |
| :------------------------- | :------- | :------------------------------------------------------ | :------------------------------------------------------------------------- |
| `@platform/core`           | Monorepo | Correlation IDs, logging, PlatformError, time utilities | None                                                                       |
| `@platform/database`       | Monorepo | Drizzle ORM schema, SQLite connection, BaseRepository   | `@platform/core`, `drizzle-orm`                                            |
| `@platform/identity`       | Monorepo | Device and user authentication abstractions             | `@platform/core`, `@platform/database`                                     |
| `@platform/authorization`  | Monorepo | Scoped RBAC engine, permission checking                 | `@platform/core`, `@platform/identity`                                     |
| `@platform/audit`          | Monorepo | Append-only audit trail logging                         | `@platform/core`, `@platform/database`                                     |
| `@platform/sync-protocol`  | Monorepo | Canonical envelopes, HLC, serialization                 | `@platform/core`                                                           |
| `@platform/sync`           | Monorepo | Inbound inbox, conflict engine, sync manager            | `@platform/sync-protocol`, `@platform/database`, `@platform/authorization` |
| `@platform/tasks`          | Monorepo | Durable task queue, workers, outbox replication         | `@platform/core`, `@platform/database`, `@platform/sync`                   |
| `@platform/feature-system` | Monorepo | Manifest registration, dependency ordering              | `@platform/core`                                                           |
| `@platform/import-export`  | Monorepo | SheetJS streaming file import and CSV export            | `@platform/core`, `@platform/database`                                     |
| `@platform/hardware`       | Monorepo | Keyboard-wedge scanner, hardware interfaces             | `@platform/core`                                                           |
| `@platform/ui`             | Monorepo | React components, AppShell, ThemeProvider               | React 19, Lucide, TailwindMerge                                            |
| `crates/native-core`       | Rust     | SQLite WAL connection, SQL safety guard, IPC commands   | `rusqlite`, `serde`, `tauri`                                               |
| `crates/identity-core`     | Rust     | Ed25519 keypair generation, Argon2id hashing            | `ed25519-dalek`, `argon2`                                                  |
| `crates/crypto-core`       | Rust     | Hash chaining, message signing                          | `sha2`, `ed25519-dalek`                                                    |
| `crates/sync-core`         | Rust     | iroh QUIC endpoint, ALPN handler, DERP relays           | `iroh`, `tokio`, `quinn`                                                   |

---

## 3. Boundary Rules & Invariants

1. **No Circular Dependencies**: Circular dependencies between packages or crates are strictly prohibited and enforced by Turborepo and Cargo.
2. **Platform Packages Never Depend on Features**: `@platform/*` packages must remain domain-neutral.
3. **Downward-Only Flow**: Dependencies must point downward toward mechanism, never upward toward concrete application behavior.
