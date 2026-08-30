# Platform Documentation Hub

**Document Status:** Living baseline — updated continuously  
**Last Revised:** 2026-08-30  
**Audience:** Developers, AI coding agents, QA engineers, and architects

---

## 🏛️ What is `tauri-boilerplate`?

`tauri-boilerplate` is a production-ready **GitHub Template Repository** for building cross-platform (**Windows 10/11 + Android API 35+**) local-first business applications using **Tauri 2, React 19, TypeScript, SQLite, and iroh-based P2P synchronisation**.

Developers fork or use this template to start new business applications. This repository provides the complete platform layer (`packages/`, `crates/`, `tooling/`), while downstream developers implement domain-specific logic exclusively in `features/` and `apps/`.

---

## 📚 Categorised Documentation Directory

```text
docs/
├── architecture/      ← Core system design & platform subsystem specifications
├── development/       ← Engineering guidelines, testing strategies, CI/CD & agent invariants
├── security/          ← Threat models, capability scoping & audit trail architecture
├── protocols/         ← 7-layer handshake & P2P wire synchronization specifications
└── decisions/         ← Architecture Decision Records (ADR-001 through ADR-020)
```

---

### 1. 🏛️ Architecture (`docs/architecture/`)

| Document                                                                                | Topic                                                                                                       |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [`01-project-overview.md`](./architecture/01-project-overview.md)                       | Goals, distribution model, downstream consumption, versioning dimensions, and target platforms.             |
| [`02-architecture-principles.md`](./architecture/02-architecture-principles.md)         | 4-layer model (Data, Identity, Auth, Sync), 7-layer pre-sync stack, and atomic mutation invariants.         |
| [`03-database-and-schema.md`](./architecture/03-database-and-schema.md)                 | SQLite singleton, 22 Drizzle core schemas, `BaseRepository` with tombstones, and migration engine.          |
| [`04-identity-and-authentication.md`](./architecture/04-identity-and-authentication.md) | Cryptographic device identity, Ed25519 keypairs, OS secure storage, and user session management.            |
| [`05-authorization-and-rbac.md`](./architecture/05-authorization-and-rbac.md)           | Scoped RBAC engine (`can()`, `require()`), hierarchical permissions, and sync group state machine.          |
| [`06-synchronisation-and-p2p.md`](./architecture/06-synchronisation-and-p2p.md)         | iroh transport, 13-state sync state machine, Hybrid Logical Clock (HLC), conflict policies, and namespaces. |
| [`07-feature-system.md`](./architecture/07-feature-system.md)                           | Declarative `FeatureManifest`, topological DAG dependency resolver, and build-time validation.              |
| [`08-ui-and-components.md`](./architecture/08-ui-and-components.md)                     | Tailwind CSS v4 styling, shadcn/ui components, `AppShell` with live sync telemetry, and `DataTable`.        |
| [`09-import-export-and-hardware.md`](./architecture/09-import-export-and-hardware.md)   | SheetJS spreadsheet ingestion/export and keyboard-wedge barcode scanner listener.                           |
| [`10-demo-application.md`](./architecture/10-demo-application.md)                       | Showcase vertical-slice scenario, diagnostics screen, and signed release installer generation.              |

---

### 2. 🛠️ Development & Operational Guidelines (`docs/development/`)

| Document                                                                                     | Topic                                                                                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`01-repository-structure.md`](./development/01-repository-structure.md)                     | Monorepo layout, hard boilerplate/implementation boundary, naming rules, and workspace configs.         |
| [`02-technology-baseline.md`](./development/02-technology-baseline.md)                       | Full technology stack, strict TypeScript rules (`noUncheckedIndexedAccess`), and logging standards.     |
| [`03-implementation-phases.md`](./development/03-implementation-phases.md)                   | Milestones M1 through M6 verification state, deliverables, and completed implementation summary.        |
| [`04-testing-strategy.md`](./development/04-testing-strategy.md)                             | Unit tests, cross-package integration tests, multi-device replication harness, and security test suite. |
| [`05-build-release-and-versioning.md`](./development/05-build-release-and-versioning.md)     | GitHub Actions CI/CD workflows, Authenticode & Android Keystore signing, and SemVer standards.          |
| [`06-agent-and-developer-guidelines.md`](./development/06-agent-and-developer-guidelines.md) | The 10 Critical Invariants for coding agents, contract-first interfaces, and Definition of Done.        |

