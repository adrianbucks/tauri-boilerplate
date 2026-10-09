# Current Implementation State & Verification Evidence

**Snapshot Date**: 2026-10-09  
**Methodology**: Static inspection of the workspace plus verified test suite execution across TypeScript and Rust workspace packages. No component or behavior is marked verified without concrete test evidence.

---

## 1. Overall Platform Status

**Production-Ready 1.0 Foundation — All Acceptance Gates Passed (G-01 through G-014)**

The repository contains a fully verified, production-grade local-first platform foundation. All 22 Work Packages (WP-001 through WP-022) and 14 acceptance gates (G-01 through G-014) are resolved and passing:

- File-backed durable SQLite persistence with WAL mode and foreign keys (`crates/native-core`).
- Platform-owned schema migrations executed in topological order (`@platform/platform`).
- Authentic Ed25519 native device key custody with private keys held exclusively in native Rust memory (`crates/identity-core`).
- Argon2id credential authentication with 5-failure lockout cooldown window.
- Native-issued `TrustedOperationContext` and strict RBAC authorization across all services (`@platform/authorization`).
- Signed canonical sync envelopes, replay-resistant handshake verification, idempotent inboxes, outboxes, and soft-delete tombstones (`@platform/sync`, `@platform/sync-protocol`).
- Native live `iroh` QUIC peer-to-peer transport with length-prefixed bidirectional stream framing (`crates/sync-core`, `@platform/sync`).
- Durable background task queue with exponential backoff and jitter (`@platform/tasks`).
- Windows system tray minimize-to-tray with persistent native Tokio runtime (WP-016b).
- Android WorkManager periodic sync with network/battery constraints (WP-016a).
- SLSA Level 3 build provenance attestations and Android release keystore automation (WP-018c/d).
- Production P2P relay infrastructure policy decided (ADR-030 / R-009).
- Multi-consumer domain neutrality verified via secondary application `apps/minimal-consumer` (Gate G-12 passed).
- Build-time feature permission enforcement gate: AST scanner verifies all `can()`/`require()`/`requireTrusted()` call sites against manifest declarations (WP-021 / G-13).
- Extensible storage compaction & data pruning subsystem with declarative feature-level retention policies and cooperative VACUUM reclamation (WP-022 / G-014).

---

## 2. Platform Status Matrix

