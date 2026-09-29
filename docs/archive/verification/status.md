# Implementation Status

**Status:** Authoritative current-state record
**Last reviewed:** 2026-09-04

This document distinguishes implemented code from target architecture. A capability is not considered complete because a type, placeholder, simulated test, or design document exists.

## Status vocabulary

- **Verified:** implemented and covered by an executable check at the current boundary.
- **Implemented, incomplete:** working code exists, but the specification acceptance criteria are not met.
- **Scaffolded:** interfaces, types, or simulations exist; the production behavior is absent.
- **Research required:** an implementation decision must be supported by current evidence and a spike/ADR.
- **Blocked:** a dependency or environment prevents verification.

## Specification matrix

| Area                                     | Current status                | Evidence                                                   | Main gap                                                                                                          |
| ---------------------------------------- | ----------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| S-01 Database and persistence            | Implemented, incomplete       | `packages/database`, migration tests, owner/checksum tests | Production still uses `MemoryDatabaseConnection`/`sql.js`; no durable native SQLite adapter.                      |
| S-02 Identity and secure storage         | Scaffolded, research required | `crates/identity-core`, identity tests, ADR-019            | Key generation is placeholder randomness; no persisted Ed25519 keypair or OS secure storage.                      |
| S-03 Authentication, session and tenancy | Implemented, incomplete       | `packages/identity`, identity tests                        | Sessions are in memory; active membership and durable session invalidation are incomplete.                        |
| S-04 Authorization engine                | Implemented, incomplete       | `packages/authorization`, RBAC security tests              | Subject construction remains caller-facing; session/device/membership validation is not owned by the engine.      |
| S-05 Sync operation log                  | Scaffolded, research required | `packages/sync`, `packages/sync-protocol`                  | No durable operation log, idempotent application table, quarantine, or queue contract.                            |
| S-06 iroh transport and handshake        | Scaffolded, research required | handshake validator and sync state types                   | No iroh transport, signed envelope, nonce replay protection, or real peer exchange.                               |
| S-07 Conflict, tombstone and recovery    | Implemented, incomplete       | `ConflictRegistry`, `BaseRepository`, sync tests           | Tombstones are local mechanics only; replication, recovery, GC, and operation application are absent.             |
| S-08 Feature system and migrations       | Implemented, incomplete       | registry tests and migration ownership tests               | Manifest validation does not enforce every required sync, capability, boundary, and compatibility rule.           |
| S-09 Frontend/application boundary       | Implemented, incomplete       | demo context bootstrap and demo build                      | Demo still owns ad hoc schemas and in-memory storage; second-application proof is absent.                         |
| S-10 Tauri native capability boundary    | Implemented, incomplete       | identity command, capability manifest, native contract     | Only one command exists; capability matrix, command authorization, and broad-permission CI checks are incomplete. |
| S-11 Verification and CI gates           | Implemented, incomplete       | CI, build, release workflows and test packages             | Architecture invariant checks, coverage thresholds, signing checks, and complete security cases are absent.       |
| S-12 Release and distribution            | Implemented, incomplete       | local Windows MSI/NSIS and Android APK builds; workflows   | Signing, updater metadata, version/architecture inspection, and release signing are not configured.               |

## Verified local checks

The following have executable evidence in the repository:

- Database migration ordering, rollback, owner namespaces, checksums, and SQL scripts with quoted semicolons.
- Identity session rejection for suspended/revoked devices, tenant mismatch, and caller-role injection.
- Scoped RBAC decisions and cross-tenant role injection denial.
- Feature dependency ordering, duplicate feature IDs, duplicate permissions, and duplicate registration.
- Integration, security, and sync test packages executing through explicit Turbo tasks.
- Windows MSI and NSIS packaging on the development machine.
- Android universal release APK packaging on the development machine with JDK 17, Android SDK/NDK, and Developer Mode enabled.

These checks validate slices of behavior. They do not establish production readiness for the platform as a whole.

## Release readiness rule

Do not describe the repository as production-ready until S-01, S-02, S-05, S-06, S-07, S-10, S-11, and S-12 acceptance criteria are met and linked to executable verification evidence.
