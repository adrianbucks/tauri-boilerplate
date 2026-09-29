# Implementation Work Packages Register

This document tracks the progress, implementation locations, verification evidence, and open scope across all 20 architectural work packages (WP-001 through WP-020).

---

## Work Packages Status Table

| WP | Title | Status | Primary Location | Key Verification Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **WP-001** | Durable SQLite Adapter | ✅ RESOLVED | `crates/native-core`, `@platform/database` | 5 regression tests (WAL, FKs, rollback, persistence) |
| **WP-002** | Core Migration Authority | ✅ RESOLVED | `@platform/platform`, `crates/native-core` | Ordered execution, SHA-256 checksum verification |
| **WP-003** | Tenant-Aware Repositories | ✅ RESOLVED | `@platform/database`, `features/*` | `tests/security/tenant-isolation.test.ts` (7 tests) |
| **WP-004** | Trusted Operation Context | ✅ RESOLVED | `@platform/core`, `@platform/identity` | `tests/security/authentication-boundary.test.ts` |
| **WP-005** | Device Key Provider | ✅ RESOLVED | `crates/identity-core`, `crates/crypto-core` | 4 tests: Ed25519 seed generation, signing, persistence |
| **WP-006** | Offline Authentication | ✅ RESOLVED | `crates/native-core`, `@platform/identity` | Argon2id verification, 5-failure lockout cooldown |
| **WP-007** | Authorization Enforcement | ✅ RESOLVED | `@platform/authorization`, `features/*` | `tests/security/rbac-security.test.ts` (12 tests) |
| **WP-008** | Typed Native Gateway | ✅ RESOLVED | `apps/demo/src-tauri/src/lib.rs` | Typed IPC commands, validation in Rust memory |
| **WP-009** | Tauri Capability & CSP | ✅ RESOLVED | `apps/demo/src-tauri/capabilities/` | Strict CSP (`default-src 'self'`), no inline script/WASM |
| **WP-010** | Canonical Sync Envelope | ✅ RESOLVED | `@platform/sync-protocol` | Deterministic sorted-key serialization, Ed25519 sigs |
| **WP-011** | Authenticated Handshake | ✅ RESOLVED | `@platform/sync-protocol`, `@platform/sync` | 32-hex nonce freshness, 30s skew window, replay guard |
| **WP-012** | Durable Outbox & Inbox | ✅ RESOLVED | `@platform/sync`, `core-replication.sql` | Transactional enqueue, `ON CONFLICT DO NOTHING` |
| **WP-013** | Conflict & Tombstone Engine| ✅ RESOLVED | `@platform/sync`, `@platform/sync-protocol` | Additive guard for absolute quantities, soft-delete tombstones |
| **WP-014** | Real iroh P2P Transport | ✅ RESOLVED | `crates/sync-core`, `@platform/sync` | `test_iroh_loopback_two_node_envelope_exchange`, QUIC stream |
| **WP-015** | Background Task Subsystem | ✅ RESOLVED | `@platform/tasks` | 33 unit and integration tests passing |
| **WP-016** | OS Lifecycle Adapters | 🚧 OPEN | `packages/tasks`, `apps/demo/src-tauri` | Android WorkManager and Windows Task Scheduler |
| **WP-017** | Import / Export Hardening | ✅ RESOLVED | `@platform/import-export` | 10MB/10k row bounds, CSV formula injection defense |
| **WP-018** | Release Hardening | 🚧 OPEN | `.github/workflows/`, `apps/demo` | Windows Authenticode and Android APK release signing |
| **WP-019** | Downstream Adoption Test | ✅ RESOLVED | `apps/minimal-consumer` | Field Notes app, Gate G-12 passed, Invariant #10 verified |
| **WP-020** | Fine-Grained Capability Matrix| ✅ RESOLVED | `capabilities/default.json`, `crates/native-core` | `tauri-capability-governance.test.ts`, SQL safety guard |

---

## Detailed Open Work Packages

### WP-016: Android & Windows OS Lifecycle Adapters 🚧 OPEN
- **Objective**: Ensure background sync tasks survive mobile app suspension and continue executing on desktop when the main application window is minimized to the system tray.
- **Scope**:
  - **Android (WP-016a)**: Implement native Android WorkManager plugin bridging periodic sync execution across application process terminations and device reboots.
  - **Windows (WP-016b)**: Implement native background task execution via Windows Task Scheduler or continuous headless background service mode.

### WP-018: Release Signing & Provenance 🚧 OPEN
- **Objective**: Establish production code signing, artifact provenance, and supply chain security validation.
- **Scope**:
  - Configure Windows Authenticode signing certificates in `tauri.conf.json`.
  - Configure Android release keystore signing in Gradle.
  - Integrate `cargo audit` and `pnpm audit` into `.github/workflows/ci.yml`.
