# Project Overview

## Purpose

`tauri-boilerplate` is an open-source **GitHub Template Repository and development scaffold** for building cross-platform, local-first business applications. It targets **Windows** and **Android** from a single codebase using:

| Technology | Role |
|---|---|
| **Tauri 2** | Native shell, OS integration, protected native storage |
| **React 19 + TypeScript + Vite** | Frontend application layer |
| **SQLite + Drizzle ORM** | Durable local-first data layer |
| **iroh (QUIC/P2P)** | Peer-to-peer data synchronisation |
| **pnpm + Turborepo** | Monorepo management |
| **Rust (Cargo workspace)** | Native backend crates |

The repository is designed as an **opinionated platform**: identity, authorisation, data synchronisation, audit, import/export, hardware abstraction, and a UI component set are pre-built. Developers building business applications start here and add only their domain-specific features.

> The platform is not yet production-ready. Several gates remain open. See [`06-status/current-state.md`](../06-status/current-state.md) for the evidence-backed status.

---

## What this repository is and is not

| ✅ This repository IS | ❌ This repository is NOT |
|---|---|
| A GitHub Template Repository | A monorepo of production applications |
| The authoritative platform implementation | An npm-published library |
| A running demo application (`apps/demo`) | A framework that generates application code |
| A copy-paste starting point (`example-feature`) | A collection of WMS / ERP / logistics apps |
| The home of all platform packages and Rust crates | A one-size-fits-all solution for every use case |

---

## Product principles

1. **Local-first** — local reads and business writes do not depend on the network.
2. **Durability** — committed business state survives process restart and device restart.
3. **Least privilege** — every layer receives only the authority it needs.
4. **Explicit trust** — reachability is never equivalent to authorisation.
5. **Separate identities** — user identity, device identity and transport identity have distinct responsibilities.
6. **Deterministic replication** — the same valid operation history produces the same converged result.
7. **Auditability** — security-relevant business events are attributable and append-only.
8. **Domain neutrality** — platform packages provide mechanisms; application features provide business semantics.
9. **Native key custody** — private cryptographic material never crosses into JavaScript memory.
10. **Evidence over aspiration** — production status requires executable verification.

---

## Distribution model — GitHub Template

Developers create a new project from this template:

```
GitHub → Use this template → Create new repository
    ↓
new-project/
    ├── apps/           ← replace apps/demo with apps/their-app
    ├── packages/       ← use unchanged, or PR improvements upstream
    ├── crates/         ← use unchanged, or PR improvements upstream
    ├── features/       ← add domain features here
    └── ...
```

**Platform improvements** (bugs fixed in `packages/`, `crates/`, tooling, security) should be PRed back to `tauri-boilerplate`. **Application specifics** (WMS routes, ERP schemas, domain business logic) stay permanently in the downstream repository.

There is no runtime dependency on this repository after the template is copied — downstream projects are fully independent.

For a step-by-step guide on using this as a template, see [`04-guides/downstream-adoption.md`](../04-guides/downstream-adoption.md).

---

## Ownership boundaries

### Platform owns (`packages/`, `crates/`, `features/identity-admin`, `features/organisations`)

- Application bootstrap and lifecycle
- Configuration and error taxonomy
- Logging and correlation infrastructure
- Native IPC and capability governance
- Durable database lifecycle and migrations
- Device identity and key-provider abstractions
- Authentication/session primitives
- Authorisation engine and scope evaluation
- Audit service
- Sync transport/protocol primitives
- Feature registration and dependency resolution
- Background-task primitives
- Import/export and hardware abstractions
- Shared UI infrastructure
- CI/release engineering

### Application/features own (`features/your-domain/`, `apps/your-app/`)

- Business entities and rules
- Feature-specific schema and migrations
- Feature permissions and sync policies
- Feature repositories and services
- Business UI and workflows
- Domain-specific conflict semantics

### Demo owns (`apps/demo/`)

Only demonstration composition and example domain behavior. It must not become the hidden owner of platform schema, persistence lifecycle, authentication truth, or transport policy.

---

## Target platforms

| Platform | Target | Notes |
|---|---|---|
| Windows | Windows 10 22H2+ / Windows 11 | Primary development target |
| Android | Latest stable Android (API 35+) | Target modern devices only |

---

## Target architecture (production objective)

```
React application
    ↓ typed service calls
Application / feature services
    ↓ validation → authorization → transaction → audit/outbox
Platform services
    ↓ trusted native gateway
Tauri / Rust boundary
    ├── durable SQLite
    ├── protected device keys
    ├── authenticated sessions
    └── iroh QUIC transport
            ↓
       authorised peer
```

The platform must remain fully functional locally if the peer/network is unavailable.

---

## Versioning strategy

| Version | Tracks | Stored in |
|---|---|---|
| `platformVersion` | Boilerplate release | `package.json` (root) |
| `applicationVersion` | Downstream app version | downstream `package.json` |
| `databaseVersion` | SQLite migration sequence | `core_migrations` table |
| `featureVersion` | Per-feature semver | each feature `package.json` |
| `syncProtocolVersion` | Monotonic int, wire format | `packages/sync-protocol/` |

Never assume `applicationVersion` equality implies sync compatibility — protocol versions are checked explicitly during the handshake.

---

## Definition of production readiness

Production readiness is not a single build-success flag. It requires:
- All P0/P1 security and durability gaps in [`06-status/current-state.md`](../06-status/current-state.md) to be closed.
- All acceptance gates in [`06-status/acceptance-gates.md`](../06-status/acceptance-gates.md) to pass on the supported Windows and Android matrix.
- Release signing, checksums, and provenance attestation configured in CI.
