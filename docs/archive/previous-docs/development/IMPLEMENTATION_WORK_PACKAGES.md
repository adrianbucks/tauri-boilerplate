# Implementation Work Packages

Work packages are intentionally ordered by dependency and risk.

# Implementation Work Packages

Work packages are ordered by dependency and risk. Each work package defines its current implementation status, verification evidence, and future development requirements.

---

## WP-001 Durable SQLite Adapter ✅ RESOLVED

Implement native durable storage, configuration, and health verification.
- **Implemented in**: `crates/native-core/src/database.rs`, `packages/database/src/connection/NativeDatabaseConnection.ts`, `apps/demo/src-tauri/src/lib.rs`
- **Verification Evidence**: 5 regression tests in `crates/native-core`: `restart_persistence_survives_close_and_reopen`, `foreign_key_enforcement_prevents_orphaned_records`, `wal_mode_is_enabled`, `integrity_check_passes`, `transaction_rollback_undoes_all_operations`.
- **Status**: Production-ready durable storage at `{app_data_dir}/platform.sqlite3`.

## WP-002 Core Migration Authority ✅ RESOLVED

Move platform schema creation into platform-owned migrations.
- **Implemented in**: `packages/platform/src/migrations/`, applied by `crates/native-core/src/schema.rs` and `@platform/platform`.
- **Verification Evidence**: `core-schema.sql`, `core-authentication.sql`, `core-replication.sql` applied in strict version order with checksum validation. Demo contains no manual table creation.

## WP-003 Tenant-Aware Repositories ✅ RESOLVED

Remove unrestricted tenant queries and allowlist dynamic SQL identifiers.
- **Implemented in**: `packages/database/src/repository/BaseRepository.ts`, `features/example-feature`, `features/organisations`.
- **Verification Evidence**: `tests/security/tenant-isolation.test.ts` (7 passing tests), mandatory `organisationId` scope in repository queries and mutations.

## WP-004 Trusted Operation Context ✅ RESOLVED

Introduce native/session-issued principal and remove caller authority over user/device/org identity.
- **Implemented in**: `packages/core/src/context/`, `packages/identity/src/UserSessionService.ts`.
- **Verification Evidence**: `tests/security/authentication-boundary.test.ts`. `TrustedOperationContext` can only be derived from a validated native session, never constructed by untrusted callers.

## WP-005 Device Key Provider ✅ RESOLVED

Implement real cryptographic identity with protected native custody.
- **Implemented in**: `crates/identity-core/src/key_provider.rs`, `crates/crypto-core`.
- **Verification Evidence**: 4 tests in `crates/identity-core`: genuine Ed25519 seed generation, signature verification, restart persistence with protected keyfile (`device_identity.key`), binding to `core_devices`.

## WP-006 Offline Authentication / Session Lifecycle ✅ RESOLVED

Implement credential verification, lockout, expiry, revocation, switching, and recovery.
- **Implemented in**: `crates/native-core/src/database.rs` (`authenticate_user`), `packages/identity`.
- **Verification Evidence**: Argon2id password verifiers, 5-failure lockout cooldown window, verified session views, and security regression tests in `@tests/security`.

## WP-007 Authorization Enforcement ✅ RESOLVED

Require permission/scope checks at every privileged service boundary.
- **Implemented in**: `packages/authorization`, `features/organisations`, `features/identity-admin`, `features/example-feature`.
- **Verification Evidence**: `tests/security/rbac-security.test.ts` (12 tests) and `tests/security/sync-authorization.test.ts` (7 tests). Central `authorization.requireTrusted()` enforced at all mutation boundaries.

## WP-008 Typed Native Gateway ✅ RESOLVED

Expose typed native operations only; remove arbitrary database/native authority from the webview.
- **Implemented in**: `apps/demo/src-tauri/src/lib.rs` (`authenticate_user`, `logout_user`, `get_device_identity`, `get_database_health`, `list_widgets`, `create_widget`, `list_organisations`, `create_organisation`).
- **Verification Evidence**: Commands validated in Rust with session and role permission enforcement.

## WP-009 Tauri Capability / CSP Hardening ✅ RESOLVED

