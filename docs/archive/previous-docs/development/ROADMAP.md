# Development Roadmap

The order below deliberately resolves security/durability foundations before broad feature expansion.

## Phase 0 — Documentation and baseline

- adopt this canonical docs directory;
- archive superseded docs manually under `docs/archive/`;
- establish status/ADR/research update discipline;
- move CI from EOL Node 20 to supported LTS.

## Phase 1 — Durable local platform ✅ COMPLETE

- ✅ implement native durable SQLite adapter (WP-001);
- ✅ enable/verify foreign keys and journal/WAL policy (5 regression tests);
- ✅ move core schema into platform-owned migrations (WP-002);
- ✅ harden repository tenant boundaries (WP-003);
- ✅ make migration tests cover fresh/upgrade/checksum failure/recovery;
- ✅ remove demo-owned platform table creation.

**Evidence**: See [docs/verification/CURRENT_STATE.md](../verification/CURRENT_STATE.md) — CS-001 RESOLVED with restart persistence, FK enforcement, WAL/journal, and integrity check tests passing. Full completion details in [PHASE_1_COMPLETION.md](../verification/PHASE_1_COMPLETION.md).

## Phase 2 — Trusted identity and authentication ✅ COMPLETE

- ✅ implement native key-provider abstraction with Ed25519 (`DeviceKeyProvider` in `crates/identity-core`) (WP-005);
- ✅ generate real cryptographic device identity with restricted-permission file custody (WP-005);
- ✅ bind native identity to persistent device record in `core_devices` (WP-005);
- ✅ implement offline credential verification with Argon2id and 5-failure lockout cooldown window (WP-006 / CS-003);
- ✅ implement session lifecycle and native-issued `TrustedOperationContext` (WP-004 / CS-004);
- ✅ separate device revocation from user logout;
- ✅ shared-device switching and recovery foundations.

**Evidence**: See [docs/verification/CURRENT_STATE.md](../verification/CURRENT_STATE.md) — CS-002, CS-003, and CS-004 RESOLVED with tests in `crates/identity-core`, `crates/native-core`, and `@tests/security`.

## Phase 3 — Authorization and native boundary ✅ COMPLETE

- ✅ require central authorization at all privileged service boundaries (`packages/authorization`, `features/*`) (WP-007);
- ✅ make tenant scope mandatory with cross-tenant mutation rejection across all services (WP-007 / CS-008);
- ✅ introduce typed native gateway via Tauri commands (`authenticate_user`, `db_*`, `list/create_widgets`, `list/create_organisations`) (WP-008);
- ✅ harden Tauri capabilities and demo CSP (`default-src 'self'`, no inline scripts or WASM eval) (WP-009 / CS-012);
- ✅ comprehensive security regression test suite in `tests/security/` (30+ security regression tests passing) (CS-008).

**Evidence**: See [docs/verification/CURRENT_STATE.md](../verification/CURRENT_STATE.md) — CS-008, CS-011, and CS-012 RESOLVED.

## Phase 4 — Replication protocol and persistence ✅ COMPLETE

- ✅ implement canonical signed operation envelope with sorted-key UTF-8 serialization and Ed25519 signatures (WP-010 / CS-005);
- ✅ implement authenticated handshake with nonce freshness, timestamp skew window, and signature verification (WP-011 / CS-006);
- ✅ implement durable SQLite replication queues (`core_sync_outbox`, `core_sync_inbox`) with transactional atomic commit and idempotent receive (WP-012 / CS-005);
- ✅ implement tombstone propagation and replication-safe soft deletions (`deleted_at`, `deleted_by`, `delete_operation_id`) (WP-013 / CS-005);
- ✅ implement deterministic conflict policies (`ConflictRegistry`, `ConflictEngine`) with explicit guards preventing additive policies on absolute quantities (WP-013 / CS-010);
- ✅ resolve iroh P2P transport research gate (R-002 / ADR-012) and build real live transport endpoint (`IrohSyncEndpoint`, `IrohSyncTransport`) with loopback and security regression tests (WP-014 / CS-016).

**Evidence**: See [docs/verification/CURRENT_STATE.md](../verification/CURRENT_STATE.md) — CS-005, CS-006, CS-007, CS-010, and CS-016 RESOLVED.

## Phase 5 — Background execution 🚧 PARTIALLY COMPLETE

- ✅ implement durable task subsystem (`@platform/tasks`) backed by SQLite with state transitions, concurrency limits, and retry policies (WP-015 / CS-015);
- ✅ implement `TaskWorker` with graceful shutdown, timeouts, and cancellation tokens (WP-015);
- ✅ implement `OutboxSyncWorker` polling outbox batches, handling transport transmission and backoff (WP-015);
- ✅ exponential backoff with jitter to eliminate thundering herd behavior (WP-015);
- 🚧 **Open Gate**: WP-016 — Implement native OS lifecycle adapters: Android WorkManager adapter and Windows background task/scheduling adapter.

**Evidence**: See [docs/verification/CURRENT_STATE.md](../verification/CURRENT_STATE.md) — CS-015 RESOLVED with 33 passing tests in `packages/tasks`.

## Phase 6 — Hardening and release 🚀 ACTIVE / NEXT

- ✅ secure import/export limits (file size, row, cell budgets, formula neutralization) (WP-017 / CS-013);
- ✅ resolve WP-014 (iroh live peer-to-peer transport integration across `sync-core`, Tauri IPC, and `@platform/sync`);
- ✅ resolve WP-020 (fine-grained Tauri capability governance, SQL safety filter, and Invariant #8 validation);
- 🚧 resolve WP-016 (Android WorkManager and Windows native background adapters);
- 🚧 scanner input lifecycle/focus/timing hardening;
- 🚧 dependency/supply-chain lockfile audit and CI automation;
- 🚧 signed Windows and Android release artifacts (WP-018);
- 🚧 artifact verification, checksums, and provenance;
- 🚧 physical-device test matrix;
- ✅ downstream adoption test using a second minimal application (WP-019 / Gate G-12).

## Phase 7 — Product/domain expansion

Only after platform gates are stable:

- expand domain features;
- richer UI;
- additional hardware;
- advanced conflict/CRDT models where justified;
- optional encrypted database layer;
- updater/operational management.
