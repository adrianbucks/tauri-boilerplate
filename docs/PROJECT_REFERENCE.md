# Project Reference — Local-First Cross-Platform Application Platform

## 1. Purpose

This repository is a reusable platform/template for building business applications that are:

- local-first and useful without continuous connectivity;
- durable on the client device;
- multi-user on shared physical devices;
- multi-organisation with explicit tenant boundaries;
- synchronisable between authorised devices;
- auditable;
- cross-platform across Windows and Android;
- structured so domain applications can be built without modifying platform internals.

The demo application is a **downstream reference consumer**, not the platform itself.

## 2. Product principles

1. **Local-first:** local reads and business writes do not depend on the network.
2. **Durability:** committed business state survives process restart and device restart.
3. **Least privilege:** every layer receives only the authority it needs.
4. **Explicit trust:** reachability is never equivalent to authorisation.
5. **Separate identities:** user identity, device identity and transport identity have distinct responsibilities.
6. **Deterministic replication:** the same valid operation history produces the same converged result.
7. **Auditability:** security-relevant business events are attributable and append-only.
8. **Domain neutrality:** platform packages provide mechanisms; application features provide business semantics.
9. **Native key custody:** private cryptographic material never crosses into JavaScript memory.
10. **Evidence over aspiration:** production status requires executable verification.

## 3. Ownership boundaries

### Platform owns

- application bootstrap and lifecycle;
- configuration and error taxonomy;
- logging/correlation infrastructure;
- native IPC and capability governance;
- durable database lifecycle and migrations;
- device identity and key-provider abstractions;
- authentication/session primitives;
- authorisation engine and scope evaluation;
- audit service;
- sync transport/protocol primitives;
- feature registration/dependency resolution;
- background-task primitives;
- import/export and hardware abstractions;
- shared UI infrastructure;
- CI/release engineering.

### Application/features own

- business entities and rules;
- feature-specific schema and migrations;
- feature permissions and sync policies;
- feature repositories/services;
- business UI and workflows;
- domain-specific conflict semantics.

### Demo owns

Only demonstration composition and example domain behavior. It must not become the hidden owner of platform schema, persistence lifecycle, authentication truth or transport policy.

## 4. Current technology baseline

The repository currently declares:

- Tauri 2 (`@tauri-apps/cli` 2.11.4 in the demo package);
- React 19 + TypeScript;
- Vite 6;
- pnpm 10.26.0 + Turborepo 2.4.4;
- Drizzle ORM 0.39.3 for schema/ORM abstractions;
- `sql.js` as the current in-memory test/demo database adapter;
- Rust workspace using edition 2021 and the repository-pinned toolchain;
- Vitest 3 for TypeScript tests.

The codebase **does not currently contain an iroh dependency or real iroh transport implementation**. `sync-core` contains transport-shaped abstractions only.

## 5. Production objective

The target platform must eventually provide:

```text
React application
    ↓ typed application services
Platform services
    ↓ trusted native gateway
Tauri/Rust boundary
    ├── durable SQLite
    ├── protected device keys
    ├── authenticated sessions
    └── real iroh transport
            ↓
       authorised peer
```

The platform must remain functional locally if the peer/network is unavailable.

## 6. Definition of production readiness

Production readiness is not a single build-success flag. It requires all P0/P1 security and durability gaps in `verification/CURRENT_STATE.md` to be closed and the acceptance gates in `testing/ACCEPTANCE_GATES.md` to pass on the supported Windows and Android matrix.