Create narrowly scoped capabilities and minimise CSP allowances.
- **Implemented in**: `apps/demo/src-tauri/capabilities/default.json`, `apps/demo/index.html`.
- **Verification Evidence**: CSP restricted to `default-src 'self'`, `style-src 'self'`, `script-src 'self'`. No inline script, inline style, or WASM eval allowances.

## WP-010 Canonical Sync Envelope ✅ RESOLVED

Define deterministic serialization, hashing/signature input, and version negotiation.
- **Implemented in**: `packages/sync-protocol/src/envelope/`, `packages/sync-protocol/src/canonical/`.
- **Verification Evidence**: Deterministic sorted-key JSON serialization, Ed25519 signature validation over canonical envelope bytes, envelope version validation.

## WP-011 Authenticated Handshake ✅ RESOLVED

Implement nonce/freshness, peer-key verification, application/protocol negotiation, and replay protection.
- **Implemented in**: `packages/sync-protocol/src/handshake/`, `packages/sync/src/pairing/PairingService.ts`.
- **Verification Evidence**: 32-hex random nonce freshness, 30-second timestamp skew window, replay protection via seen-nonce tracking, cryptographic signature check.

## WP-012 Durable Outbox / Inbox ✅ RESOLVED

Persist outbound operations atomically with business mutations; make inbound apply idempotent.
- **Implemented in**: `packages/sync/src/outbox/OutboxService.ts`, `packages/sync/src/inbox/InboxService.ts`, `core_sync_outbox` & `core_sync_inbox` tables in `core-replication.sql`.
- **Verification Evidence**: Transactional enqueue with business state, `ON CONFLICT (envelope_id) DO NOTHING` idempotency, HLC logical timestamp ordering.

## WP-013 Conflict / Tombstone Engine ✅ RESOLVED

Implement explicit per-entity policies and replication-safe deletion.
- **Implemented in**: `packages/sync-protocol/src/conflicts/ConflictRegistry.ts`, `packages/sync/src/conflict/ConflictEngine.ts`, `packages/sync/src/tombstone/TombstoneService.ts`.
- **Verification Evidence**: Absolute LWW guard preventing additive policy on absolute quantities; soft-delete tombstone engine recording `deleted_at`, `deleted_by`, and `delete_operation_id`.

## WP-014 Real iroh Transport ✅ RESOLVED

Integrate real peer-to-peer transport using iroh Endpoint/QUIC.
- **Implemented in**:
  - `crates/sync-core`: `IrohSyncEndpoint` with native `iroh 1.2.0`, ALPN `tauri-boilerplate-sync/1.0`, framed length-prefixed bidirectional QUIC streams, 1-byte ACK handshakes, and background listener.
  - `apps/demo/src-tauri`: Native Tauri commands (`sync_start_endpoint`, `sync_connect_peer`, `sync_disconnect_peer`, `sync_send_envelope`, `sync_is_connected`) with `SyncState`.
  - `packages/sync`: `IrohSyncTransport` implementing canonical `SyncTransport` contract via Tauri IPC and event listener dispatch.
- **Verification Evidence**:
  - `crates/sync-core`: `test_iroh_loopback_two_node_envelope_exchange` validates full two-node local loopback envelope exchange and bidirectional confirmation over QUIC.
  - `packages/sync`: `IrohSyncTransport.test.ts` (100% pass) verifying endpoint init, connection mapping, envelope framing, and event listener lifecycle.
  - `tests/security`: `sync-authorization.test.ts` verifying Invariant #4 (strict inbox verification of live transport envelopes) and Invariant #5 (zero private key leakage).
  - Research Gate R-002 resolved and ADR-012 accepted.
- **Future Development Needed**:
  - Multi-device NAT traversal / Derp relay benchmarking in physical staging environments across Windows/Android.

## WP-015 Background Task Subsystem ✅ RESOLVED

Persist task state, retry, and cancellation semantics.
- **Implemented in**: `packages/tasks` (`TaskQueueService`, `TaskWorker`, `OutboxSyncWorker`, `BackoffPolicy`).
- **Verification Evidence**: 33 unit and integration tests passing (`pnpm --filter @platform/tasks test`).

