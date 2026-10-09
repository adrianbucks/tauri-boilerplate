# Implementation Work Packages Register

This document tracks the progress, implementation locations, verification evidence, and open scope across all 20 architectural work packages (WP-001 through WP-020).

---

## Work Packages Status Table

| WP         | Title                          | Status                         | Primary Location                                  | Key Verification Evidence                                                                    |
| :--------- | :----------------------------- | :----------------------------- | :------------------------------------------------ | :------------------------------------------------------------------------------------------- |
| **WP-001** | Durable SQLite Adapter         | ✅ RESOLVED                    | `crates/native-core`, `@platform/database`        | 5 regression tests (WAL, FKs, rollback, persistence)                                         |
| **WP-002** | Core Migration Authority       | ✅ RESOLVED                    | `@platform/platform`, `crates/native-core`        | Ordered execution, SHA-256 checksum verification                                             |
| **WP-003** | Tenant-Aware Repositories      | ✅ RESOLVED                    | `@platform/database`, `features/*`                | `tests/security/tenant-isolation.test.ts` (7 tests)                                          |
| **WP-004** | Trusted Operation Context      | ✅ RESOLVED                    | `@platform/core`, `@platform/identity`            | `tests/security/authentication-boundary.test.ts`                                             |
| **WP-005** | Device Key Provider            | ✅ RESOLVED                    | `crates/identity-core`, `crates/crypto-core`      | 4 tests: Ed25519 seed generation, signing, persistence                                       |
| **WP-006** | Offline Authentication         | ✅ RESOLVED                    | `crates/native-core`, `@platform/identity`        | Argon2id verification, 5-failure lockout cooldown                                            |
| **WP-007** | Authorization Enforcement      | ✅ RESOLVED                    | `@platform/authorization`, `features/*`           | `tests/security/rbac-security.test.ts` (12 tests)                                            |
| **WP-008** | Typed Native Gateway           | ✅ RESOLVED                    | `apps/demo/src-tauri/src/lib.rs`                  | Typed IPC commands, validation in Rust memory                                                |
| **WP-009** | Tauri Capability & CSP         | ✅ RESOLVED                    | `apps/demo/src-tauri/capabilities/`               | Strict CSP (`default-src 'self'`), no inline script/WASM                                     |
| **WP-010** | Canonical Sync Envelope        | ✅ RESOLVED                    | `@platform/sync-protocol`                         | Deterministic sorted-key serialization, Ed25519 sigs                                         |
| **WP-011** | Authenticated Handshake        | ✅ RESOLVED                    | `@platform/sync-protocol`, `@platform/sync`       | 32-hex nonce freshness, 30s skew window, replay guard                                        |
| **WP-012** | Durable Outbox & Inbox         | ✅ RESOLVED                    | `@platform/sync`, `core-replication.sql`          | Transactional enqueue, `ON CONFLICT DO NOTHING`                                              |
| **WP-013** | Conflict & Tombstone Engine    | ✅ RESOLVED                    | `@platform/sync`, `@platform/sync-protocol`       | Additive guard for absolute quantities, soft-delete tombstones                               |
| **WP-014** | Real iroh P2P Transport        | ✅ RESOLVED                    | `crates/sync-core`, `@platform/sync`              | `test_iroh_loopback_two_node_envelope_exchange`, QUIC stream                                 |
| **WP-015** | Background Task Subsystem      | ✅ RESOLVED                    | `@platform/tasks`                                 | 33 unit and integration tests passing                                                        |
| **WP-016** | OS Lifecycle Adapters          | ✅ RESOLVED                    | `packages/tasks`, `apps/demo/src-tauri`           | Windows System Tray (WP-016b, 8 tests) & Android WorkManager (WP-016a, 7 tests)              |
| **WP-017** | Import / Export Hardening      | ✅ RESOLVED                    | `@platform/import-export`                         | 10MB/10k row bounds, CSV formula injection defense                                           |
| **WP-018** | Release Hardening & Provenance | ✅ RESOLVED (Optional Signing) | `.github/workflows/`, `apps/demo`                 | CI supply chain audit passing (WP-018a); free Android keystore + SLSA provenance (WP-018c/d) |
| **WP-019** | Downstream Adoption Test       | ✅ RESOLVED                    | `apps/minimal-consumer`                           | Field Notes app, Gate G-12 passed, Invariant #10 verified                                    |
| **WP-020** | Fine-Grained Capability Matrix | ✅ RESOLVED                    | `capabilities/default.json`, `crates/native-core` | `tauri-capability-governance.test.ts`, SQL safety guard                                      |
| **WP-021** | Feature Permission Enforcement | ✅ RESOLVED                    | `@tooling/feature-validator`                      | Gate G-013, 13 security regression tests, CI `feature-validate` task                         |
| **WP-022** | Storage Compaction & Pruning   | ✅ RESOLVED                    | `@platform/maintenance`, `@platform/tasks`        | Gate G-014, 5 compaction invariants, 8 package unit tests, 5 security regression tests       |

---

## Detailed Work Packages Resolution

### WP-016: Android & Windows OS Lifecycle Adapters ✅ RESOLVED

