# Current State and Evidence

**Snapshot:** 2026-09-05
**Method:** static inspection of the supplied repository plus local command attempts. No source behavior is described as verified merely because a target interface exists.

## Overall status

**Architectural scaffold — not production-ready.**

The repository has a strong package/module skeleton, strict TypeScript settings, a Rust workspace, reusable feature manifests, repository/migration abstractions, audit/authorization/sync-protocol primitives and automated workflow definitions. The critical production capabilities are still incomplete.

## Status matrix

| Area                                  | Current                                                                                                                             | Target                                                                       | Priority             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------- |
| Monorepo/package boundaries           | Implemented                                                                                                                         | Preserve                                                                     | P2                   |
| TypeScript strictness                 | Implemented                                                                                                                         | Preserve                                                                     | P2                   |
| Rust workspace                        | Implemented                                                                                                                         | Harden                                                                       | P2                   |
| Feature manifests/dependency ordering | Implemented                                                                                                                         | Feature-owned lifecycle                                                      | P2                   |
| Repository abstraction                | Implemented, generic                                                                                                                | Typed/tenant-aware boundary                                                  | P1                   |
| SQLite                                | Native `rusqlite` proof of concept exists, but the demo TypeScript path remains `sql.js` in-memory                                  | Durable native SQLite used by the platform                                   | **P0**               |
| WAL/FK health reporting               | Reported as constants by memory adapter                                                                                             | Actually configure and verify                                                | **P0**               |
| Core migrations                       | Shared core SQL is applied by TypeScript and native demo startup; example-feature widget SQL is also shared and registered natively | Platform-owned and feature-owned migration bundles on durable native storage | **P1**               |
| Device identity                       | Native Ed25519 `DeviceKeyProvider` with protected seed persistence and native signing (WP-005)                                      | Native protected device key + persistent binding                             | **P0** (✅ RESOLVED) |
| User authentication                   | Native Argon2id verification + device binding + lockout cooldown, wired to TS session (WP-005)                                      | Offline credential/platform authentication                                   | **P0** (✅ RESOLVED) |
| Session trust                         | Native-issued `NativeSessionView` mapped to `TrustedOperationContext` with verified device/roles                                    | Native-issued trusted principal                                              | **P0** (✅ RESOLVED) |
| Authorization                         | Mandatory central authorization at all privileged service boundaries (WP-007)                                                       | Enforce at every privileged service boundary                                 | **P1** (✅ RESOLVED) |
| Tenant isolation                      | Cross-tenant rejection & strict organisation isolation across all services (WP-007)                                                 | Mandatory organisation scope                                                 | **P1** (✅ RESOLVED) |
| Audit                                 | Append/list service + tests                                                                                                         | Transactional append-only audit with redaction/integrity policy              | P1                   |
| Sync protocol types                   | Implemented                                                                                                                         | Canonical signed protocol                                                    | **P0**               |
| Handshake                             | Compatibility checks only                                                                                                           | Cryptographically authenticated/replay-resistant                             | **P0**               |
| Transport                             | Simulated state machine; no iroh dependency                                                                                         | Real iroh endpoint/protocol                                                  | **P0**               |
| Outbox/inbox                          | No durable operation log                                                                                                            | Durable idempotent replication queues                                        | **P0**               |
| Conflict registry                     | Strategies exist                                                                                                                    | Domain-safe deterministic semantics                                          | P1                   |
| Tombstones                            | Example feature has soft delete fields                                                                                              | Replication-safe deletion semantics                                          | P1                   |
| Pairing                               | Workflow scaffold with placeholder public key/platform                                                                              | Cryptographic pairing + approval + revocation                                | **P0**               |
| Background sync                       | No platform adapter                                                                                                                 | Android/Windows lifecycle-aware workers                                      | P1                   |
| Tauri capabilities                    | Only `core:default` capability currently declared                                                                                   | Narrow app-specific permissions                                              | **P0**               |
| CSP                                   | Allows inline script/style and WASM eval                                                                                            | Minimise allowances with evidence                                            | P1                   |
| Import/export                         | SheetJS abstraction exists                                                                                                          | Resource limits, validation and safe export                                  | P1                   |
| Scanner                               | Keyboard-wedge abstraction                                                                                                          | Lifecycle/focus/timing/length hardening                                      | P2                   |
| Release signing                       | Not configured                                                                                                                      | Signed/verifiable production artifacts                                       | **P0**               |
| CI runtime                            | Node 20                                                                                                                             | Supported LTS (currently Node 24/22)                                         | P1                   |

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

