# Architecture Decision Records (ADRs)

This directory forms the authoritative record of architectural decisions made in the platform. Decisions are never silently overwritten; changes to architecture require a new ADR or an explicit status update.

---

## Canonical Decision Register

| ADR                                                       | Title                                             | Status     | Scope / Impact                                                                                                         |
| :-------------------------------------------------------- | :------------------------------------------------ | :--------- | :--------------------------------------------------------------------------------------------------------------------- |
| **[ADR-001](./ADR-001-monorepo-structure.md)**            | Monorepo Structure & Package Boundaries           | Accepted   | Workspace layout, separation of `packages/`, `crates/`, `features/`, `apps/`                                           |
| **[ADR-002](./ADR-002-tauri-architecture.md)**            | Tauri 2 Architecture & Platform Targets           | Accepted   | Target OS (Windows 10/11, Android 15+), Rust embedding, IPC boundary                                                   |
| **[ADR-003](./ADR-003-native-sqlite-persistence.md)**     | Native Durable SQLite Persistence Strategy        | Accepted   | Bundled SQLite WAL, rusqlite, connection pragma invariants, typed bridge                                               |
| **[ADR-004](./ADR-004-drizzle-integration.md)**           | Drizzle ORM Schema & Query Integration            | Accepted   | Type-safe migrations, TypeScript schema definition, repository abstraction                                             |
| **[ADR-005](./ADR-005-ui-and-styling.md)**                | React-First UI & Styling Primitives               | Accepted   | Reject JSON-to-UI engines, adopt shadcn primitives, Vanilla CSS tokens                                                 |
| **[ADR-006](./ADR-006-identity-model.md)**                | Decentralized Identity & Authentication Model     | Accepted   | Ed25519 device keys in Rust custody, Argon2id passwords, session tokens                                                |
| **[ADR-007](./ADR-007-rbac.md)**                          | Scoped Role-Based Access Control (RBAC)           | Accepted   | Granular dot-notation permissions, resource-scoped enforcement, no role checks                                         |
| **[ADR-008](./ADR-008-audit-logging.md)**                 | Append-Only Audit Trail Architecture              | Accepted   | Immutable audit events, correlation IDs, no credential exposure                                                        |
| **[ADR-010](./ADR-010-feature-system.md)**                | Pluggable Feature Manifest System                 | Accepted   | Explicit feature registration, topological dependency ordering, schema isolation                                       |
| **[ADR-011](./ADR-011-hlc-sync-state.md)**                | Hybrid Logical Clocks (HLC) & Conflict Resolution | Accepted   | Deterministic causality tracking, LWW conflict resolution, tombstone tracking                                          |
| **[ADR-012](./ADR-012-iroh-p2p-transport.md)**            | iroh P2P Transport & R-002 Research Gate          | Accepted   | QUIC transport, custom ALPN, canonical envelope streams, reject iroh-docs                                              |
| **[ADR-013](./ADR-013-iroh-docs-evaluation.md)**          | Evaluation of iroh-docs Substrate                 | Superseded | Details why iroh-docs was evaluated and superseded by Option 1 canonical envelopes                                     |
| **[ADR-017](./ADR-017-import-export.md)**                 | Streaming Import/Export Architecture              | Accepted   | SheetJS engine, transactional domain commits, CSV formula injection defense                                            |
| **[ADR-018](./ADR-018-hardware-scanning.md)**             | Hardware Barcode & Scanner Abstraction            | Accepted   | Keyboard-wedge inter-key delay analysis, unified scanner listener interface                                            |
| **[ADR-019](./ADR-019-secure-storage.md)**                | Cryptographic Key Custody & Secure Storage        | Accepted   | Private keys kept in native Rust memory, OS keychain integration                                                       |
| **[ADR-020](./ADR-020-release-pipeline.md)**              | Multi-Platform Build & Release Pipeline           | Accepted   | CI matrix for Windows MSI and Android APK, artifact signing, checksum verification                                     |
| **[ADR-022](./ADR-022-separate-user-device-identity.md)** | Separate User and Device Identity                 | Accepted   | Orthogonal device identity and user credentials, session binding layer                                                 |
| **[ADR-024](./ADR-024-first-class-background-tasks.md)**  | First-Class Durable Background Tasks              | Accepted   | SQLite task queue, TaskWorker, OutboxSyncWorker, platform adapters                                                     |
| **[ADR-025](./ADR-025-cross-organisation-access.md)**     | Cross-Organisation Access Boundary                | Accepted   | Denied by default, mandatory organisationId scoping, strict tenant isolation                                           |
| **[ADR-027](./ADR-027-typed-native-data-gateway.md)**     | Typed Native Data Gateway                         | Accepted   | Prohibit arbitrary SQL from webview, validate SQL safety, capability controls                                          |
| **[ADR-030](./ADR-030-p2p-relay-infrastructure.md)**      | Production P2P Relay Infrastructure Policy        | Accepted   | Self-hosted `iroh-relay` for production; public relay fallback for staging only; metadata privacy and SLA requirements |

---

## Additional Strategic Decisions

### ADR-021: Shared-Device Authentication Model

One physical device may host multiple user accounts. Device identity (`DeviceId`, Ed25519 keypair) and user credentials (`UserId`, Argon2id hash) are strictly decoupled. User logout clears the in-memory session principal but does not revoke the device from its network peers.

### ADR-023: Versioned Replication Envelopes

Replication operates on strongly typed, versioned `CanonicalSyncEnvelope` frames, never raw SQLite table mirroring. Each entity defines a schema namespace, sync policy, and conflict resolution strategy.

### ADR-026: Transparent Database Encryption

Database-level encryption (SQLCipher) is deferred until multi-platform key escrow, OS keychain integration, and automated migration semantics are fully established across Windows and Android.

### ADR-028: Cryptography as a Verified Research Gate

Do not commit to proprietary cryptographic primitives without formal verification. Ed25519 signatures and Argon2id password hashing are enforced as the standard cryptographic baseline.

### ADR-029: Reusable Platform vs Domain Feature Boundary

Infrastructure packages (`packages/*`, `crates/*`) must remain completely domain-neutral. All business concepts (products, inventory, widgets, orders) belong in `features/*` or `apps/*`.

### ADR-030: Production P2P Relay Policy

Self-hosted `iroh-relay` instances are required for production deployments (see [ADR-030](./ADR-030-p2p-relay-infrastructure.md)). Public relay infrastructure operated by third parties is acceptable only for staging and development. End-to-end encryption of sync envelopes is guaranteed regardless of relay operator, but metadata privacy requires self-hosted relay.

---

## ADR Lifecycle Workflow

When modifying architectural boundaries or introducing major platform capabilities:

1. **Identify Impact**: Check if the change impacts existing ADR assumptions.
2. **Author New Record**: Do not silently rewrite history; create a new ADR referencing previous decisions.
3. **Update Status**: If an ADR is replaced, mark its status as `Superseded by ADR-xxx`.
4. **Synchronize Architecture Docs**: Update `docs/02-architecture/` to align with the accepted decision.
5. **Add Regression Tests**: Ensure new architectural rules are guarded by automated tests.
