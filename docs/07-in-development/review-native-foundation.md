# Focused Plan: Rust and Native Boundary Review

**Status:** In progress; database/IPC review started.

## Scope

Review `crates/native-core`, `crates/identity-core`, `crates/crypto-core`, `crates/sync-core`, and `crates/background-core`, then inspect Tauri command adapters in both apps as relevant. Follow one data or trust boundary at a time; do not rewrite crates solely to normalize style.

## Review sequence

1. Trace native database initialization, schema migrations, SQL validation, query/execute APIs, and transaction dispatch from TypeScript IPC to Rust SQLite.
2. Trace authentication and session issuance, identity key generation/storage/signing, and all exposed diagnostic or IPC outputs.
3. Trace sync connection, handshake/admission, framed data exchange, and failure/timeout/cancellation behavior.
4. Trace background scheduler and platform lifecycle ownership, startup, shutdown, and task acknowledgement.
5. For confirmed issues, make the smallest boundary-appropriate fix and add regression coverage before proceeding.

## Required checks

- Confirm API/version details against pinned lockfiles and official documentation before API changes.
- Add Rust tests for native behavior; add `tests/security/` regression tests for security boundary changes.
- Run applicable crate tests while iterating, then `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, and `cargo test --workspace` before declaring this stage complete.
- Record device/platform-specific checks that cannot be run in the current environment.

## Acceptance criteria

- No private key material is serialized to TypeScript, SQLite, or logs.
- Native commands validate untrusted arguments and expose typed, bounded results.
- Transaction guarantees match actual IPC behavior; race-sensitive read/modify/write operations execute atomically at the native database layer.
- Sync data exchange is gated by implemented authorization/admission checks before application payloads are sent.
- Startup, shutdown, retry, and cancellation behavior is explicit and regression-covered where supported.
- Confirmed issues and verification are recorded in the parent [review plan](./codebase-review-plan.md).

## Findings

### Fixed: concurrent Rust HLC generation could lose increments

- **Evidence:** `HybridLogicalClock::now()` loaded and stored physical time and counter through separate atomics. Concurrent calls could observe the same prior state and return duplicate timestamps, despite the method's monotonicity contract. Counter increment also used unchecked `u32` addition.
- **Change made:** The clock now protects its combined physical-time/counter state with one mutex, making each local generation and remote update a single state transition. Counter overflow advances physical time and resets the counter rather than wrapping.
- **Regression coverage:** Added a concurrent 8-thread/4,000-timestamp uniqueness test and a focused counter-overflow test.
- **Verification:** `cargo test -p crypto-core` passed (6 tests); `cargo clippy -p crypto-core --all-targets -- -D warnings`, `cargo fmt --all`, and `git diff --check` passed.
- **Scope note:** No non-test call sites of the Rust HLC were found during this slice. The active TypeScript HLC is reviewed separately in [the platform package review](./review-platform-packages.md), including compatibility with the ISO timestamp formats currently persisted by the app. The Rust HLC does not yet parse those legacy ISO forms, so Rust/TypeScript parsing parity remains a follow-up if native code begins consuming HLC strings.

### Fixed: Ed25519 signing keys and temporary seed buffers were not configured for zeroization

- **Evidence:** `DeviceKeyProvider` held a `SigningKey` while `ed25519-dalek` had default features disabled and did not enable its `zeroize` feature. Seed arrays and loaded file bytes were also ordinary values whose contents remained in memory after use.
- **Change made:** Enabled `ed25519-dalek`'s `zeroize` feature and wrapped generated seeds, loaded seeds, and the file-read buffer in `zeroize::Zeroizing`, so their owned memory is cleared on drop. Loaded bytes are length-checked again after the read to handle a file replacement between metadata inspection and reading without panicking.
- **Regression coverage:** The security governance suite asserts the zeroizing wrappers and signing-key feature are retained; existing identity tests cover signing, persistence, and concurrent creation.
- **Verification:** `cargo test -p identity-core` passed (5 tests); `cargo clippy -p identity-core --all-targets -- -D warnings` passed; `pnpm --filter @tests/security test -- device-key-storage-governance.test.ts` passed (2 tests); workspace Rust formatting and `git diff --check` passed.
- **API evidence:** The [ed25519-dalek SigningKey documentation](https://docs.rs/ed25519-dalek/latest/ed25519_dalek/struct.SigningKey.html) states `ZeroizeOnDrop` is available with the `zeroize` feature. The [zeroize documentation](https://docs.rs/zeroize/latest/zeroize/struct.Zeroizing.html) documents drop-time zeroization for wrapped values.

### Confirmed: SQL safety checks can be bypassed with SQLite comments

- **Evidence:** `DurableDatabase::validate_safe_sql` searched unparsed raw text for PRAGMA/ATTACH/DETACH/VACUUM patterns. SQLite permits comments as whitespace, so forms such as `PRAGMA/* comment */ foreign_keys = OFF` were not rejected by those checks.
- **Risk:** A caller able to use the generic database IPC could reach SQLite operations the guard intended to reserve for native control.
- **Change made:** The guard now inspects the leading SQL keyword while skipping whitespace and SQLite line/block comments, and checks the second keyword for `VACUUM INTO`.
- **Regression coverage added:** Rust behavioral cases in `crates/native-core/src/database.rs` and a security-suite guard ensuring the cases remain present in `tests/security/native-sql-governance.test.ts`.
- **Verification:** `cargo check -p native-core` passed; `cargo test -p native-core` passed (25 tests); `pnpm --filter @tests/security test` passed (10 files, 67 tests). Rust formatting, changed-document Prettier checks, and `git diff --check` passed.
- **Remaining scope:** SQL bridge reachability/authorization remains open. Statement-tail handling and bounded command inputs are reviewed separately below.

### Fixed: device-key creation could expose partial files and ignored permission failures

- **Evidence:** `DeviceKeyProvider::load_or_create()` previously used `fs::write()` directly at the final key path, then ignored errors from Unix permission restriction. Concurrent startup could observe a partially written key, and a failed chmod could leave the private seed more broadly readable.
- **Change made:** On Unix, keys are written to an exclusively created temporary file, synced, and hard-linked into the final path without replacing an existing identity. On Windows, the final file is opened with exclusive creation and synced. Concurrent readers wait briefly for the complete 32-byte seed and then load the winner's key. Existing key paths must be regular files; symlinks and special files are rejected. Unix key permissions are restricted to `0600` both on creation and load, and permission failures propagate.
- **Regression coverage:** Rust tests cover concurrent creators converging on one identity and permission repair for existing files. A security governance regression guards exclusive creation, atomic publication, symlink rejection, and tests.
- **Platform limitation:** Windows ACLs are inherited from the containing application data directory; this change does not inspect or set Windows-specific ACLs. Windows publication is exclusive and avoids replacement, but lacks the temp-file/hard-link atomic publication available on Unix. Both points remain explicit platform review items.
- **Verification:** `cargo test -p identity-core` passed (5 tests), including concurrent creators and Unix permission repair where supported; the device-key security governance test, `cargo clippy -p identity-core --all-targets -- -D warnings`, and Rust formatting check passed.

### Fixed: existing device-key permissions were restricted after reading the secret

- **Evidence:** `read_existing_seed()` loaded the full key file with `fs::read()` and only then changed its Unix permissions to `0600`. A file replaced or expanded after the metadata check could be read before restriction and could trigger an unbounded allocation.
- **Change made:** The loader opens and validates the file, checks the opened file against the pre-open metadata on Unix, applies restrictive permissions through the file handle before reading, and reads at most 33 bytes to validate the exact 32-byte seed length.
- **Regression coverage:** Updated `tests/security/device-key-storage-governance.test.ts` to require the permission restriction before the bounded file read. The Rust key-permission regression continues to cover the resulting mode.
- **Verification:** `cargo check -p identity-core`, security typecheck, Rust formatting, Prettier, and `git diff --check` passed. Tests were not run during this review pass.

### Fixed: local device identity reconciliation could violate the single-local constraint

- **Evidence:** `load_or_create_device_key_provider()` marked a matching device row as local before unmarking a different local row. Migration 6 enforces at most one local device with a partial unique index, so a key already registered as a peer could make startup fail during reconciliation. The marker and identity updates also were not one transaction.
- **Change made:** Reconciliation now selects the key-matching and current-local rows inside a SQLite transaction. It clears prior local markers before promoting the matching row, updates a stale local row only when the key does not collide with another registered device ID, and commits the complete reconciliation atomically.
- **Verification:** `cargo check -p native-core`, Rust formatting, Prettier, and `git diff --check` passed. Tests were not run during this review pass.

### Fixed: identity helper implied persistence while discarding the signer

- **Evidence:** `KeyManager::get_or_create_device_identity()` called `generate_ephemeral()`, cloned only the public identity metadata, then dropped the provider containing the signing key. The function therefore neither retrieved nor persisted an identity and could not return a provider capable of signing for that identity.
- **Change made:** Added `generate_ephemeral_device_key_provider()` with an explicit transient lifetime and a usable native signer. The legacy method remains source-compatible but is deprecated and documents that it discards the ephemeral signer; persistent callers are directed to `DeviceKeyProvider::load_or_create()`.
- **Verification:** `identity-core` typecheck and Rust formatting passed. Tests were not run during this review pass.

### Confirmed: generic database IPC bypasses service authorization

- **Evidence:** Both apps register `db_query`, `db_execute`, and `db_transaction` in `generate_handler!`. Their handlers forward caller-provided SQL to `DurableDatabase`; the bridge validates a few dangerous SQL forms but does not require a native-issued trusted context or enforce table/operation permissions. `db_execute` accepts arbitrary prepared DML. The frontend repository/service authorization layer can therefore be bypassed by invoking the native command directly.
- **Tauri configuration evidence:** Both apps use Tauri 2.11.5 from `Cargo.lock`; their build scripts call `tauri_build::build()` without an `AppManifest`, and the demo capability contains only event permissions. [Tauri's capability guidance](https://v2.tauri.app/security/capabilities/) says registered app commands are available to all windows by default unless restricted with `AppManifest::commands`. This makes the command surface an explicit least-privilege review item, but command allowlisting alone does not make arbitrary SQL safe.
- **Risk:** Frontend compromise or an unintended direct invocation can bypass TypeScript RBAC, repository tenant scoping, audit, tombstone, and outbox flows, potentially reading or changing arbitrary local database rows.
- **Change made:** The demo diagnostics screen no longer constructs SQL or invokes `db_query`; it calls a fixed native command that returns four read-only counts. A security regression guards this renderer boundary. The generic database commands remain registered and broadly callable, so this does not resolve the bridge finding.
- **Verification:** Demo native crate check and tests passed (2 tests); demo TypeScript typecheck passed; full security suite passed (76 tests across 12 files); package Clippy with warnings denied, workspace Rust formatting check, Prettier, and `git diff --check` passed.
- **Plan:** Treat this as a high-priority security design item. The source inventory confirms the generic connection is consumed by platform repositories/services and application bootstraps, so removing it without a migration would break supported flows. Design a staged replacement: first explicitly constrain registered Tauri commands with the pinned `AppManifest` API; then define a native authorization-aware data gateway or typed native operations that preserve domain-neutral platform contracts and app/feature ownership. The command allowlist is defense in depth only; any command that still accepts arbitrary SQL must not be described as authorization-safe. Coordinate this design with the transaction consumer inventory in the platform package plan, since the same boundary must support conditional atomic reads/writes without moving sensitive checks out of their transaction.
- **Consumer inventory:** `apps/demo/src/hooks/usePlatform.tsx` constructs `NativeDatabaseConnection` and passes it to `Platform`, feature services, and `ImportEngine`. `apps/minimal-consumer/src/index.ts` accepts an injected `PlatformOptions.db`; its production `NativeDatabaseConnection` instance must be supplied by its host. `Platform` wires the connection into migrations, identity, authorization, audit, sync, import/export, tasks, and maintenance. Feature repositories/services (including the demo widget, organisation, identity-admin, and minimal-consumer notes flows) use the generic `DatabaseConnection` contract. The Tauri command adapters in both apps register the same three generic SQL commands.
- **Transaction compatibility finding:** The shared contract permits `TransactionClient.query()`, while the native adapter explicitly throws for it. `PairingService.approvePairing()` calls `tx.query()` directly; `requestPairing()` also delegates to identity registration that performs an exact device lookup through the transaction client. Both flows therefore fail on the native driver. Other listed services may depend on the production transaction contract for atomicity even where their current callbacks only queue writes. A host-side command allowlist will not repair this incompatibility.
- **Migration sequence:** (1) Define a native operation protocol that authenticates a native-issued session/principal and derives organisation/user scope from native session state; renderer-supplied identifiers are selectors only and must be checked against that state. (2) Add bounded typed native operations for migration/bootstrap, health, and measured platform workflows, with native atomic conditional writes and explicit affected-row results. (3) Migrate one consumer group at a time behind stable TypeScript repository/service interfaces, testing the production bridge contract and preserving app-owned domain logic in `features/`/`apps/`. (4) Remove generic SQL command registration and arbitrary SQL connection APIs only after the consumer inventory is empty. Restrict commands/capabilities using the verified pinned Tauri API throughout as defense in depth.
- **Transaction protocol requirements:** The native boundary must own the full read/validate/write transaction for workflows requiring atomic decisions. It must return typed results for conditional writes, define cancellation and serialization behavior, reject unknown operation versions and oversized payloads, and support controlled migration/bootstrap before a user session exists. A two-phase batch of renderer-authored SQL is not an acceptable substitute for an atomic read/modify/write operation.
- **Verification needed:** Add native command-level tests proving unauthorized operations are denied and security regressions in `tests/security/`; validate least-privilege Tauri app command exposure using the pinned Tauri 2.11.5 API. Add production-driver tests for tenant isolation and transaction behavior before migrating consumers. No fix for this finding has been applied yet.
- **Verification needed:** Add native command-level tests proving unauthorized operations are denied and security regressions in `tests/security/`; validate least-privilege Tauri app command exposure using the pinned Tauri 2.11.5 API. Add production-driver tests for tenant isolation and transaction behavior before migrating consumers. No fix for this finding has been applied yet.

### Confirmed risk: native sync accepts and forwards inbound payloads before application admission

- **Evidence:** `crates/sync-core/src/endpoint.rs` accepts incoming QUIC connections, reads framed JSON payloads, sends a transport ACK, and publishes `InboundEnvelopeMessage` containing the peer endpoint ID and payload. `packages/sync/src/transport/IrohSyncTransport.ts` parses the payload and invokes every registered receive handler, including for unknown endpoint IDs. No application admission check is present on this path. Separately, `SyncManager.connect()` claims `AUTHORISED` after checking only organisation ID; see the [platform package findings](./review-platform-packages.md).
- **Impact:** Network reachability and an iroh endpoint identity are treated as sufficient to deliver application data to handlers. The documented device admission, tenant, membership, and namespace permission gates are not enforced before delivery. Envelope signature validation by an eventual handler does not establish all seven gates.
- **Change made:** Native send and receive paths now enforce the same 10 MiB frame limit; inbound prefix and payload reads time out after 30 seconds; and the transport ACK is sent only after the complete frame has entered the bounded inbound queue. These changes limit oversized outbound frames, slow-read resource retention, and ACK-before-queue loss. They do not implement peer admission or authorize data exchange.
- **Regression coverage:** Added native frame-boundary unit coverage and a `tests/security/` governance regression for size bounds, read timeouts, and ACK ordering.
- **Verification:** `cargo test -p sync-core` passed (3 tests; network loopback required an elevated rerun after a sandbox timeout); `cargo clippy -p sync-core --all-targets -- -D warnings`, Rust formatting, and the focused security regression passed.
- **Plan:** Move admission to a boundary that runs before application payload delivery and before outbound send. Bind authenticated endpoint identity to an admitted device record and verify protocol, tenant, active membership, and namespace authorization using native trusted state. Keep transport ACK semantics explicit and do not acknowledge accepted data as application acceptance.
- **Verification needed:** Add native and `tests/security/` integration coverage for unknown, unapproved, revoked, cross-tenant, non-member, incompatible-protocol, and unauthorized-namespace peers; assert no application handler runs and no payload is sent for each rejection. No fix has been applied yet.

### Fixed: generic native query results were unbounded

- **Evidence:** `DurableDatabase::query_json()` collected every returned row, column, and cell into a JSON response without row, column, or response-size limits. Since the generic query command is callable from the webview, a broad query could allocate an excessive amount of native memory and IPC output.
- **Change made:** Added limits of 10,000 rows, 256 columns, and 10 MiB of conservatively estimated JSON output. Oversized text/blob cells are rejected before conversion or base64 encoding, and SQLite value-read errors now propagate instead of becoming `null`.
- **Regression coverage:** Native tests cover excessive row and blob-cell results; `tests/security/native-sql-governance.test.ts` guards the bridge limits and their behavioral test.
- **Verification:** Focused `cargo test -p native-core query_json_rejects_results_above_bridge_limits` passed; the native SQL governance security test passed (2 tests); `cargo fmt --all -- --check` and `git diff --check` passed.
- **Remaining limitation:** Bounded results do not authorize queries or prevent expensive SQL execution; the generic SQL IPC authorization design remains open above.

### Confirmed: rusqlite rejects multiple statements in one prepared request

- **Evidence:** The pinned `rusqlite` 0.40.2 `Connection::prepare_with_flags()` implementation checks the unconsumed SQL tail and returns `Error::MultipleStatement` when it contains another statement. `query_json()` and `execute_json()` use `prepare()`, and each transaction operation is prepared separately.
- **Regression coverage:** Added a native regression verifying query and execute requests with multiple statements fail, and that a valid first DML statement is not executed when followed by a prohibited statement. Added a security governance check for the behavioral test.
- **Verification:** Focused `cargo test -p native-core sql_bridge_rejects_multiple_statements_before_execution` passed; the native SQL governance security suite passed (3 tests); `cargo fmt --all -- --check` and `git diff --check` passed.

### Fixed: generic native SQL command inputs were unbounded

- **Evidence:** `query_json()`, `execute_json()`, and `transaction_json()` accepted unbounded SQL text, parameter vectors and values, and transaction operation batches. This allowed excessive parsing and allocation work at the native boundary.
- **Change made:** Enforced a 1 MiB SQL statement limit, 999 parameters per statement, 1 MiB per estimated serialized parameter, 10 MiB per request, 1,000 operations per transaction, and a nesting-depth cap for JSON parameters. Validation runs before preparing statements or opening the transaction; parameter-size estimation avoids allocating a serialized copy.
- **Regression coverage:** Added native cases for oversized SQL, excessive parameter count, oversized individual and aggregate parameters, and excessive transaction operation count. Security governance checks pin the limits and test.
- **Verification:** Focused `cargo test -p native-core sql_bridge_rejects_oversized_inputs_before_database_execution` passed; native SQL governance security tests passed (4 tests); `cargo clippy -p native-core --all-targets -- -D warnings`, `cargo fmt --all -- --check`, and `git diff --check` passed.
- **Remaining limitation:** These limits do not cap the size of the IPC payload before Tauri deserializes it, authorize SQL, or bound query execution cost. Those require separate bridge design and query controls.

### Fixed: oversized unsigned SQL integers silently wrapped

- **Evidence:** `json_value_to_sql_param()` converted unsigned JSON integers to SQLite integers with `u as i64`. Values above `i64::MAX` therefore wrapped into negative values rather than preserving or rejecting the input.
- **Change made:** SQL request validation now rejects out-of-range unsigned scalar parameters before conversion or database execution.
- **Regression coverage:** Native tests pass `u64::MAX` and assert rejection; the SQL governance suite guards the range check and test case.
- **Verification:** `cargo test -p native-core sql_bridge_rejects_oversized_inputs_before_database_execution` passed; native SQL governance tests passed (5 tests); `cargo clippy -p native-core --all-targets -- -D warnings`, `cargo fmt --all -- --check`, and `git diff --check` passed.

### Fixed: read-query commands could execute DML with `RETURNING`

- **Evidence:** SQLite permits statements such as `DELETE ... RETURNING` to be executed through a query API. `query_json()` prepared the statement and called `Statement::query()` without checking whether SQLite considered it read-only. Transaction operations marked `query` had the same behavior.
- **Change made:** Both direct query requests and transaction operations tagged as `query` now require `Statement::readonly()` before execution. This keeps mutation intent on the execute path and prevents a rejected query from changing rows.
- **Regression coverage:** Native tests send `DELETE ... RETURNING` through both query paths and verify the row remains. Security governance coverage pins the checks and behavioral test.
- **Verification:** Focused `cargo test -p native-core query_operations_reject_writes_even_when_sql_returns_rows` passed; native SQL governance tests passed (6 tests); `cargo clippy -p native-core --all-targets -- -D warnings`, `cargo fmt --all -- --check`, and `git diff --check` passed.

### Fixed: native signature commands decoded unbounded hex input

- **Evidence:** Both Tauri applications decoded caller-provided signing and verification messages before enforcing a size limit. The identity provider also decoded public-key and signature hex before validating their expected encoded lengths.
- **Change made:** Added a 10 MiB signing-message bound and pre-decode size validation in both application adapters. The identity provider enforces the same bound on direct signing and verification calls. Verification also checks fixed public-key and signature hex lengths before decoding.
- **Regression coverage:** Added identity-core boundary tests and `tests/security/native-signature-input-governance.test.ts` to guard both adapters and provider limits.
- **Verification:** The focused identity-core boundary test and signature-input security governance test passed; `cargo clippy -p identity-core --all-targets -- -D warnings`, Rust formatting, and `git diff --check` passed.
- **Remaining limitation:** The limit prevents excessive decode and cryptographic work after Tauri deserializes the request; it does not cap the raw IPC payload before deserialization. The signing command remains a general signing interface, so caller authorization and intended message-domain constraints need separate review.

### Fixed: background scheduler accepted invalid intervals and emitted approximate dates

- **Evidence:** `OutboxSchedulerConfig.interval` was passed directly to `tokio::time::interval()`, which panics for a zero duration. The spawned loop ignored a closed cancellation watch channel, allowing a detached receiver to repeatedly observe the closed channel. The timestamp formatter approximated every year as 365 days and every month as 30 days, so emitted timestamps drifted and could name impossible dates.
- **Change made:** Scheduler startup now rejects zero intervals as a typed configuration error before spawning. The loop exits when cancellation is signalled or the sender is dropped, and the handle documentation now reflects cancellation-on-drop with explicit `stop()` available to await shutdown. Timestamp conversion now uses Gregorian civil-date arithmetic.
- **Regression coverage:** Added tests for invalid intervals, epoch/leap-day/year-end date conversion, and retained scheduler emit/stop behavior.
- **Verification:** `cargo test -p background-core` passed (5 tests); `cargo clippy -p background-core --all-targets -- -D warnings`, Rust formatting, and `git diff --check` passed.

### Fixed: stored password verifiers could select excessive Argon2 work factors

- **Evidence:** `PasswordVerifier::verify()` parsed caller/database-sourced PHC text and passed it to Argon2 verification without bounding the text or restricting the embedded algorithm parameters. The pinned Argon2 0.6 verifier derives its work parameters from that parsed PHC record.
- **Change made:** Reject verifier strings over 512 bytes and accept only the generated Argon2id v=19 profile (`m=19456,t=2,p=1`) with a 32-byte output before running password verification.
- **Regression coverage:** Added `crypto-core` coverage for maximum memory/iteration parameters and oversized verifier input, plus `tests/security/password-verifier-governance.test.ts`.
- **Verification:** The focused crypto-core regression and password-verifier security test passed; `cargo clippy -p crypto-core --all-targets -- -D warnings`, Rust formatting, and `git diff --check` passed.
- **Compatibility note:** Verification now intentionally rejects hashes generated with another algorithm, Argon2 version, parameter profile, or output length. This crate currently generates only the pinned profile. Any profile migration needs an explicit compatibility and rehash policy.

### Fixed: an in-flight login could restore a session after logout

- **Evidence:** `NativeSessionStore::authenticate()` performed database authentication before acquiring the session lock. A concurrent `logout()` could clear the current principal while that database check was in progress, after which the older login would install its principal and undo the logout.
- **Change made:** Added an atomic session-transition generation. Authentication captures its generation before the database check and commits only if no later login/logout transition has occurred. Logout increments the generation while clearing the principal.
- **Regression coverage:** Added a native regression proving a stale authentication commit is rejected after logout and `tests/security/native-session-generation-governance.test.ts`.
- **Verification:** The focused native-core regression and session-generation security test passed; `cargo clippy -p native-core --all-targets -- -D warnings`, Rust formatting, and `git diff --check` passed.

### Fixed: bounded sync frames still allowed excessive concurrent buffering

- **Evidence:** The inbound channel held up to 128 frames, each allowed to reach 10 MiB, while each accepted stream allocated its frame buffer before queue backpressure applied. The per-frame bound therefore did not provide a practical bound on aggregate buffered payload memory.
- **Change made:** Reduced inbound queue capacity to 8 and added a shared four-slot semaphore acquired before spawning frame readers and allocating payload buffers. Across queued and active frames, the payload bound is now at most 12 maximum-sized frames (120 MiB), plus bounded per-message and task overhead. Frame size, read timeout, and ACK-after-queue-acceptance behavior are unchanged.
- **Regression coverage:** Updated `tests/security/sync-transport-governance.test.ts` to guard queue/in-flight limits and ensure the permit is acquired before allocation. The iroh loopback test covers connect, bidirectional delivery, and ACK behavior.
- **Verification:** Security transport governance passed; `cargo clippy -p sync-core --all-targets -- -D warnings`, Rust formatting, and `git diff --check` passed. The full crate test initially timed out establishing a loopback connection in the sandbox; the focused loopback test passed on an elevated rerun.

### Fixed: closed sync connections remained in the peer map

- **Evidence:** `IrohSyncEndpoint` inserted connections into its peer map but did not remove them when QUIC closed. `is_connected()` could therefore report a stale connection and outbound sends failed later at stream creation.
- **Change made:** Connection tracking now awaits iroh's close notification and removes the map entry only when its stable connection ID still matches. Replacing a peer connection closes the prior connection, and the stable-ID check prevents its delayed close callback from deleting the replacement.
- **Regression coverage:** Extended the iroh loopback test to disconnect one endpoint and verify both peers' connection status clears; the sync transport governance test checks close tracking and replacement safety.
- **Verification:** The focused iroh loopback test and both sync transport security governance tests passed; `cargo clippy -p sync-core --all-targets -- -D warnings`, Rust formatting, and `git diff --check` passed.

### Fixed: sync endpoint listeners had no explicit shutdown lifecycle

- **Evidence:** `IrohSyncEndpoint::bind()` spawned a listener that owned an `Endpoint` clone and accepted forever. The endpoint API exposed no shutdown operation, and the demo's event-forwarding task held another clone while waiting for inbound messages. The frontend transport's `dispose()` only removed its Tauri event listener, leaving the native endpoint and listener tasks running if the transport was disposed while the process remained alive.
- **Change made:** Added idempotent endpoint shutdown signaling, made listener and inbound receive loops exit on shutdown, and closed the underlying iroh endpoint. Added the `sync_stop_endpoint` Tauri command. Frontend `dispose()` now awaits native shutdown and clears local endpoint/peer state; the demo hook disposes its transport during unmount after any in-progress initialization completes.
- **Regression coverage:** Extended the iroh loopback test to shut down both endpoints and assert inbound receive terminates. The sync transport unit test verifies `dispose()` invokes native stop; security governance checks the Rust, Tauri, and TypeScript shutdown wiring.
- **Verification:** The sync package passed (30 tests) and typecheck; the focused iroh loopback and all three transport security governance tests passed; demo native `cargo check`, sync-core Clippy, Rust formatting, Prettier, and `git diff --check` passed.

### Fixed: sync stream writes and acknowledgements could wait indefinitely

- **Evidence:** Inbound reads were time-limited, but outbound frame prefix/payload writes and the ACK read had no deadline. A peer that stopped consuming or acknowledging could leave `send_envelope()` pending indefinitely.
- **Change made:** Added 30-second deadlines around both outbound writes and the ACK read. Timeout errors identify whether the prefix, payload, or ACK phase expired. Existing frame limits and ACK-after-queue-acceptance semantics remain in place.
- **Regression coverage:** Extended `tests/security/sync-transport-governance.test.ts` to assert the outbound write and ACK deadlines remain wired into the stream operations.
- **Verification:** The focused iroh loopback test, all three sync transport security governance tests, `cargo clippy -p sync-core --all-targets -- -D warnings`, `cargo fmt --all -- --check`, and `git diff --check` passed. The loopback test required an elevated rerun because it stalled during network setup in the sandbox.

### Fixed: leading SQL separators bypassed native command checks

- **Evidence:** `validate_safe_sql()` skipped comments and whitespace but not leading semicolons or UTF-8 byte-order marks. SQLite treats a UTF-8 BOM as whitespace, so either prefix could hide a disallowed command such as `PRAGMA` from the scanner.
- **Change made:** The scanner now skips leading statement separators, whitespace, comments, and UTF-8 BOM sequences before inspecting the first command.
- **Regression coverage:** Added native regression cases and extended native SQL security governance coverage for semicolon-prefixed and BOM-prefixed PRAGMA statements.
- **Verification:** Not run in this pass.

### Fixed: generic SQL bridge accepted transaction-control statements

- **Evidence:** The generic execute command accepted `BEGIN`, `COMMIT`, `END`, `ROLLBACK`, and savepoint statements. Those commands can leave the shared SQLite connection in a caller-managed transaction or alter the transaction wrapper's atomic commit/rollback behavior.
- **Change made:** The SQL safety guard rejects transaction-control commands at the start of all generic query, execute, and transaction operations. The bridge's own transaction management remains the sole transaction boundary.
- **Regression coverage:** Native guard tests cover each transaction-control statement; security governance checks retain those cases.
- **Verification:** Not run in this pass.