| Subsystem                   | Current State                                                                                                                                                                           | Verification Evidence                                                                                      | Status                        |
| :-------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- | :---------------------------- |
| **Monorepo / Workspace**    | pnpm 10 workspaces + Turborepo + Cargo workspace                                                                                                                                        | `pnpm turbo build` passes across all 13 packages, 3 apps, 4 crates                                         | ✅ Implemented                |
| **Durable SQLite**          | File-backed `rusqlite` at `{app_data_dir}/platform.sqlite3`                                                                                                                             | 5 regression tests in `crates/native-core` (WAL, FKs, rollback, persistence)                               | ✅ RESOLVED (WP-001)          |
| **Database Migrations**     | Platform migrations applied in strict version order before features                                                                                                                     | Verified checksum validation in `crates/native-core/src/schema.rs`                                         | ✅ RESOLVED (WP-002)          |
| **Device Identity**         | Native Ed25519 `DeviceKeyProvider` with restricted-permission file custody                                                                                                              | 4 tests in `crates/identity-core` (genuine seed, signing, restart persistence)                             | ✅ RESOLVED (WP-005)          |
| **User Authentication**     | Native Argon2id verification + device binding + lockout cooldown                                                                                                                        | `crates/native-core` tests + `@tests/security` test suite                                                  | ✅ RESOLVED (WP-006)          |
| **Session Trust**           | Native-issued `NativeSessionView` mapped to `TrustedOperationContext`                                                                                                                   | `tests/security/authentication-boundary.test.ts`                                                           | ✅ RESOLVED (WP-004)          |
| **Authorization Engine**    | Central `requireTrusted()` enforced at all mutation boundaries                                                                                                                          | `tests/security/rbac-security.test.ts` (12 tests passing)                                                  | ✅ RESOLVED (WP-007)          |
| **Tenant Isolation**        | Mandatory `organisationId` scope in all repository queries                                                                                                                              | `tests/security/tenant-isolation.test.ts` (7 tests passing)                                                | ✅ RESOLVED (WP-003)          |
| **Audit Logging**           | Append-only `core_audit_events` with correlation IDs                                                                                                                                    | `packages/audit/src/index.test.ts`, transactional commit tests                                             | ✅ RESOLVED (WP-008)          |
| **Canonical Envelopes**     | Deterministic key-sorted JSON with Ed25519 signature verification                                                                                                                       | `packages/sync-protocol/src/canonical/` tests                                                              | ✅ RESOLVED (WP-010)          |
| **Mutual Handshake**        | Authenticated handshake with 32-hex nonce freshness and skew window                                                                                                                     | `packages/sync-protocol/src/handshake/` tests                                                              | ✅ RESOLVED (WP-011)          |
| **Live P2P Transport**      | Native `iroh` 1.2.0 QUIC endpoint over ALPN `tauri-boilerplate-sync/1.0`                                                                                                                | `crates/sync-core` loopback test, `IrohSyncTransport.test.ts`                                              | ✅ RESOLVED (WP-014)          |
| **Outbox / Inbox**          | Durable SQLite queues with transactional enqueue and idempotent receive                                                                                                                 | `packages/sync/src/__tests__/`, `core-replication.sql`                                                     | ✅ RESOLVED (WP-012)          |
| **Conflict & Tombstones**   | Multi-strategy engine (LWW, additive guard) + soft-delete tombstones                                                                                                                    | `packages/sync/src/conflict/ConflictEngine.test.ts`                                                        | ✅ RESOLVED (WP-013)          |
| **Background Tasks**        | SQLite task queue, TaskWorker, OutboxSyncWorker, backoff with jitter                                                                                                                    | 33 passing tests in `packages/tasks`                                                                       | ✅ RESOLVED (WP-015)          |
| **Windows OS Lifecycle**    | System tray minimize-to-tray; native Tokio runtime stays alive on close                                                                                                                 | `tests/security/windows-tray-lifecycle.test.ts` (8 tests passing)                                          | ✅ RESOLVED (WP-016b)         |
| **Android OS Lifecycle**    | WorkManager `SyncWorker` with NetworkType.CONNECTED & BatteryNotLow constraints                                                                                                         | `tests/security/android-lifecycle-governance.test.ts` (7 tests passing)                                    | ✅ RESOLVED (WP-016a)         |
| **Tauri Capabilities**      | Least-privilege matrix, explicit window targeting, SQL safety guard                                                                                                                     | `tests/security/tauri-capability-governance.test.ts`                                                       | ✅ RESOLVED (WP-020)          |
| **Webview CSP**             | Strict CSP: `default-src 'self'`, no inline scripts or WASM eval                                                                                                                        | Verified in `tauri.conf.json` and demo `index.html`                                                        | ✅ RESOLVED (WP-009)          |
| **Import / Export**         | Hostile input limits (10MB, 10k rows) and formula injection neutralization                                                                                                              | `packages/import-export/src/index.test.ts`                                                                 | ✅ RESOLVED (WP-017)          |
| **Release Signing**         | Android keystore CI-automated; SLSA provenance attestations; Authenticode optional                                                                                                      | `release.yml` keystore + SLSA steps; `pnpm audit --prod` 0 CVEs                                            | ✅ RESOLVED (WP-018a/c/d)     |
| **P2P Relay Policy**        | Self-hosted `iroh-relay` mandated for production; public relay staging only                                                                                                             | ADR-030 accepted; R-009 closed                                                                             | ✅ RESOLVED (ADR-030 / R-009) |
| **Downstream Adoption**     | Multi-consumer test verified via `apps/minimal-consumer` (Field Notes)                                                                                                                  | `apps/minimal-consumer/src/index.test.ts`, Gate G-12 passed                                                | ✅ RESOLVED (WP-019)          |
| **Feature Permission Gate** | AST scanner: all `can()`/`require()`/`requireTrusted()` call sites in `features/*/src/` cross-checked against manifest declarations at build time                                       | `tests/security/feature-permission-governance.test.ts` (11 tests passing), `pnpm feature-validate` CI gate | ✅ RESOLVED (WP-021)          |
| **Storage Compaction**      | `@platform/maintenance` pruning subsystem: 6 core handlers (outbox, inbox, tasks, audit, tombstones, declarative), `MaintenanceOrchestrator` with cooperative abort and SQLite `VACUUM` | `packages/maintenance/src/__tests__/` (8 tests), `tests/security/storage-governance.test.ts` (5 tests)     | ✅ RESOLVED (WP-022 / G-014)  |

