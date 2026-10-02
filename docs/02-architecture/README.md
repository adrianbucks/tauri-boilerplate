# Architecture & System Design

Welcome to the comprehensive architecture specifications for the offline-first, local-first Tauri application platform.

---

## Architecture Navigation

| Document                                                                                                              | Focus & Scope                                                                      | Core Packages / Crates                                          |
| :-------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------- | :-------------------------------------------------------------- |
| **[System Architecture](file:///c:/dev/tauri-boilerplate/docs/02-architecture/system-architecture.md)**               | End-to-end multi-layer design, unidirectional dependency flows, clean architecture | All                                                             |
| **[Architecture Principles](file:///c:/dev/tauri-boilerplate/docs/02-architecture/architecture-principles.md)**       | 10 non-negotiable invariants, coding standards, design patterns                    | All                                                             |
| **[Database & Persistence](file:///c:/dev/tauri-boilerplate/docs/02-architecture/database-and-persistence.md)**       | SQLite WAL, schema migrations, repository pattern, tenant isolation                | `@platform/database`, `crates/native-core`                      |
| **[Identity & Authentication](file:///c:/dev/tauri-boilerplate/docs/02-architecture/identity-and-authentication.md)** | Ed25519 device keys, Argon2id passwords, session tokens, key custody               | `@platform/identity`, `crates/identity-core`                    |
| **[Authorization & RBAC](file:///c:/dev/tauri-boilerplate/docs/02-architecture/authorization-and-rbac.md)**           | Role permissions, scoped authorization, tenant boundaries, sync groups             | `@platform/authorization`                                       |
| **[Synchronization & P2P](file:///c:/dev/tauri-boilerplate/docs/02-architecture/synchronization.md)**                 | Canonical envelopes, 7-layer admission, iroh QUIC transport, HLC conflict engine   | `@platform/sync`, `@platform/sync-protocol`, `crates/sync-core` |
| **[Background Tasks](file:///c:/dev/tauri-boilerplate/docs/02-architecture/background-tasks.md)**                     | Durable SQLite queue, worker loops, outbox sync worker, exponential backoff        | `@platform/tasks`                                               |
| **[Native Boundary & Tauri IPC](file:///c:/dev/tauri-boilerplate/docs/02-architecture/native-boundary.md)**           | Contracted Tauri commands, capability firewall, SQL safety guard, CSP              | `apps/demo/src-tauri`, `crates/native-core`                     |
| **[Security Model](file:///c:/dev/tauri-boilerplate/docs/02-architecture/security-model.md)**                         | Threat model, trust boundaries, audit logging, revocation propagation              | `@platform/audit`, `tests/security`                             |
| **[Feature System](file:///c:/dev/tauri-boilerplate/docs/02-architecture/feature-system.md)**                         | Feature manifests, schema registry, lifecycle management, modular features         | `@platform/feature-system`, `features/*`                        |
| **[Import, Export & Hardware](file:///c:/dev/tauri-boilerplate/docs/02-architecture/import-export-and-hardware.md)**  | SheetJS file pipelines, CSV injection defense, barcode/RFID scanners               | `@platform/import-export`, `@platform/hardware`                 |
| **[UI & Component System](file:///c:/dev/tauri-boilerplate/docs/02-architecture/ui-and-components.md)**               | React-first screens, AppShell, sync indicators, theme tokens, DataTable            | `@platform/ui`                                                  |

---

## 10 Non-Negotiable Invariants

All contributors and AI agents must preserve these 10 invariants across all code modifications:

1. **Do not bypass the repository layer**: Never execute direct SQL queries or open raw connections in UI components or service classes.
2. **Do not hardcode role checks**: Never write `if (user.role === 'admin')`. Use `authorization.require('permission.name', resource)` or `authorization.can()`.
3. **Do not sync without a sync policy**: Any synchronisable entity must declare a valid `SyncPolicyDefinition` in its `FeatureManifest`.
4. **Do not transmit data before passing all 7 authorisation layers**: A peer being reachable does not mean it is authorised.
5. **Do not leak private keys**: Never expose private keys to the TypeScript runtime, web storage, or SQLite.
6. **Do not use raw DELETE for synchronisable entities**: Always use the tombstone pattern (`deleted_at`, `deleted_by`, `delete_operation_id`).
7. **Do not guess evolving APIs**: For Tauri, iroh, Drizzle, and TanStack, consult current official documentation and write proof-of-concept spikes rather than assuming API shapes.
8. **Do not grant broad Tauri capabilities**: Every capability in `capabilities/*.json` must be scoped narrowly and commented with its justification.
9. **Add security regression tests**: Every security change must be accompanied by a test in `tests/security/`.
10. **Maintain the boilerplate/implementation boundary**: Do not add domain-specific business logic into `packages/` or `crates/`. Keep all domain logic in `features/` or `apps/`.
