# 03 — Technology Baseline

Committed choices below are the platform direction. Several are **not yet on the production path**: SQLite is abstracted but the demo uses `sql.js`; iroh is the chosen transport but is not a crate dependency; signing and updater tooling are not configured.

## Confirmed technology decisions

These are committed choices that should not be revisited without an ADR.

| Layer                | Technology                           | Version target                                                | Reference                                  |
| -------------------- | ------------------------------------ | ------------------------------------------------------------- | ------------------------------------------ |
| Desktop/mobile shell | Tauri 2                              | Latest stable                                                 | https://v2.tauri.app/                      |
| Frontend             | React 18 + TypeScript                | TS strict mode                                                | —                                          |
| Build tool           | Vite                                 | Latest stable                                                 | —                                          |
| Styling              | Tailwind CSS v4 + shadcn/ui          | CSS-first configuration, theme CSS variables, light/dark mode | https://github.com/shadcn-ui/ui            |
| Data grid            | TanStack Table v8                    | v8                                                            | https://github.com/TanStack/table          |
| Local database       | SQLite                               | Target: native file; current demo/test path is `sql.js`       | —                                          |
| ORM / query builder  | Drizzle ORM                          | Latest stable                                                 | https://orm.drizzle.team/                  |
| Migration tooling    | drizzle-kit                          | Latest stable                                                 | https://orm.drizzle.team/docs/migrations   |
| P2P transport        | iroh                                 | Target; not wired in `crates/sync-core` yet                   | https://github.com/n0-computer/iroh        |
| Monorepo tooling     | pnpm + Turborepo                     | Latest stable                                                 | https://github.com/vercel/turborepo        |
| CI/CD                | GitHub Actions                       | —                                                             | —                                          |
| Release automation   | tauri-action                         | Latest                                                        | https://github.com/tauri-apps/tauri-action |
| Windows distribution | MSI + NSIS                           | via tauri-action                                              | —                                          |
| Android distribution | APK (+ optional AAB)                 | via tauri-action                                              | —                                          |
| Code quality         | ESLint + Prettier + Rustfmt + Clippy | Latest stable                                                 | —                                          |

---

## Research-required (still open)

These technologies remain **candidate production bindings** until the listed research items produce a spike and ADR. Platform packages may exist as abstractions; do not treat that as the binding decision being closed.

### Critical path (blocks production persistence, identity, and sync)

| Technology                                    | Research question                                                                                                                                               | ADR              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `tauri-plugin-sql` vs Rust/sqlx direct        | Which Drizzle integration path is safe and supported?                                                                                                           | ADR-003, ADR-004 |
| iroh-docs                                     | Can it replace a custom operation log? See [R-06](../research/R-06-iroh-transport-and-iroh-docs.md) and [ADR-013](../decisions/ADR-013-iroh-docs-evaluation.md) | ADR-013          |
| Stronghold / Windows DPAPI / Android Keystore | Which secure storage path works correctly on both platforms?                                                                                                    | ADR-019          |

### Medium priority (block Phase 4–5)

| Technology               | Research question                                                      | ADR     |
| ------------------------ | ---------------------------------------------------------------------- | ------- |
| TanStack Virtual         | Performance on 100k+ rows in a Tauri webview?                          | ADR-016 |
| react-spreadsheet-import | Does it introduce Chakra UI or other conflicting dependencies?         | ADR-017 |
| SheetJS CE               | Performance on 10k–250k row warehouse files on Windows and Android?    | ADR-017 |
| iroh-gossip              | Is it needed for notifications / presence, or is iroh-docs sufficient? | ADR-012 |
| Automerge                | Is it needed for collaborative entity types, or is LWW sufficient?     | ADR-014 |
| cr-sqlite                | Future alternative to custom op log — evaluate but do not depend on    | ADR-013 |

---

## Dependency policy

Before adding any dependency, a developer or AI agent must be able to answer all of the following:

| Question                | Required answer                                             |
| ----------------------- | ----------------------------------------------------------- |
| Purpose                 | Specific, one-sentence description of what this solves      |
| License                 | SPDX identifier; must be compatible with project licensing  |
| Maintenance             | Confirmed active (commits in last 6 months, issues triaged) |
| Bundle size impact      | Measured, acceptable                                        |
| Android compatibility   | Confirmed or explicitly not required                        |
| Windows compatibility   | Confirmed                                                   |
| Rust/JS boundary impact | Assessed if the dep spans both                              |
| Security implications   | Assessed; supply chain risk considered                      |
| Alternatives considered | At least one alternative evaluated                          |