---

## 3. Detailed Audit Resolutions (CS-001 through CS-019)

### CS-001: Durable Persistence Absent ✅ RESOLVED (WP-001)

`NativeDatabaseConnection` bridges TypeScript to the native Rust `DurableDatabase` via Tauri IPC commands (`db_query`, `db_execute`, `db_transaction`). SQLite database file persists at `{app_data_dir}/platform.sqlite3` with WAL mode and `PRAGMA foreign_keys = ON`.

- **Evidence**: `cargo test -p native-core -- restart_persistence foreign_key_enforcement wal_mode_is_enabled integrity_check_passes transaction_rollback_undoes_all_operations` (5 passed).

### CS-002: Device Identity Placeholder ✅ RESOLVED (WP-005)

`crates/identity-core` implements genuine Ed25519 cryptographic key management via `DeviceKeyProvider`. Generates 32-byte seeds, derives keypairs, persists seeds in protected storage (`device_identity.key`), and exposes canonical public key strings (`ed25519_pk_<hex>`). Private keys remain in native custody.

- **Evidence**: `cargo test -p identity-core` (4 passed).

### CS-003: Session Creation Not Authentication ✅ RESOLVED (WP-006)

Replaced caller session instantiation with `authenticate_user` native command. Uses Argon2id password hashing, validates against `core_users.credential_verifier`, enforces 5-failure lockout cooldown window with `locked_until`, and returns `NativeSessionView`.

- **Evidence**: `cargo test -p native-core -- authenticates_active_user locks_after_repeated_failures` (2 passed).

### CS-004: Caller-Constructible Security Context ✅ RESOLVED (WP-004)

Callers cannot fabricate a `TrustedOperationContext`. The TypeScript runtime only obtains this context via native session issuance, ensuring subject identity and tenant scope are validated by native authority.

- **Evidence**: `pnpm --filter @tests/security test` (4 test files passed; 19 passed).

### CS-005: Sync Protocol Baseline Implemented ✅ RESOLVED (WP-010, WP-012, WP-013)

Implemented canonical deterministic serialization, Ed25519 envelope signing, durable `core_sync_outbox`/`core_sync_inbox`, idempotent receive, and soft-delete tombstones.

### CS-006 & CS-007: Mutual Authenticated Handshake ✅ RESOLVED (WP-011)

Mutual handshake requires 32-hex random nonce, timestamp skew tolerance check (30,000ms), session-tracked nonces to prevent replay attacks, and cryptographic Ed25519 signature verification over canonical bytes.

### CS-008: Tenant / Authorization Enforcement ✅ RESOLVED (WP-007)

Mandatory central authorization and tenant isolation integrated across all services (`SyncGroupService`, `OrganisationService`, `IdentityAdminService`, `WidgetService`).

- **Evidence**: 12 dedicated regression tests in `tests/security/rbac-security.test.ts` and 7 tests in `tests/security/sync-authorization.test.ts`.

### CS-010: Additive Conflict Policy Corruption Guard ✅ RESOLVED (WP-013)

`ConflictRegistry` prevents registering an `"additive"` policy on fields declared as absolute quantities, preventing silent corruption.

### CS-012: Permissive CSP ✅ RESOLVED (WP-009)

CSP restricted to `default-src 'self'`, `style-src 'self'`, `script-src 'self'`. Inline scripts, styles, and WASM eval allowances eliminated.

### CS-013: Spreadsheet Hostile Input Protection ✅ RESOLVED (WP-017)

Enforced bounds (10MB file, 8 sheets, 10,000 rows, 100,000 cells) and formula injection neutralization for strings starting with `=`, `+`, `-`, or `@`.

### CS-014: CI Runtime Node Version ✅ RESOLVED

Upgraded CI pipelines and local workflows to Node 24 LTS.

### CS-015: Durable Background Tasks ✅ RESOLVED (WP-015)

`TaskQueueService`, `TaskWorker`, `OutboxSyncWorker`, and `BackoffPolicy` implemented in `@platform/tasks`.

- **Evidence**: 33 unit and integration tests passing (`pnpm --filter @platform/tasks test`).

