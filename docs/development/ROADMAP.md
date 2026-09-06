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
- 🚧 harden repository tenant boundaries (WP-003 in progress);
- 🚧 make migration tests cover fresh/upgrade/checksum failure/recovery;
- ✅ remove demo-owned platform table creation.

**Evidence**: See [docs/verification/CURRENT_STATE.md](verification/CURRENT_STATE.md) — CS-001 RESOLVED with restart persistence, FK enforcement, WAL/journal, and integrity check tests passing. 5 comprehensive regression tests in `crates/native-core/src/database.rs` validate production-ready durability and crash recovery.

## Phase 2 — Trusted identity and authentication

- implement native key-provider abstraction;
- generate real cryptographic device identity;
- bind native identity to persistent device record;
- implement offline credential verification;
- implement session lifecycle and trusted principal;
- separate device revocation from user logout;
- implement shared-device switching and recovery policy.

## Phase 3 — Authorization and native boundary

- require central authorization at all privileged services;
- make tenant scope mandatory;
- introduce typed native gateway;
- harden Tauri capabilities and CSP;
- add security regression suite.

## Phase 4 — Real replication

- resolve iroh/replication research gate;
- implement canonical signed operation envelope;
- implement authenticated handshake/replay protection;
- implement durable outbox/inbox/idempotency;
- implement tombstone propagation;
- implement deterministic conflict policy per entity;
- build real two-device and three-device convergence tests.

## Phase 5 — Background execution

- durable task subsystem;
- Android WorkManager adapter;
- Windows lifecycle/scheduling adapter;
- retry/cancellation/recovery tests;
- notifications and diagnostics.

## Phase 6 — Hardening and release

- secure import/export limits;
- scanner hardening;
- dependency/supply-chain policy;
- signed Windows/Android artifacts;
- artifact verification/provenance;
- physical-device test matrix;
- downstream adoption test using a second minimal application.

## Phase 7 — Product/domain expansion

Only after platform gates are stable:

- expand domain features;
- richer UI;
- additional hardware;
- advanced conflict/CRDT models where justified;
- optional encrypted database layer;
- updater/operational management.