**Rule**: Do not add a package to solve a problem solvable in fewer than ~30 lines of well-tested platform code.

All dependencies are recorded in `docs/decisions/` either as part of an ADR or a dedicated dependency review entry.

---

## Tauri plugin policy

Tauri plugins are native OS integrations. Before adding a Tauri plugin:

1. Confirm it is in the official plugins workspace: https://github.com/tauri-apps/plugins-workspace
2. Check its current maintenance status
3. Evaluate its capability model (what it exposes to the webview)
4. Verify it works on both Windows and Android (some plugins are desktop-only)
5. Document the capability grants required — all grants must be narrowly scoped

Known plugins to evaluate:

| Plugin                         | Purpose                       | Status                                        |
| ------------------------------ | ----------------------------- | --------------------------------------------- |
| `tauri-plugin-sql`             | SQLite access from TypeScript | Research required — may conflict with Drizzle |
| `tauri-plugin-stronghold`      | Secure key storage            | Research required                             |
| `tauri-plugin-fs`              | Filesystem access             | Confirmed candidate                           |
| `tauri-plugin-dialog`          | Native file picker            | Confirmed candidate                           |
| `tauri-plugin-barcode-scanner` | Android barcode scanning      | Research required — test on physical device   |
| `tauri-plugin-updater`         | Auto-update support           | Confirmed candidate                           |

---

## Language and runtime versions

| Runtime     | Minimum version        | Notes                                       |
| ----------- | ---------------------- | ------------------------------------------- |
| Node.js     | LTS (20+)              | Use `.nvmrc` or `engines` in `package.json` |
| pnpm        | 9+                     | Enforce via `packageManager` field          |
| Rust        | Stable, latest         | Use `rust-toolchain.toml` to pin            |
| Android NDK | As required by Tauri 2 | Tauri docs are authoritative                |
| Java/Kotlin | As required by Tauri 2 | Tauri docs are authoritative                |

---

## Frontend framework constraints

### Tailwind CSS

The project uses Tailwind CSS v4 + shadcn/ui. Modern CSS-first Tailwind engine with CSS variables and dark/light mode support.

### TypeScript strict mode

All TypeScript must compile with:

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true
}
```

No `any` in platform code unless:

- A third-party integration makes it unavoidable, **and**
- The type is explicitly documented with a comment explaining why

### No magic imports

All cross-package imports must use the `@platform/` or `@features/` package names, never relative `../../packages/` paths from feature code.

---

## Identifier strategy

**RESEARCH REQUIRED** — Choose before finalising the database schema.

Candidates:

| Strategy | Pros                          | Cons                               |
| -------- | ----------------------------- | ---------------------------------- |
| UUIDv4   | Universal, well-supported     | Not sortable, index fragmentation  |
| UUIDv7   | Sortable, time-ordered        | Newer spec, library support varies |
| ULID     | Sortable, URL-safe, monotonic | Different libraries across Rust/TS |
| NanoID   | Compact, fast                 | Not time-ordered                   |

This decision affects: database indexing efficiency, sync operation ordering, log readability, URL design.

Document the choice in ADR-021 (or as an addendum to ADR-003).

---

## Structured logging strategy

`packages/core` currently provides a TypeScript `Logger` with levels, correlation IDs, and key redaction. A matching Rust `tracing` (or equivalent) pipeline and a logging ADR are still required.

Requirements for the production design:

- Consistent structured format across Rust and TypeScript layers
- Levels: trace / debug / info / warn / error
- Fields: timestamp, deviceId, applicationId, feature, operation, correlationId
- Must never log: private keys, credentials, sensitive personal data, authentication secrets, full confidential records
- Android-compatible (no file system writes that require special permissions)
- Developer-readable in development; machine-parseable in production

Candidates to evaluate: `tracing` (Rust), `log` (Rust), structured console JSON (TypeScript), OpenTelemetry.

Document the choice in ADR-014 addendum or a dedicated ADR.