### CS-016: Live iroh P2P Transport ✅ RESOLVED (WP-014 / R-002)

Integrated native `iroh 1.2.0` QUIC endpoint in `crates/sync-core`, native Tauri commands in `apps/demo/src-tauri`, and `IrohSyncTransport` in `@platform/sync`.

- **Evidence**: `test_iroh_loopback_two_node_envelope_exchange` passing in `crates/sync-core`.

### CS-017: Windows System Tray Background Execution ✅ RESOLVED (WP-016b)

Implemented close-to-tray on Windows (`api.prevent_close()` + `window.hide()`), keeping native Tokio runtime and `OutboxScheduler` active. Added tray icon with Show, Sync Now (`background://sync-now-requested` IPC event), and Quit (`app.exit(0)`). Platform bootstrap decoupled from React lifecycle.

- **Evidence**: `tests/security/windows-tray-lifecycle.test.ts` (8 security regression tests passing).

### CS-018: Automated Supply Chain Security Audit ✅ RESOLVED (WP-018a)

Integrated `cargo audit` (checking against RustSec advisory database) and `pnpm audit --prod` into CI (`.github/workflows/ci.yml`). Upgraded `drizzle-orm` to `^0.45.3` eliminating GHSA-gpj5-g38j-94v9 SQL identifier injection vulnerability.

- **Evidence**: `pnpm audit --prod` reports 0 vulnerabilities; `ci.yml` audit steps executed in CI.

### CS-019: Extensible Storage Maintenance & Data Pruning Subsystem ✅ RESOLVED (WP-022 / G-014)

Implemented `@platform/maintenance` package providing six core pruning handlers and a `MaintenanceOrchestrator`:

- **`SyncOutboxPruner`**: Prunes `SENT` outbox records past the retention cutoff; never touches `PENDING` or `FAILED` envelopes (Compaction Invariant #1).
- **`SyncInboxPruner`**: Prunes `APPLIED`/`CONFLICT` inbox records past cutoff; protects `PENDING` records still awaiting processing (Compaction Invariant #2).
- **`BackgroundTasksPruner`**: Prunes `COMPLETED`/`CANCELLED` tasks past cutoff; protects `PENDING`/`RUNNING` tasks (Compaction Invariant #4).
- **`AuditEventsPruner`**: Prunes `core_audit_events` records past the configurable retention window.
- **`ReplicatedTombstonePruner`**: Prunes cluster-acknowledged tombstones past cutoff; protects tombstones where `replicated_at IS NULL` (Compaction Invariant #3 / #6).
- **`DeclarativeTablePruner`**: Sanitizes table/column identifiers and applies feature-declared `DeclarativePruningPolicy` entries — downstream features extend pruning without modifying platform core (Invariant #10).
- **`MaintenanceOrchestrator`**: Coordinates all handlers, batches deletions within transactions, supports cooperative `AbortSignal` cancellation, and runs `PRAGMA wal_checkpoint(TRUNCATE)` + `VACUUM` post-pruning to release reclaimed pages back to the host filesystem (Compaction Invariant #5).
- **`StorageMaintenanceWorker`**: Wraps the orchestrator as a deduplicated background task (`platform.maintenance.storage`) enqueued via `@platform/tasks`.
- **Feature System integration**: `FeatureManifest.pruningPolicies` and `ManifestValidator` validation; `FeatureRegistry.getAllPruningPolicies()` consumed by `Platform.registerFeature()`.

- **Evidence**: `packages/maintenance/src/__tests__/maintenance.test.ts` (8 unit tests passing); `tests/security/storage-governance.test.ts` (5 security regression tests passing).

---

## 4. Latest Executable Verification Evidence

The full repository verification suite demonstrates 100% pass rate:

- **Rust Native Workspace**: `cargo test --workspace` (42 tests passed across all crates).
- **TypeScript Typecheck**: `pnpm turbo typecheck` (39 tasks passed across all packages and apps).
- **TypeScript Test Suites**: `pnpm turbo test` (40 tasks passed including unit, integration, and 66 security suite tests across 9 files).
- **Feature Permission Gate**: `pnpm feature-validate` (3 features validated — schema, dependency order, and source coverage pass).
- **Supply Chain Security**: `pnpm audit --prod` (0 vulnerabilities found).