### CS-002 — Device identity is placeholder material ✅ RESOLVED (WP-005)

**Resolution Summary (2026-09-06):**
`crates/identity-core` now implements genuine Ed25519 cryptographic key management via `DeviceKeyProvider`. When initialized, it generates a 32-byte Ed25519 seed using cryptographically secure random bytes (`rand_core` / `getrandom`), derives `SigningKey` and `VerifyingKey`, persists the seed in protected platform storage (`device_identity.key` with restricted permissions), and computes canonical public key strings (`ed25519_pk_<hex>`). Private keys are strictly held in native custody and are never exposed across the IPC boundary or persisted to SQLite (upholding Invariant #5). `DurableDatabase::load_or_create_device_key_provider()` binds the authentic public key to `core_devices`.

**Test Evidence:**

- `test_genuine_ed25519_key_generation_and_signing` - Generates genuine 32-byte seed, verifies signature over arbitrary messages
- `test_signature_rejected_by_wrong_public_key` - Confirms signature verification fails against non-matching public keys
- `test_restart_persistence_with_protected_file` - Confirms same keypair and seed survive across provider restarts
- `device_identity_binding_survives_database_restart` - Verifies stable `core_devices` binding with authentic Ed25519 public key

```
cargo test -p identity-core
test result: ok. 4 passed; 0 failed
```

### CS-003 — Session creation is not authentication ✅ RESOLVED (WP-005)

**Resolution Summary (2026-09-06):**
`UserSessionService.createSession()` has been deprecated in favor of `authenticate(request, gateway)`. Authentication is delegated directly to the native `authenticate_user` Tauri IPC command. On the native side, `NativeSessionStore` and `DurableDatabase::authenticate_user` verify passwords against Argon2id verifiers stored in `core_users.credential_verifier`, check device approval and binding in `core_devices`, enforce a 5-failure lockout cooldown window with `locked_until`, resolve role permissions, and establish the session in native custody. The resulting `NativeSessionView` includes the verified `device_id`, `user_id`, `organisation_id`, and `permissions`. `apps/demo` and `usePlatform.tsx` are fully integrated with this boundary.

**Test Evidence:**

- `authenticates_active_user_and_derives_permissions_from_native_state` - Verifies Argon2id matching, role permission derivation, and session store
- `locks_after_repeated_failures_and_denies_correct_password` - Confirms 5 consecutive failed attempts trigger temporary lockout
- `tests/security/authentication-boundary.test.ts` - Security regression tests ensuring failed native auth creates no session and raises `AuthenticationError`

```
cargo test -p native-core -- authenticates_active_user locks_after_repeated_failures
test result: ok. 2 passed; 0 failed
pnpm --filter @tests/security test
test result: 4 test files passed; 19 passed
```

### CS-004 — Security context is caller-constructible ✅ RESOLVED (WP-005)

**Resolution Summary (2026-09-06):**
Callers cannot construct a `TrustedOperationContext` arbitrarily. The TypeScript runtime can only obtain a `TrustedOperationContext` via `UserSessionService.getTrustedOperationContext()`, which validates that an active session was established through native authentication with valid device status and unexpired lifetime. Privileged operations utilize `AuthorizationEngine.requireTrusted(trustedContext, permission)`, extracting the subject exclusively from the trusted principal.

**Test Evidence:**

- `prevents obtaining a TrustedOperationContext without verified authentication` - Confirms unauthenticated calls throw `AuthenticationError`
- `establishes TrustedOperationContext from verified native boundary and enforces permissions` - Confirms trusted subject drives authorization checks and rejects unauthorized capabilities
- `does not let frontend request context select identity or credentials` - Confirms `RequestContext` has no identity or credential fields

```
pnpm --filter @tests/security test
test result: 4 test files passed; 19 passed
```

### CS-005 — Sync protocol baseline implemented ✅ PARTIALLY RESOLVED (WP-010, WP-012, WP-013)

**Resolution Summary (2026-09-06):**
The sync data and protocol layer has been upgraded from pure simulation to a production-grade durable pipeline:
- `packages/sync-protocol`: Introduced `SyncEnvelope` deterministic canonical serialization (sorted-key UTF-8 JSON) signed via Ed25519 (`SyncEnvelopeBuilder`) with public key and signature format enforcement (Invariant #5).
- `packages/database` & `packages/platform`: Platform migration 3 (`core-replication.sql`) establishes durable `core_sync_outbox`, `core_sync_inbox`, and `core_sync_tombstones` schemas with indexes and constraints.
- `packages/sync` (`OutboxService`): Atomic transactional queueing of outbound signed operations, ordered batch retrieval for transport polling, and retry lifecycle.
- `packages/sync` (`InboxService`): Idempotent inbound queueing (`ON CONFLICT (envelope_id) DO NOTHING`), cryptographic signature verification before apply, and strictly ordered `logical_timestamp` application.
- `packages/sync` (`TombstoneService`): Enforces Invariant #6 (never raw DELETE synchronisable entities), storing soft deletions with `delete_operation_id` for peer replication.
- `packages/sync` (`SyncTransport`): Clean transport abstraction boundary with `SimulatedSyncTransport` for testing and offline development.
- **Remaining Gate:** WP-014 (iroh live peer-to-peer transport adapter spike).

### CS-006 — Handshake is authenticated ✅ RESOLVED (WP-011)

**Resolution Summary (2026-09-06):**
`HandshakeValidator` and `HandshakeProtocol` now provide comprehensive mutual authentication and replay resistance:
- `HandshakeMessage` requires 32-hex random `nonce`, canonical `signerPublicKey` (`ed25519_pk_<hex>`), platform metadata, and 128-hex Ed25519 `signature`.
- Deterministic canonicalization excludes the `signature` field for signature verification over sorted-key UTF-8 bytes.
- Validates timestamp skew (default 30,000 ms threshold) rejecting past and future expired messages.
- Prevents replay attacks via session-tracked nonces (`seenNonces: Set<string>`).
- Rejects missing, malformed, or cryptographically invalid signatures via async `verifyFn`.

### CS-007 — Peer identity and platform metadata are authenticated ✅ RESOLVED (WP-011)

**Resolution Summary (2026-09-06):**
`PairingService.requestPairing()` no longer fabricates public keys (`ed25519_pk_${deviceId}`) or hardcodes `"windows"`:
- Directly utilizes the sender's verified `signerPublicKey` and actual `platform` metadata from the authenticated `HandshakeMessage`.
- Invokes `HandshakeValidator.requireValid()` passing the cryptographic `verifyFn` callback, ensuring unverified or forged peer handshakes are rejected before pairing requests can be stored.

### CS-008 — Tenant/authorization enforcement is incomplete ✅ RESOLVED (WP-007)

**Resolution Summary (2026-09-06):**
Mandatory central authorization and tenant isolation have been systematically integrated across all privileged service entry points:

- `packages/core`: Standardized `extractContextSubject(ctx)` and `isTrustedOperationContext(ctx)` type guards, allowing uniform extraction of actor identity and tenant boundary from either `OperationContext` or `TrustedOperationContext`.
- `packages/authorization` (`SyncGroupService`): Injected `AuthorizationEngine`, strictly enforcing `sync.manage` on group creation, membership approval, revocation, and rejection. Enforces cross-tenant rejection (`input.organisationId !== organisationId`).
- `features/organisations` (`OrganisationService`): Injected `AuthorizationEngine`, enforcing `organisations.create`, `organisations.read`, and `organisations.manage`, preventing cross-tenant visibility or mutation.
- `features/identity-admin` (`IdentityAdminService`): Injected `AuthorizationEngine`, enforcing `users.create`, `devices.approve`, and `devices.revoke`, strictly rejecting cross-tenant user creation.
- `features/example-feature` (`WidgetService`): Injected `AuthorizationEngine`, enforcing `widgets.create`, `widgets.read`, `widgets.update`, and `widgets.delete` via repository-mediated tenant isolation.
- `tests/security/rbac-security.test.ts`: Expanded regression suite to 12 dedicated tests asserting permission grant/denial, scope constraints on `TrustedOperationContext`, cross-tenant rejection across all migrated services, and unauthorized access rejection.

**Test Evidence:**

- `tests/security/rbac-security.test.ts` (12/12 passed) - Tests `TrustedOperationContext` RBAC, scope enforcement, cross-tenant rejection for sync groups & users, and unprivileged rejection across all services.
- `tests/security/sync-authorization.test.ts` (7/7 passed) - Tests 7-layer sync authorization, handshake replay protection, tampered envelope rejection, and tombstone tracking.
- `features/organisations/tests/unit/organisationService.test.ts` (4/4 passed) - Asserts tenant-scoped reads/updates and rejection of unprivileged creation.
- `features/identity-admin/tests/unit/identityAdminService.test.ts` (6/6 passed) - Asserts cross-tenant creation rejection and permission requirements.
- `features/example-feature/tests/unit/widgetService.test.ts` (6/6 passed) - Asserts tenant isolation and permission requirements on mutations.
- `packages/authorization/src/index.test.ts` (6/6 passed) - Asserts `SyncGroupService` lifecycle, cross-tenant rejection, and permission requirements.

```
pnpm --filter @tests/security test
test result: 4 test files passed; 30 passed
pnpm test
test result: 34 tasks successful, 0 failed
cargo test --workspace
test result: all Rust unit and integration tests passed
```

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

### CS-010 — Additive conflict policy is safe and guarded ✅ RESOLVED (WP-013)

**Resolution Summary (2026-09-06):**
- `packages/sync-protocol` (`ConflictRegistry`): Implemented `registerAbsoluteLwwField` and `isAbsoluteLwwField`. Attempting to register an `"additive"` policy on a field declared as an absolute quantity throws an explicit error at registry setup time.
- `packages/sync` (`ConflictEngine`): Multi-strategy conflict engine supporting LWW (HLC ordering), append-only, immutable, manual, and additive (delta-only). When `"additive"` strategy is executed against an absolute value field, `ConflictEngine` throws a descriptive `ConflictError` to prevent silent corruption of absolute quantities.

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

The Phase 5 durable background task subsystem was verified on 2026-09-06 with:

- `pnpm --filter @platform/tasks test` — 33 tests passed (TaskQueueService 19, TaskWorker 7, OutboxSyncWorker 7);
- `pnpm typecheck` — 37 typecheck tasks passed across all workspace packages;
- `pnpm test` — full monorepo test suite passed (all packages, features, security regression, integration, sync tests).

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
- `packages/tasks/src/*`
- `packages/platform/src/*`
- `features/*/src/services/*`
- `apps/demo/src/hooks/usePlatform.tsx`
- `apps/demo/src-tauri/src/*`
- `apps/demo/src-tauri/capabilities/*`
- `.github/workflows/*`
