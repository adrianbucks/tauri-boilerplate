# Development Roadmap

This roadmap outlines the phased development sequence of the Tauri Boilerplate, prioritizing foundational security, persistence, and replication integrity before domain expansion.

---

## Roadmap Phases Overview

```text
Phase 1: Durable Local Platform                     [✅ COMPLETE]
Phase 2: Trusted Identity & Authentication          [✅ COMPLETE]
Phase 3: Authorization & Native Boundary            [✅ COMPLETE]
Phase 4: Replication Protocol & Persistence         [✅ COMPLETE]
Phase 5: Background Execution Subsystem             [✅ COMPLETE]
Phase 6: Hardening, P2P Transport & Downstream Adoption [✅ COMPLETE]
Phase 7: Product & Enterprise Expansion             [PLANNED]
```

---

## Phase Details

### Phase 1 — Durable Local Platform ✅ COMPLETE

- ✅ Implement native durable SQLite adapter (`rusqlite` via Tauri IPC) (WP-001).
- ✅ Enable and verify foreign key constraints and WAL journal mode (5 regression tests).
- ✅ Move core schema into platform-owned migrations applied in strict version order (WP-002).
- ✅ Enforce tenant-aware boundaries across all repositories (WP-003).

### Phase 2 — Trusted Identity & Authentication ✅ COMPLETE

- ✅ Implement native `DeviceKeyProvider` with authentic Ed25519 key generation (`crates/identity-core`) (WP-005).
- ✅ Persistent key custody in protected platform storage (`device_identity.key`).
- ✅ Offline credential verification using Argon2id with 5-failure lockout cooldown window (WP-006).
- ✅ Native-issued `TrustedOperationContext` derived exclusively from verified sessions (WP-004).

### Phase 3 — Authorization & Native Boundary ✅ COMPLETE

- ✅ Central authorization enforcement at all privileged service boundaries (`@platform/authorization`) (WP-007).
- ✅ Mandatory tenant scope and cross-tenant mutation rejection.
- ✅ Scoped Tauri capability matrix (`capabilities/default.json`) and native SQL safety filter (WP-009 / WP-020).
- ✅ 30+ security regression tests passing in `tests/security/`.

### Phase 4 — Replication Protocol & Persistence ✅ COMPLETE

- ✅ Canonical signed operation envelope with sorted-key serialization and Ed25519 signatures (WP-010).
- ✅ Mutual authenticated handshake with 32-hex nonce freshness and skew tolerance (WP-011).
- ✅ Durable SQLite replication queues (`core_sync_outbox`, `core_sync_inbox`) with transactional commit (WP-012).
- ✅ Deterministic conflict engine and soft-delete tombstones (WP-013).
- ✅ Native `iroh 1.2.0` QUIC live transport integration over custom ALPN (WP-014 / R-002).

### Phase 5 — Background Execution Subsystem ✅ COMPLETE

- ✅ Durable SQLite task queue (`core_tasks` schema) in `@platform/tasks` (WP-015).
- ✅ `TaskWorker` with cooperative cancellation and graceful shutdown.
- ✅ `OutboxSyncWorker` with jittered exponential backoff for transport retries.
- ✅ **Windows Background System Tray (WP-016b)**: Minimize-to-tray, persistent Tokio runtime & `OutboxScheduler`, tray context menu, `background://sync-now-requested` IPC trigger. Security suite: 8 tests in `windows-tray-lifecycle.test.ts`.
- ✅ **Android WorkManager Adapter (WP-016a)**: `SyncWorker` CoroutineWorker with `PeriodicWorkRequestBuilder` (15 min / 5 min flex), `NetworkType.CONNECTED` and `requiresBatteryNotLow(true)` constraints. Security suite: 7 tests in `android-lifecycle-governance.test.ts`.

### Phase 6 — Hardening, Transport & Release ✅ COMPLETE

- ✅ Secure import/export limits and CSV/XLSX formula injection protection (WP-017).
- ✅ Real live `iroh` P2P transport integration and verification (WP-014).
- ✅ Fine-grained Tauri capability governance and Invariant #8 validation (WP-020).
- ✅ Downstream adoption test via independent consumer application (`apps/minimal-consumer`, Gate G-12 passed) (WP-019).
- ✅ Supply-chain security audit automated in CI (`cargo audit` and `pnpm audit --prod`) (WP-018a).
- ✅ Native OS lifecycle background execution adapter for Android (`SyncWorker` + WorkManager) (WP-016a).
- ✅ Free Android release keystore automated in CI via Gradle `signingConfigs.release` (WP-018c).
- ✅ SLSA Level 3 provenance attestations via `actions/attest-build-provenance@v2` (WP-018d).
- ✅ Production P2P relay infrastructure policy documented and decided (ADR-030 / R-009).
- ✅ Native diagnostics UI with live SQLite telemetry, Ed25519 device identity, iroh Node ID, and interactive P2P peer connection controls.
- ✅ Build-time feature permission enforcement gate (WP-021 / Gate G-013) with AST scanner, CLI, and 13 security regression tests.
- ⚙️ Windows Authenticode signing remains an optional downstream enterprise feature (WP-018b).

### Phase 7 — Product & Enterprise Expansion [FUTURE]

- Hardware integrations (camera barcode scanning, native RFID).
- Transparent SQLite database encryption (SQLCipher) once key management is established.
- Advanced CRDT convergence policies for real-time collaborative text editing.
- Self-hosted DERP relay fleet orchestration and monitoring.