## WP-016 Android / Windows OS Lifecycle Adapters 🚧 OPEN

Implement platform lifecycle integration and process/reboot recovery tests.
- **Current State**: Task worker operates within node/browser/Tauri runtime loop.
- **Future Development Needed**:
  1. **WP-016a (Android)**: Implement Android WorkManager native plugin/service bridging background sync requests across process death and reboots.
  2. **WP-016b (Windows)**: Implement Windows background task registration / service mechanism ensuring sync continues when main window is closed.

## WP-017 Import / Export Hardening ✅ RESOLVED

Add resource limits, hostile input validation, and safe export behavior.
- **Implemented in**: `packages/import-export`.
- **Verification Evidence**: Size limits (10 MiB, 8 sheets, 10k rows, 100k cells), 5-second execution timeout, CSV/XLSX formula injection neutralization.

## WP-018 Release Hardening 🚧 OPEN

Signing, provenance, dependency checks, artifact verification, and supported-runtime enforcement.
- **Current State**: CI runs Node 24 LTS and checks tests/builds.
- **Future Development Needed**:
  1. Configure Windows code signing (Authenticode) and Android APK/AAB signing (keystore).
  2. Implement build artifact checksum generation and provenance attestation.
  3. Supply-chain security checks (`pnpm audit`, `cargo audit`) integrated into CI.

## WP-019 Downstream Adoption Test ✅ RESOLVED

Build a second minimal application to prove the platform/domain boundary and validate Gate G-12 & Invariant #10.
- **Implemented in**:
  - `apps/minimal-consumer/package.json`: Secondary consumer application consuming purely `@platform/*` libraries without referencing `@apps/demo` or `@features/*`.
  - `apps/minimal-consumer/src/notes/`: Field Notes domain feature (`notes-schema.sql`, `NotesTypes.ts`, `NotesRepository.ts`, `NotesManifest.ts`, `NotesService.ts`) with custom permissions, migrations, LWW sync policy, atomic outbox replication, and soft-delete tombstones.
  - `apps/minimal-consumer/src-tauri/`: Standalone Tauri application crate (`minimal-consumer-native`) with narrow capability definitions, application-scoped identity namespace (`com.tauri.boilerplate.minimal-consumer`), and feature-owned migration runners.
- **Verification Evidence**:
  - `apps/minimal-consumer/src/index.test.ts`: Integration test verifying platform initialization without demo features, non-existence of `widgets` table, RBAC-guarded note creation, atomic `core_sync_outbox` recording, and soft-delete tombstone recording.
  - `apps/minimal-consumer/src-tauri/src/lib.rs`: Rust unit test suite (`identity_namespace_is_application_owned`, `notes_feature_migration_keeps_feature_ownership`, `isolation_test_does_not_contain_demo_features`).
  - Full workspace tests (`cargo test --workspace` 39 tests passing, `pnpm typecheck` 38 tasks passing, `pnpm test` 37 tasks passing).
- **Status**: Production-ready downstream consumer adoption verified; Gate G-12 passed; Invariant #10 preserved.

## WP-020 Fine-Grained Tauri Capability Governance ✅ RESOLVED

Audit and harden Tauri IPC command capabilities to absolute least-privilege.
- **Implemented in**:
  - `apps/demo/src-tauri/capabilities/default.json`: Scoped least-privilege capability `main-window` with explicit justification, granting only `core:event:allow-listen` and `core:event:allow-unlisten` to the `main` window.
  - `crates/native-core/src/database.rs`: Native SQL safety filter `validate_safe_sql` rejecting dangerous PRAGMAs, ATTACH/DETACH, and VACUUM INTO over the client database bridge.
  - `docs/architecture/TAURI_CAPABILITY_MATRIX.md`: Complete command-to-capability governance matrix.
- **Verification Evidence**:
  - `tests/security/tauri-capability-governance.test.ts`: Regression suite verifying Invariant #8 compliance (mandatory justification, explicit window bindings, no blanket plugin grants, strict CSP).
  - `crates/native-core/src/database.rs`: `sql_safety_guard_blocks_hostile_pragmas_and_attachments` test.
- **Status**: Production-ready least-privilege IPC boundary.
