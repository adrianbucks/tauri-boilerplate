# System Architecture

## Overview

The repository is a pnpm/Turborepo monorepo with TypeScript platform packages (`@platform/*`), domain feature packages (`features/*`), React 19 / Tauri 2 applications (`apps/*`), and native Rust crates (`crates/*`).

**Current status**: Core durable persistence, native Ed25519 identity custody, Argon2id authentication, RBAC authorization, durable sync queues, live iroh P2P transport, durable background task subsystem, and downstream multi-consumer adoption are all fully implemented. Remaining gates: OS background lifecycle adapters (WP-016) and release signing (WP-018).

---

## Layer diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Application / Feature UI                                       │
│  React pages, feature components, user workflows                │
└────────────────────────────┬────────────────────────────────────┘
                             │ typed service calls
┌────────────────────────────▼────────────────────────────────────┐
│  Application services / feature services                        │
│  validation → authorization → transaction → audit/outbox        │
└────────────────────────────┬────────────────────────────────────┘
                             │ repositories / platform APIs
┌────────────────────────────▼────────────────────────────────────┐
│  Platform services (@platform/*)                                │
│  core / identity / authorization / audit / sync / tasks         │
└────────────────────────────┬────────────────────────────────────┘
                             │ trusted native gateway (Tauri IPC)
┌────────────────────────────▼────────────────────────────────────┐
│  Native boundary (Tauri / Rust crates)                          │
│  DB lifecycle, protected keys, OS APIs, iroh transport          │
└──────────────┬───────────────────────┬──────────────────────────┘
               │                       │
        ┌──────▼──────┐         ┌──────▼──────┐
        │   SQLite    │         │    iroh     │
        │  durable    │         │  transport  │
        └─────────────┘         └─────────────┘
```

---

## The four independent responsibilities

Every design decision must be traceable to one of these four layers. They must remain separate at all times.

```
┌─────────────────────────────────────────────┐
│                    DATA                      │
│               SQLite (local)                 │
│  "What is the current local state?"          │
└────────────────────┬────────────────────────┘
                     │
┌────────────────────▼────────────────────────┐
│                  IDENTITY                    │
│         Users / Devices / Sessions          │
│  "Who is making this request?"              │
└────────────────────┬────────────────────────┘
                     │
┌────────────────────▼────────────────────────┐
│               AUTHORISATION                  │
│         RBAC + Scoped Permissions           │
│  "Is this subject allowed to do this?"      │
└────────────────────┬────────────────────────┘
                     │
┌────────────────────▼────────────────────────┐
│             SYNCHRONISATION                  │
│         iroh / op log / queues              │
│  "How do authorised peers exchange data?"   │
└─────────────────────────────────────────────┘
```

> **The most critical rule**: Never allow the sync layer to become the security layer by accident.

---

## Operation pipeline

Every user-initiated operation follows this sequence:

```
Untrusted UI input
  ↓ validate shape and domain constraints
Trusted session/principal (TrustedOperationContext)
  ↓ authorize(permission, tenant, resource)
Transaction boundary
  ↓ mutate domain state
  ├── append audit event
  └── append durable outbox operation (signed SyncEnvelope)
Commit
  ↓
UI receives safe result
  ↓ (async, background)
OutboxSyncWorker polls outbox → IrohSyncTransport → peer inbox
```

---

## Sync admission pipeline (seven gates)

A peer being reachable never means it is authorised to receive application data. Every data exchange passes through all seven layers in sequence:

```
1. iroh QUIC transport connection established
2. Cryptographic peer identity verified (Ed25519 public key)
3. Application ID + protocol version compatibility verified
4. Organisation relationship verified
5. Device + user/session status verified
6. Sync-group membership verified (device is ACTIVE member)
7. Namespace/data-scope permission verified
      ↓
Only then: application data is exchanged
```

Failure at any layer results in a clear rejection — not silent filtering.

---

## Architectural invariants

These 10 invariants are non-negotiable. No code change may violate them.

1. **No direct DB from UI** — UI never opens a database connection directly.
2. **No caller-supplied identity as proof** — Domain services never trust frontend-supplied `userId`, `deviceId`, or `organisationId` as proof of authority.
3. **Authorization before state change** — Every privileged mutation authorises before making any state change.
4. **Atomic business transactions** — Business state, audit event, and outbound replication metadata are committed atomically in one transaction.
5. **Network not required for local CRUD** — A normal user write must never wait for network availability.
6. **Sync transport is not business authorization** — The sync engine transports data after admission; it does not decide business authorisation.
7. **Private keys stay native** — Private cryptographic keys never enter JavaScript, web storage, or ordinary database tables.
8. **Cross-organisation denied by default** — Cross-org access requires an explicit capability with authorisation and audit.
9. **Synchronisable deletes are tombstones** — Hard deletes on replicated entities allow offline peers to resurrect stale state.
10. **Protocol and schema compatibility are explicit** — Never assume version equality implies wire compatibility.

---

## Package dependency direction

```
core
  ↑
database / identity / authorization / audit / sync-protocol
  ↑
sync / import-export / hardware / feature-system / tasks
  ↑
platform
  ↑
features/*
  ↑
apps/*
```

A lower-level package must not import a higher-level application feature. Domain packages must not be hidden inside platform infrastructure. See [architecture-principles.md](./architecture-principles.md) for the full dependency rules.

---

## Remaining gaps to production readiness

| Gap | Work Package | Status |
|---|---|---|
| OS Background Lifecycle Adapters (Android WorkManager + Windows scheduler) | WP-016 | 🚧 Open |
| Release signing, checksums, provenance | WP-018 | 🚧 Open |

All other P0/P1 gates are resolved. See [`06-status/current-state.md`](../06-status/current-state.md) for the full evidence-backed status matrix.
