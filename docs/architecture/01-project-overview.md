# 01 — Project Overview and Strategy

---

## Purpose

`tauri-boilerplate` is a production-ready, open-source **GitHub Template Repository** for building cross-platform, local-first business applications. It targets Windows and Android from a single codebase using:

- **Tauri 2** — native shell and OS integration
- **React + TypeScript + Vite** — frontend
- **SQLite + Drizzle ORM** — local-first data layer
- **iroh** — P2P networking and synchronisation

The boilerplate provides a complete, opinionated platform: identity, authorisation, data synchronisation, audit, import/export, hardware abstraction, and a full UI component set. Developers building business applications start here and add only their domain-specific features.

---

## What this repository is

| ✅ This repository IS                             | ❌ This repository is NOT                       |
| ------------------------------------------------- | ----------------------------------------------- |
| A GitHub Template Repository                      | A monorepo of production applications           |
| The authoritative platform implementation         | An npm-published library                        |
| A running demo application (`apps/demo`)          | A framework that generates application code     |
| A copy-paste starting point (`example-feature`)   | A collection of WMS / ERP / logistics apps      |
| The home of all platform packages and Rust crates | A one-size-fits-all solution for every use case |

---

## Distribution model — GitHub Template

Developers create a new project from this template:

```
GitHub → Use this template → Create new repository
    ↓
new-project/
    ├── apps/          ← replace apps/demo with apps/their-app
    ├── packages/      ← use unchanged, or PR improvements upstream
    ├── crates/        ← use unchanged, or PR improvements upstream
    ├── features/      ← add domain features here
    └── ...
```

**Platform improvements** (bugs fixed in `packages/`, `crates/`, tooling, security) should be PRed back to `tauri-boilerplate`. **Application specifics** (WMS routes, ERP schemas, domain business logic) stay permanently in the downstream repository.

There is no runtime dependency on this repository after the template is copied. Downstream projects are fully independent.

---

## Downstream consumption pattern

### What a downstream developer does

1. Fork or use as template
2. Replace `apps/demo` with `apps/<their-application>`
3. Copy `features/example-feature/` as a starting point for their first domain feature
4. Add domain features to `features/`
5. Leave `packages/` and `crates/` unchanged unless contributing back

### What they never need to do

- Add files inside `packages/` for domain logic
- Modify `crates/` for domain logic
- Change the `pnpm-workspace.yaml` structure (only add their new workspace paths)

### Structural contract

```
tauri-boilerplate provides:      │  Downstream adds:
─────────────────────────────────┼───────────────────────────────
packages/core                    │  apps/<their-app>/
packages/database                │  features/<domain-a>/
packages/identity                │  features/<domain-b>/
packages/authorization           │
packages/audit                   │  (optionally back-ports
packages/sync                    │   improvements to packages/
packages/sync-protocol           │   via upstream PR)
packages/feature-system          │
packages/ui                      │
packages/import-export           │
packages/hardware                │
packages/platform                │
crates/native-core               │
crates/identity-core             │
crates/sync-core                 │
crates/crypto-core               │
features/identity-admin          │
features/organisations           │
features/example-feature         │
apps/demo                        │
```

---

## Versioning and release strategy

The boilerplate itself uses **semantic versioning** following industry best practices.

### Platform versioning

```
MAJOR.MINOR.PATCH

MAJOR — breaking change to a platform package public API or Tauri command contract
MINOR — new platform capability added in a backwards-compatible way
PATCH — bug fix, security patch, documentation update
```

### Version dimensions (separate from each other)

| Version               | What it tracks                   | Stored in                   |
| --------------------- | -------------------------------- | --------------------------- |
| `platformVersion`     | The boilerplate release version  | `package.json` (root)       |
| `applicationVersion`  | The downstream app's version     | downstream `package.json`   |
| `databaseVersion`     | SQLite schema migration sequence | `core_migrations` table     |
| `featureVersion`      | Per-feature semver               | each feature `package.json` |
| `syncProtocolVersion` | Monotonic int, sync wire format  | `packages/sync-protocol/`   |

Never assume `applicationVersion` equality implies sync compatibility. Protocol versions are checked explicitly in the handshake.

### CHANGELOG

Maintain a `CHANGELOG.md` at the repository root following the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format with the following sections per release:

```markdown
## [X.Y.Z] — YYYY-MM-DD

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security
```

Security entries are always required when security-related changes are made — even for patch releases.

### Git tagging

Tag every release:

```
git tag v1.2.3
git push origin v1.2.3
```

GitHub Actions release workflow triggers on version tags.

---

## Target platforms

| Platform | Target                          | Notes                                                         |
| -------- | ------------------------------- | ------------------------------------------------------------- |
| Windows  | Windows 10 22H2+ / Windows 11   | Primary target                                                |
| Android  | Latest stable Android (API 35+) | Target modern devices only — no legacy compatibility required |

Android strategy: target the latest stable Android release. There is no requirement to support old API levels. This keeps the codebase simpler and allows use of modern Android APIs exposed through Tauri plugins.

---

## CLI scaffold tool (future consideration)

A potential future addition is a scaffold tool:

```bash
pnpm create tauri-local-first-app my-wms-app
```

This would:

- Clone the template
- Replace `apps/demo` with `apps/my-wms-app`
- Replace demo-specific content with scaffolding
- Run initial `pnpm install`

**Status**: Consideration only. This will not be implemented during the core platform phases. It becomes viable after Milestone 5 (complete platform) is achieved and the boilerplate is proven stable. If the `example-feature` pattern is clear enough, the scaffold may not be needed.

---

## Implementation philosophy

### Build the platform before any production application

The sequence is always:

1. Prove every high-risk assumption in Phase 0 spikes
2. Build the platform packages with tests and documentation
3. Validate the platform against the `apps/demo` vertical slice
4. Only then is the boilerplate ready for a downstream team to build on

**Do not** begin building WMS screens, ERP workflows, or logistics features inside this repository.

### Research before implementation

Any item marked **RESEARCH REQUIRED** in these documents must not be solved by guessing. Before implementing:

1. Read the current official documentation
2. Inspect the current upstream repository
3. Check current package versions and API stability
4. Build a minimal proof of concept
5. Record the result in an Architecture Decision Record
6. Only then commit the abstraction to the platform

This is especially critical for Tauri, iroh, Drizzle, and TanStack — all are actively evolving projects.

### Write from scratch unless research proves otherwise

Platform code is written from scratch. If research identifies a well-maintained, well-tested existing implementation that covers the requirement (e.g., an HLC crate, a UUID library), it may be adopted — but only after:

- License is confirmed compatible
- Maintenance activity is confirmed
- The code quality is evaluated
- The adoption is documented in an ADR

Do not reach for a dependency to solve a problem that takes fewer lines to write directly.