---

### 3. 🔒 Security Model & Governance (`docs/security/`)

| Document                                                  | Topic                                                                                           |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`01-security-model.md`](./security/01-security-model.md) | Threat boundaries, Tauri capability scoping, append-only immutable audit trail, and revocation. |

---

### 4. 📡 Wire Protocols (`docs/protocols/`)

| Document                                                                             | Topic                                                                                    |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| [`01-handshake-and-sync-protocol.md`](./protocols/01-handshake-and-sync-protocol.md) | Typed 7-layer handshake message contract, protocol versioning, and operation data model. |

---

### 5. 📜 Architecture Decision Records (`docs/decisions/`)

| Record                                                      | Title                                                    | Status   |
| ----------------------------------------------------------- | -------------------------------------------------------- | -------- |
| [`ADR-001`](./decisions/ADR-001-repository-and-monorepo.md) | Repository Structure and Monorepo Tooling                | Accepted |
| [`ADR-002`](./decisions/ADR-002-tauri-architecture.md)      | Tauri 2 Architecture and Platform Support                | Accepted |
| [`ADR-003`](./decisions/ADR-003-sqlite-access.md)           | SQLite Access Strategy                                   | Accepted |
| [`ADR-004`](./decisions/ADR-004-drizzle-integration.md)     | Drizzle ORM Integration and Migration Strategy           | Accepted |
| [`ADR-005`](./decisions/ADR-005-ui-and-styling.md)          | UI Component Library and Styling Engine                  | Accepted |
| [`ADR-006`](./decisions/ADR-006-identity-model.md)          | Device and User Cryptographic Identity Model             | Accepted |
| [`ADR-007`](./decisions/ADR-007-rbac.md)                    | Scoped Role-Based Access Control (RBAC) Engine           | Accepted |
| [`ADR-008`](./decisions/ADR-008-audit-logging.md)           | Append-Only Audit Event Subsystem                        | Accepted |
| [`ADR-010`](./decisions/ADR-010-feature-system.md)          | Modular Feature Manifest & Registry System               | Accepted |
| [`ADR-011`](./decisions/ADR-011-hlc-sync-state.md)          | Hybrid Logical Clock (HLC) and P2P Sync State Machine    | Accepted |
| [`ADR-012`](./decisions/ADR-012-iroh-transport.md)          | iroh P2P Transport Layer                                 | Accepted |
| [`ADR-013`](./decisions/ADR-013-iroh-docs-evaluation.md)    | iroh-docs Evaluation & Decision Gate                     | Accepted |
| [`ADR-017`](./decisions/ADR-017-import-export.md)           | Spreadsheet Ingestion and Export Engine (`SheetJS`)      | Accepted |
| [`ADR-018`](./decisions/ADR-018-hardware-scanning.md)       | Hardware Scanner and Peripheral Integration              | Accepted |
| [`ADR-019`](./decisions/ADR-019-secure-storage.md)          | OS Secure Key Storage (Windows DPAPI / Android Keystore) | Accepted |
| [`ADR-020`](./decisions/ADR-020-release-pipeline.md)        | Cross-Platform Build, Code Signing, and Release Pipeline | Accepted |

---

## 🤖 Mandatory Reading Order for AI Coding Agents

Before modifying any code in this repository, an AI agent must read:

1. [`development/01-repository-structure.md`](./development/01-repository-structure.md) — directory layout and boundaries.
2. [`architecture/02-architecture-principles.md`](./architecture/02-architecture-principles.md) — the non-negotiable architectural rules.
3. [`development/06-agent-and-developer-guidelines.md`](./development/06-agent-and-developer-guidelines.md) — the 10 critical invariants.
4. The specific subsystem document in `docs/architecture/` relevant to the component being modified.
5. The associated ADR in `docs/decisions/`.