- **Objective**: Ensure background sync tasks survive mobile app suspension and continue executing on desktop when the main application window is minimized to the system tray.
- **Scope & Resolution**:
  - **Windows (WP-016b) ✅ RESOLVED**: Configured Tauri tray icon, close-to-tray intercept (`api.prevent_close()` + `window.hide()`), persistent Tokio runtime and `OutboxScheduler`, and tray IPC triggers. Verified with 8 regression tests in `tests/security/windows-tray-lifecycle.test.ts`.
  - **Android (WP-016a) ✅ RESOLVED**: Android WorkManager `SyncWorker` implementation with `PeriodicWorkRequestBuilder` (15m interval, 5m flex), `NetworkType.CONNECTED` and `requiresBatteryNotLow(true)` constraints, and permission scoping in `AndroidManifest.xml`. Verified with 7 regression tests in `tests/security/android-lifecycle-governance.test.ts`.

### WP-018: Release Signing & Provenance ✅ RESOLVED (Optional Downstream Signing)

- **Objective**: Establish supply chain validation, artifact provenance, and production code signing.
- **Scope & Resolution**:
  - **Supply-Chain Security (WP-018a) ✅ RESOLVED**: Integrated `cargo audit` and `pnpm audit --prod` in CI (`.github/workflows/ci.yml`). Upgraded `drizzle-orm` to `^0.45.3` (0 CVEs).
  - **Code Signing (WP-018b/c/d)**:
    - Free Android Keystore: Automated release keystore extraction in CI with Gradle `signingConfigs.release` (WP-018c).
    - Free SLSA Provenance: Automated `actions/attest-build-provenance@v2` producing Sigstore in-toto attestations for all release artifacts (WP-018d).
    - Commercial Windows Authenticode: Classified as an optional downstream deployment capability requiring commercial CA credentials (WP-018b).

### WP-021: Build-Time Feature Permission Enforcement Gate ✅ RESOLVED

- **Objective**: Implement AST-based static source analysis to ensure all permission string literals or constants passed to `can()`, `require()`, or `requireTrusted()` in feature source code are strictly declared in the feature's `FeatureManifest`.
- **Scope & Resolution**:
  - **Scanner & Checker Tooling (`@tooling/feature-validator`)**: Implemented `scanFeaturePermissions` and `checkPermissionCoverage` using TypeScript Compiler API. Resolves constant references from `permissions.ts` and catches undeclared permissions with exact file paths and line numbers.
  - **CLI & Turborepo Task**: Created standalone CLI executable (`pnpm feature-validate`) with ANSI reporting, wired into `turbo.json` and root `pnpm verify`.
  - **CI Workflow**: Enforced in `.github/workflows/ci.yml` as a blocking gate before PR merge.
  - **Security Regression Suite**: 13 automated tests in `tests/security/feature-permission-governance.test.ts` covering constant resolution, string literals, negative cases, and manifest diffing.

### WP-022: Extensible Storage Maintenance & Data Pruning Subsystem ✅ RESOLVED

- **Objective**: Establish transaction-safe lifecycle compaction and pruning for accumulating operational, replication, and domain tables with SQLite page reclamation (VACUUM) without violating synchronization or authorization invariants.
- **Scope & Resolution**:
  - **Standalone Package (`@platform/maintenance`)**: Implemented pluggable `PruningHandler` SPI, `DeclarativeTablePruner` with SQL safety checks, `MaintenanceRegistry`, and `MaintenanceOrchestrator` supporting batch deletion, AbortSignal cooperative cancellation, and post-prune `VACUUM`.
  - **Core Handlers**: Implemented 5 platform table pruners adhering to the 5 Compaction Invariants:
    - `SyncOutboxPruner`: Strictly preserves `PENDING` and `FAILED` records; only removes `SENT` past retention cutoff.
    - `SyncInboxPruner`: Strictly preserves `PENDING` records; only removes `APPLIED`/`CONFLICT` outside the replay guard window.
    - `BackgroundTasksPruner`: Strictly preserves active `PENDING` and `RUNNING` tasks; only removes `COMPLETED`/`CANCELLED`.
    - `AuditEventsPruner`: Prunes operational audit events older than retention cutoff.
    - `ReplicatedTombstonePruner`: Strictly protects tombstones where `replicated_at IS NULL`; only prunes cluster-acknowledged tombstones past cutoff.
  - **Feature Extensibility & Background Execution**: Added optional `pruningPolicies` to `FeatureManifest` in `@platform/feature-system`, integrated `StorageMaintenanceWorker` in `@platform/tasks` for deduplicated background scheduling, and exposed `platform.runMaintenance()` and `platform.maintenance`.
  - **Security & Unit Verification**: Verified with 8 unit tests in `packages/maintenance/src/__tests__/maintenance.test.ts` and 5 security governance tests in `tests/security/storage-governance.test.ts` (Gate G-014).
  - **Diagnostics UI Integration**: Added live "Database Compaction & Data Pruning" card and registered pruners candidate table to `apps/demo/src/pages/DiagnosticsPage.tsx` with one-click manual execution.
