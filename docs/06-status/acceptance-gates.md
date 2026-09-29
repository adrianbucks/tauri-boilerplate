# Acceptance Gates & Verification Register

A subsystem or release is considered production-ready only when its corresponding acceptance gates have passed with concrete test evidence.

---

## Acceptance Gates Matrix

| Gate | Focus Area | Status | Verification Criteria & Evidence |
| :--- | :--- | :--- | :--- |
| **G-01** | Durable Storage | ✅ PASS | Data survives process close/reopen; `PRAGMA foreign_keys = ON`; `PRAGMA journal_mode = WAL`; integrity checks pass. 5 regression tests in `crates/native-core`. |
| **G-02** | Trusted Identity | ✅ PASS | Ed25519 keypair generated natively; private key never reaches JS or SQLite; persistent protected seed file. 4 tests in `crates/identity-core`. |
| **G-03** | Authentication | ✅ PASS | Argon2id verification; 5-failure lockout cooldown; native-issued sessions; user logout does not revoke device identity. Tests in `crates/native-core` and `@tests/security`. |
| **G-04** | Authorization / Tenancy | ✅ PASS | Every privileged mutation checks permissions; `organisationId` scope mandatory; cross-tenant queries rejected. 19 tests in `tests/security/`. |
| **G-05** | Native Boundary | ✅ PASS | Capabilities scoped to specific windows; typed commands; SQL safety guard blocks dangerous PRAGMAs; strict CSP without inline eval. `tauri-capability-governance.test.ts`. |
| **G-06** | Sync Protocol | ✅ PASS | Canonical deterministic serialization; mutual Ed25519 signatures; 32-hex nonce freshness; 30s skew window; 7 admission layers enforced. Tests in `packages/sync-protocol`. |
| **G-07** | Replication Durability | ✅ PASS | Atomic transactional enqueue into `core_sync_outbox`; idempotent receive via `core_sync_inbox`; crash recovery preserves state. Tests in `packages/sync`. |
| **G-08** | Convergence | ✅ PASS | Deterministic HLC-based LWW; additive guard prevents corruption of absolute fields; soft-delete tombstones prevent resurrection. `ConflictEngine.test.ts`. |
| **G-09** | Background Execution | 🚧 PARTIAL | Durable SQLite task queue, TaskWorker, OutboxSyncWorker passing (33 tests). Native Android WorkManager and Windows Task Scheduler adapters pending (WP-016). |
| **G-10** | Import / Export / Hardware | ✅ PASS | 10MB/10k row bounds enforced; CSV formula injection neutralized; keyboard-wedge scanner detects inter-key timing bursts. Tests in `packages/import-export`. |
| **G-11** | Release & Distribution | 🚧 PARTIAL | CI builds unsigned Windows MSI/NSIS and Android APKs; reproducible pnpm lockfile. Production code signing and checksum publication pending (WP-018). |
| **G-12** | Downstream Adoption | ✅ PASS | Secondary independent application (`apps/minimal-consumer`) consumes `@platform/*` with zero platform modifications. Field Notes domain verified (WP-019). |
