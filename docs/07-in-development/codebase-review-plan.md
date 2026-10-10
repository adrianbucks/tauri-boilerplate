# Codebase Review & Improvement Plan

**Status:** In progress.  
**Baseline inspected:** 2026-10-10. Documentation and native database/IPC paths have been inspected. Most source-level behavior and historical verification claims remain to be audited.

## Goal

Review the repository in small, reviewable slices, correct confirmed defects, improve modularity and atomicity where appropriate, and preserve existing behavior unless an intentional enhancement is documented. Keep conclusions tied to source code and repeatable verification evidence. This plan does not imply that every subsystem is defective or that the repository is production-ready.

## Review rules

- Read the applicable subsystem guide, manifest, architecture notes, and decision records before changing that subsystem.
- Preserve the repository invariants in `AGENTS.md` and `docs/04-guides/agent-guide.md`.
- Record findings with severity, evidence (paths and relevant tests), impact, proposed fix, and regression coverage. Distinguish confirmed defects from risks and questions.
- Keep changes within one coherent boundary where possible. Avoid broad rewrites without a demonstrated need.
- For security, tenant isolation, permission, or data-integrity changes, add focused regression coverage, including `tests/security/` where applicable.
- Consult official documentation for evolving or security-sensitive Tauri, iroh, Drizzle, TanStack, and cryptographic APIs; do not infer APIs from memory.
- Run the verification commands required by the repository guides for each completed slice. Report failures as well as passes; do not make unsupported status claims.
- Update the relevant architecture, reference, status, and development-plan documents alongside implementation.

## Stages

### 0. Documentation and evidence baseline

**Scope:** Repository map, package/crate manifests, dependency boundaries, source and test inventory, CI workflows, status registers, docs links, and claims of completed work.

**Deliverables:** Corrected documentation navigation; an evidence-backed review map; focused plans below; an issue register that separates confirmed issues, risks, and questions. No runtime behavior changes.

**Acceptance:** All documentation links touched in this stage resolve; status claims are either supported by inspected source and reproducible verification or clearly marked pending validation; each implementation slice has scope, invariants, regression coverage, and completion criteria.

### 1. Rust and native boundary

**Scope:** `crates/native-core`, `crates/identity-core`, `crates/crypto-core`, `crates/sync-core`, `crates/background-core`, plus Tauri command adapters in the apps.

**Focus:** SQLite connection and transaction semantics, command validation, error boundaries, secret custody, cryptographic inputs, sync admission, task lifecycle, and native runtime ownership.

**Acceptance:** Confirmed defects have focused regression tests; no secret crosses the documented native boundary; data mutations that require atomic read/modify/write behavior are atomic at the native database boundary; Rust format, clippy, and workspace tests pass as prescribed.

### 2. Platform packages

**Scope:** `packages/` in dependency order, starting with core and database, then identity/authorization/audit, sync protocol/sync/tasks, feature-system, and the remaining packages.

**Focus:** Public API shape, dependency direction, repository-only data access, transaction boundaries, tenant scoping, authorization, idempotency, error propagation, and package cohesion.

**Acceptance:** Package boundaries and exports are intentional; cross-table mutations are demonstrably atomic where required; security and data-integrity changes have regression coverage; prescribed typecheck and test commands pass.

### 3. Features and permission governance

**Scope:** Each directory under `features/`, its manifest, validators, and integration points.

**Focus:** Domain/platform separation, declared sync and pruning policies, permission declarations and enforcement, tenant scoping, audit/outbox participation, and feature dependency ordering.

**Acceptance:** Feature behavior remains behind explicit contracts; permissions and sync behavior are declared and enforced; security-sensitive changes have tests in `tests/security/`; feature validation passes.

### 4. Applications and user-facing flows

**Scope:** `apps/demo` followed by `apps/minimal-consumer`, including UI, bootstrap, native integration, capability files, and app-specific configuration.

**Focus:** UI-to-service-to-repository flow, lifecycle and cleanup, native IPC contracts, capability least privilege, consumer usability, and preserving existing flows.

**Acceptance:** Existing app flows remain covered; capabilities are narrowly scoped and justified; the minimal consumer uses platform contracts without platform modifications; app checks pass.

### 5. Build, release, docs, and final evidence

**Scope:** CI/release workflows, toolchain and dependency configuration, docs and links, status registers, and final verification evidence.

**Focus:** Workflow permissions, signing/provenance claims, reproducibility, supply-chain checks, document accuracy, consistent gate/work-package identifiers, and clear known limitations.

**Acceptance:** Documentation reflects inspected code and current executable evidence; stale links and contradictory status claims are resolved; the repository's prescribed verification pipeline passes, or remaining failures/limitations are explicitly recorded.

## Focused implementation plans

- [Native foundation and IPC review](./review-native-foundation.md)
- [Platform package review](./review-platform-packages.md)
- [Feature and application review](./review-features-and-apps.md)
- [Release, verification, and documentation review](./review-release-and-documentation.md)

## Initial documentation findings (not yet implementation findings)

- `ARCHITECTURE.md` links to `docs/verification/status.md`, which is now archived; the current status index is `docs/06-status/current-state.md`.
- `CONTRIBUTING.md` refers to legacy `docs/verification/` and `docs/development/` locations.
- `docs/06-status/README.md`, `docs/07-in-development/README.md`, `docs/06-status/acceptance-gates.md`, `docs/06-status/work-packages.md`, and `docs/06-status/current-state.md` disagree on the current work-package/gate ranges and/or completion state. Resolve identifiers and claims against the implementation and CI evidence during Stage 0.
- `docs/07-in-development/known-limitations.md` describes WP-016 as pending while current-state and work-package documents describe it as resolved. Reconcile after source and platform-specific evidence review.
- The native boundary review confirmed a comment-obfuscation bypass in the SQL safety guard and a separate generic SQL IPC authorization gap; both are tracked in [the native review plan](./review-native-foundation.md). The bypass fix has regression cases; the authorization gap requires a design and consumer inventory before implementation.
- Native DB/IPC design review confirms registered `db_query`, `db_execute`, and `db_transaction` commands accept caller-provided SQL without native session authorization or table/tenant policy. Direct invocation bypasses TypeScript repository and service authorization. Tauri command allowlisting is defense in depth, not a substitute for replacing or constraining generic SQL; the transaction redesign must resolve this boundary with read-dependent atomic workflows.
- The demo diagnostics renderer no longer submits caller-built SQL; a fixed native command supplies its count metrics. The generic SQL bridge remains exposed for platform package storage and still requires a broader authorization-aware redesign.
- The package review found and fixed raw-user-ID authorization bypasses in sync membership approval, rejection, and revocation, then added organisation ownership checks and transactional defaults. Pairing now checks the validated handshake and target group's organisation. Malformed permission scope data now fails closed. The broader native transaction incompatibility is recorded in [the platform package plan](./review-platform-packages.md).
- The database review found that the memory driver reported WAL and foreign-key guarantees without providing them; foreign keys are now enabled and health values are measured, with focused package tests and typecheck passing.
- Native transaction review confirmed that interactive reads are unsupported by the production IPC bridge and found queued writes falsely reported zero affected rows. The result type now represents the count as unavailable while writes are queued; the broader transaction design and production-driver coverage remain open in [the platform package plan](./review-platform-packages.md).
- The sync manager no longer emits connected/authorized states from caller-provided peer metadata; it fails closed pending a trusted transport admission verifier. Full seven-layer inbound/outbound admission remains open in the platform and native review plans.
- Native sync review traced inbound QUIC frames directly to application receive handlers before device admission, tenant, membership, protocol, and namespace checks; this is recorded in the native review plan as a high-priority security design item.
- The demo UI calls native widget commands that bypass the TypeScript feature service: native create checks permission and tenant only, native list returns all same-organisation groups, and `grp_demo` plus an approved local-device membership are not provisioned. This is tracked as a security-sensitive feature/app item; its fix must align native transactions, app-owned domain policy, and explicit membership provisioning.
- Native sync framing now applies symmetric 10 MiB bounds, 30-second inbound read timeouts, and acknowledges only after bounded-queue acceptance. Seven-layer admission before handler delivery remains unresolved.
- Organisation creation currently persists active tenants without bootstrapping a tenant administrator or recording an onboarding state; the cross-path bootstrap contract is tracked in [the feature and application review](./review-features-and-apps.md).
- Database review found SQL injection through dynamically interpolated repository identifiers; the base repository now rejects unsafe sort and column identifiers with security regression coverage.
- Database transactions now serialize independently in the memory adapter, expose intentional nesting through `TransactionClient.savepoint()`, and reject transaction-client use after callback completion. Native savepoints discard queued operations on nested failure; integration coverage verifies import writes join the caller's transaction.
- Shared repository pagination now rejects invalid limits and offsets before SQL execution; explicit page sizes are capped at 1,000 while no-pagination calls preserve their existing behavior.
- Identity review removed identifier-only session creation, made native session-view establishment private, and added consistency checks during native session restoration.
- Device key persistence now uses no-replace creation (atomic temp-file publication on Unix), rejects symlink/special-file paths, and enforces Unix `0600` permissions; Windows ACL validation remains open.
- Identity key handling now zeroizes temporary seed/file buffers and enables zeroization for the retained Ed25519 signing key; identity-core, security governance, Clippy, and formatting checks pass.
- Rust HLC generation now serializes the timestamp/counter transition and advances on counter overflow; concurrency and overflow regressions pass in `crypto-core`.
- TypeScript HLC now compares the ISO timestamp formats used by note outbox operations, rejects malformed values, and avoids imprecise numeric subtraction; protocol, conflict-resolution, and security regressions pass.
- Sync envelope runtime validation now binds the inbox ID to the signed operation ID and rejects malformed envelopes before transport dispatch or inbox persistence; protocol, inbox, transport, and security regressions pass.
- Authorization review found that trusted contexts are recognized by object shape rather than native session provenance; this needs a coordinated native authorization-boundary design.
- Feature-system review now snapshots and freezes validated manifests, protects cached collections, validates sync namespace/conflict policy declarations, and rejects fractional migration versions; focused package tests and typecheck pass.
- Platform initialization now preserves dependency resolver ordering across feature-owned migration groups; an integration test covers a dependency whose feature ID sorts after its dependent.
- Maintenance now rejects negative/unbounded batch sizes and invalid retention windows before pruning; all effective policies are prevalidated to avoid partial maintenance caused by later bad configuration.
- Built-in pruners now enforce batch and cutoff validity themselves, so direct handler invocation cannot bypass the orchestrator's deletion bounds.
- Declarative pruning handlers now freeze a snapshot of validated policy identifiers and filter expressions, preventing post-registration mutation from changing SQL.
- Import validation now treats missing data/errors and validator exceptions as row failures, preserves falsy valid values, and reports failed row counts accurately.
- Import execution now enforces each definition's accepted file formats and validates commit counts inside the transaction, rolling back inconsistent import results.
- Spreadsheet exports neutralize formula markers after leading whitespace, reject duplicate or empty sanitized headers, and validate XLSX worksheet names; focused export regressions pass.
- Keyboard-wedge scanning now requires a prompt terminator and validates its timing/length options, preventing delayed manual typing from being reported as a scan.
- Shared data-table sorting now uses keyboard-accessible buttons and announces its current sort direction to assistive technology.
- Theme persistence rejects unknown values, tolerates unavailable browser storage, and enforces the documented provider boundary; theme controls expose accessible state.
- Shared input fields now associate validation errors with unique field IDs, preserve existing help descriptions, and expose invalid state to assistive technology.
- Minimal-consumer note listing now scopes ungrouped reads to the active organisation and excludes tombstoned rows; cross-tenant regression coverage passes.
- Minimal-consumer integration setup now seeds the referenced sync group, keeping the outbox test valid under enforced foreign keys.
- Authorization role and effective-grant persistence now flows through `AuthorizationRepository`; affected feature services delegate subject resolution to `AuthorizationEngine.requireForSubject()`.
- Minimal-consumer note mutations now use canonical envelopes and an injected native signer; malformed or unavailable signing rolls back note/outbox transactions instead of persisting placeholder signatures.
- Note updates now reject empty/invalid patches, and organisation-scoped lookups exclude tombstones so deleted notes cannot be read or changed through the service API.
- Note reads and mutations now require active sync-group membership for the caller's device/user; ungrouped note lists are limited to approved groups.
- Task queue review replaced the select/update/reselect claim sequence with one conditional `UPDATE ... RETURNING`, preventing concurrent workers from receiving the same task. Workers now leave queued tasks untouched until handlers are registered and filter claims to supported types; package tests and typecheck passed.
- The task enqueue review confirmed the partial unique index prevented duplicate active keys but concurrent callers did not fulfill the API's deduplicating return contract. Enqueue now resolves a competing insert to the active winning task; concurrency coverage passes.
- Task failure transitions now reject non-running records and use attempt-count compare-and-set updates, preventing stale failures from changing a later attempt; package coverage passes.
- Task enqueue now validates retry values, task identifiers, timeouts, and JSON payload serializability before writing. A forward-only migration now persists configured retry jitter and aligns task records and retry calculation with it.
- Worker shutdown now awaits an active claim poll before inspecting in-flight tasks, closing a race that allowed stop() to return before claimed work was dispatched and completed.
- Worker options now reject invalid concurrency/timing values before applying configuration, and graceful shutdown clears its timeout when handlers finish promptly.
- Worker observers are now isolated from queue lifecycle transitions: claimed tasks dispatch before poll notifications, callback errors are logged, and execution promise failures are contained.

## Decision and change log

| Date       | Decision / update                                                                                                                                                                                                                                                  |
| :--------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-10 | Reconciled stale documentation links and qualified unverified status claims; added four focused review plans.                                                                                                                                                      |
| 2026-10-10 | Native SQL guard review confirmed a comment-obfuscation bypass; focused fix and regression cases added.                                                                                                                                                            |
| 2026-10-10 | Native IPC review confirmed that generic SQL commands bypass service authorization; design/inventory work is needed before a safe fix.                                                                                                                             |
| 2026-10-10 | Sync membership approval, rejection, and revocation now require a context and permission check; security regression added.                                                                                                                                         |
| 2026-10-10 | Membership decisions and pairing now enforce group tenant ownership; permission scope parsing fails closed for malformed or non-object JSON.                                                                                                                       |
| 2026-10-10 | Memory SQLite now enforces foreign keys and reports actual engine health instead of hard-coded WAL/constraint claims.                                                                                                                                              |
| 2026-10-10 | Sync package review identified that manager authorization state is asserted without the required authenticated admission evidence.                                                                                                                                 |
| 2026-10-10 | Native sync review found inbound framed payloads reach TypeScript receive handlers before seven-layer admission checks.                                                                                                                                            |
| 2026-10-10 | Base repository validates dynamic sort and column identifiers before SQL construction; security regression coverage added.                                                                                                                                         |
| 2026-10-10 | Identity package no longer creates sessions from identifiers alone; native restoration checks user, tenant, and device consistency.                                                                                                                                |
| 2026-10-10 | Authorization review found structurally forged trusted contexts can select any persisted user; native provenance verification remains open.                                                                                                                        |
| 2026-10-10 | Native queued transaction writes no longer claim zero affected rows before execution; interactive transaction reads remain an architectural limitation.                                                                                                            |
| 2026-10-10 | Demo diagnostics now uses a fixed native count command instead of directly invoking the generic SQL bridge; the generic bridge risk remains open.                                                                                                                  |
| 2026-10-10 | Native sync frames are bounded, slow reads time out, and transport ACK follows inbound queue acceptance; peer admission remains open.                                                                                                                              |
| 2026-10-10 | Device key files now use no-replace creation and restrictive Unix permissions; Windows ACL review remains open.                                                                                                                                                    |
| 2026-10-10 | SyncManager no longer treats caller metadata as a connected or authorized peer; admission verifier and transport integration remain open.                                                                                                                          |
| 2026-10-10 | Task claims now return only rows atomically transitioned to RUNNING; workers with no handlers skip claiming, preserving queued work during startup.                                                                                                                |
| 2026-10-10 | Concurrent enqueue calls now return the active task selected by the unique-key index instead of surfacing a duplicate-key error.                                                                                                                                   |
| 2026-10-10 | Task failure updates are fenced by RUNNING state and attempt count; cancelled or reclaimed tasks are protected from stale workers.                                                                                                                                 |
| 2026-10-10 | Task definitions are validated before persistence; migration v5 stores retry jitter and the worker uses the persisted policy.                                                                                                                                      |
| 2026-10-10 | TaskWorker stop now waits for claim polling and dispatch before awaiting active handlers, preventing work from continuing after reported shutdown.                                                                                                                 |
| 2026-10-10 | TaskWorker validates positive safe-integer timing/concurrency values and clears the graceful-stop timeout after early completion.                                                                                                                                  |
| 2026-10-10 | TaskWorker isolates observer callback failures so they cannot strand claimed tasks or produce unhandled execution rejections.                                                                                                                                      |
| 2026-10-10 | Feature registry snapshots validated manifests and validates sync policy metadata before registration; package tests and typecheck pass.                                                                                                                           |
| 2026-10-10 | Platform startup now applies feature migration groups in dependency order instead of re-sorting owners alphabetically.                                                                                                                                             |
| 2026-10-10 | Maintenance validates batch and retention configuration before pruning, preventing negative SQLite LIMIT values from becoming unbounded deletes.                                                                                                                   |
| 2026-10-10 | Built-in maintenance handlers validate pruning contexts at the delete boundary, including direct calls outside the orchestrator.                                                                                                                                   |
| 2026-10-10 | Declarative pruners retain immutable policy snapshots so SQL identifiers and filters cannot change after constructor validation.                                                                                                                                   |
| 2026-10-10 | Import row validation fails closed for incomplete validator results and exceptions while accepting falsy but defined records.                                                                                                                                      |
| 2026-10-10 | Import formats are enforced and invalid commit counts cause transaction rollback instead of misleading success summaries.                                                                                                                                          |
| 2026-10-10 | Spreadsheet exports neutralize whitespace-prefixed formulas and reject ambiguous headers and invalid XLSX worksheet names; package tests pass.                                                                                                                     |
| 2026-10-10 | Keyboard-wedge scanner checks terminator timing and validates options; regression tests cover delayed manual input and invalid configuration.                                                                                                                      |
| 2026-10-10 | Data-table sorting is keyboard accessible and communicates sort state with `aria-sort`; UI regression coverage and typecheck pass.                                                                                                                                 |
| 2026-10-10 | Theme state is validated and storage failures are contained; `useTheme` enforces provider usage and controls expose accessible state.                                                                                                                              |
| 2026-10-10 | Shared inputs generate unique IDs and expose associated validation errors with `aria-invalid` and `aria-describedby`; UI tests and typecheck pass.                                                                                                                 |
| 2026-10-10 | Minimal-consumer note listing is organisation-scoped and excludes deleted rows; tenant-isolation security regression and app typecheck pass.                                                                                                                       |
| 2026-10-10 | Minimal-consumer test fixture seeds its required sync group; package integration test passes with database foreign-key enforcement enabled.                                                                                                                        |
| 2026-10-10 | Authorization role/grant reads moved behind a repository; service tests and cross-tenant role-binding security regression pass.                                                                                                                                    |
| 2026-10-10 | Minimal-consumer sync writes require a native signing dependency and canonical envelope builder; signer failures are atomic and covered in security tests.                                                                                                         |
| 2026-10-10 | Minimal-consumer rejects no-op/invalid updates and excludes tombstoned notes from direct access; lifecycle and security regressions pass.                                                                                                                          |
| 2026-10-10 | Notes enforce active group membership for reads and writes and filter ungrouped lists to approved groups; focused security tests pass.                                                                                                                             |
| 2026-10-10 | Sync-group persistence moved behind `SyncGroupRepository`; lifecycle and user-bound membership regression checks pass.                                                                                                                                             |
| 2026-10-10 | Identity-admin user/role/device writes moved behind a feature repository; lifecycle tests, typecheck, and formatting checks pass.                                                                                                                                  |
| 2026-10-10 | Widget access now enforces sync-group membership; widget repository maps SQLite rows to typed records, with feature and security regressions passing.                                                                                                              |
| 2026-10-10 | Widget mutations now keep authorization, membership checks, and persistence atomic; invalid empty or malformed updates are rejected and covered.                                                                                                                   |
| 2026-10-10 | Widget quantities are validated as safe integers and direct ID reads now exclude tombstones; feature and security lifecycle regressions pass.                                                                                                                      |
| 2026-10-10 | Organisation updates now validate meaningful input and keep authorization, scoped lookup, and persistence in one transaction.                                                                                                                                      |
| 2026-10-10 | Identity-admin role assignment now requires `roles.manage` and a role owned by the target organisation; privilege-escalation regressions pass.                                                                                                                     |
| 2026-10-10 | Device approval now binds request and device IDs and rejects decided requests; revocation requires an active group membership and a reason.                                                                                                                        |
| 2026-10-10 | Device approval/revocation now require an existing device identity; approval also rejects revoked or unregistered device states.                                                                                                                                   |
| 2026-10-10 | Membership rejection now requires a pending request, preventing conflicting approval/rejection decisions.                                                                                                                                                          |
| 2026-10-10 | Peer device registration now uses exact identity lookup behind a repository; local device identity is explicit and session validation uses its bound device ID.                                                                                                    |
| 2026-10-10 | Pairing no longer accepts an unsigned peer user ID; device and membership bindings come from the authenticated operation context, with security regression coverage.                                                                                               |
| 2026-10-10 | Import commit callbacks receive only the required transaction client, preventing feature commits from accidentally escaping atomic import transactions.                                                                                                            |
| 2026-10-10 | Keyboard-wedge scanner listener replacement clears partial input, preventing scan data from crossing listener lifetimes.                                                                                                                                           |
| 2026-10-10 | Shared data-table filter and clickable rows now expose accessible names and keyboard interaction affordances.                                                                                                                                                      |
| 2026-10-10 | Native generic SQL query results now have row, column, and response-size caps; authorization and query-cost controls remain open.                                                                                                                                  |
| 2026-10-10 | Native generic SQL inputs now cap statement size, parameter count/value size, request size, and transaction operation count.                                                                                                                                       |
| 2026-10-10 | Native SQL parameter binding rejects unsigned integers outside SQLite's signed integer range instead of wrapping them negative.                                                                                                                                    |
| 2026-10-10 | Native query paths now reject DML statements with `RETURNING`, preserving read-only command semantics.                                                                                                                                                             |
| 2026-10-10 | Native transaction documentation now reflects that queued writes omit affected-row counts rather than reporting zero.                                                                                                                                              |
| 2026-10-10 | Native signature commands bound message hex before decoding and validate fixed key/signature lengths; input-bound regression checks pass.                                                                                                                          |
| 2026-10-10 | Identity provider enforces the signing-message cap for all Rust callers; native SQL bridge migration now records app/consumer inventory, B-01 incompatibilities, and a safe staged replacement sequence.                                                           |
| 2026-10-10 | Background scheduler rejects zero intervals, exits when its cancellation channel closes, and emits valid Gregorian UTC timestamps; crate tests and Clippy pass.                                                                                                    |
| 2026-10-10 | Password verification bounds PHC input and pins Argon2id algorithm/version/costs before work; focused crypto and security regressions pass.                                                                                                                        |
| 2026-10-10 | Native session transitions reject stale authentication completions after logout or a newer login; native and security regressions pass.                                                                                                                            |
| 2026-10-10 | Sync receive now limits queued frames to 8 and concurrent frame readers to 4 before allocation; loopback and transport governance checks pass.                                                                                                                     |
| 2026-10-10 | Sync endpoint removes closed peer connections by matching stable connection identity; loopback verifies both sides clear stale status.                                                                                                                             |
| 2026-10-10 | Sync endpoint, Tauri state, and frontend transport now have explicit shutdown/dispose wiring; loopback and package lifecycle checks pass.                                                                                                                          |
| 2026-10-10 | Sync outbound frame writes and ACK reads now have 30-second deadlines; the elevated loopback, security governance, Clippy, and formatting checks pass.                                                                                                             |
| 2026-10-10 | Sync eligibility rejects pending and suspended devices, uses the identity service, and passes sync tests/typecheck plus 16 focused security tests.                                                                                                                 |
| 2026-10-10 | Sync outbox batch reads reject negative, fractional, and oversized limits; sync tests/typecheck and the transport governance regressions pass.                                                                                                                     |
| 2026-10-10 | Sync outbox retry thresholds require positive safe integers before failure updates; 42 sync tests, typecheck, and security governance checks pass.                                                                                                                 |
| 2026-10-10 | Sync outbox sent/failed transitions update only pending rows; 44 sync tests, typecheck, and security governance checks pass.                                                                                                                                       |
| 2026-10-10 | Sync envelope and outbox validation enforce the native 10 MiB frame cap; 40 protocol tests, 45 sync tests, typechecks, and governance checks pass.                                                                                                                 |
| 2026-10-10 | Task diagnostic list limits are positive safe integers capped at 100; 56 task tests, typecheck, and security governance pass.                                                                                                                                      |
| 2026-10-10 | Shared repository pagination validates limits and offsets before database access; 16 database tests, typecheck, and 5 query governance tests pass.                                                                                                                 |
| 2026-10-10 | Outbox sync cancellation preserves pending envelopes and avoids partial-success cursors; 57 task tests and task typecheck pass.                                                                                                                                    |
| 2026-10-10 | Outbox transport now persists and dispatches the full signed envelope; migration 7 adds storage, and legacy incomplete rows fail visibly. Sync/task tests and platform typecheck pass.                                                                             |
| 2026-10-10 | Outbox reads and dispatch are scoped to the task's organisation; mismatched task context is rejected before querying. Sync/task tests, typechecks, and transport governance pass.                                                                                  |
| 2026-10-10 | Outbox validates each persisted envelope against protocol rules and row metadata before dispatch; cross-tenant envelope tampering is rejected and covered by security regression checks.                                                                           |
| 2026-10-10 | Interrupted maintenance now reports failure and propagates from the task worker instead of completing as successful; maintenance/task tests and typechecks pass.                                                                                                   |
| 2026-10-10 | Feature pruning policies are preflighted and committed as a batch, preventing failed feature registration from leaving partial feature or pruning state; maintenance/platform tests and typechecks pass.                                                           |
| 2026-10-10 | Duplicate sync policies for an entity are rejected before replacing conflict behavior or mutating platform feature state; sync-protocol/platform tests and typechecks pass.                                                                                        |
| 2026-10-10 | Pruning retention values must be positive and finite at manifest and pruner boundaries; feature-system and maintenance tests/typechecks pass.                                                                                                                      |
| 2026-10-10 | Maintenance diagnostics now expose count-query failures instead of presenting them as zero; the demo labels inspection errors and its typecheck passes.                                                                                                            |
| 2026-10-10 | Inspection now isolates invalid custom-handler retention metadata per handler; 15 maintenance tests and typecheck pass.                                                                                                                                            |
| 2026-10-10 | In-memory database query statements are released on binding/iteration failures; 17 database tests and typecheck pass.                                                                                                                                              |
| 2026-10-10 | In-memory transaction state now resets after connection interruption; 18 database tests and typecheck pass.                                                                                                                                                        |
| 2026-10-10 | Transaction clients now have explicit savepoints and callback lifetimes; memory transactions serialize, native nested failures discard queued work, and import joins its caller transaction. Database/integration tests, workspace typecheck, and formatting pass. |
| 2026-10-10 | Base repository now rejects empty runtime insert records before SQL construction; 22 database tests and typecheck pass.                                                                                                                                            |
| 2026-10-10 | Base repository now rejects camelCase/snake_case aliases that normalize to duplicate SQL columns; 23 database tests and typecheck pass.                                                                                                                            |
| 2026-10-10 | Migration definitions are preflighted for valid metadata and duplicate owner/version identities before database mutation; 25 database tests and typecheck pass.                                                                                                    |
| 2026-10-10 | Migration application now rejects missing historical identities for owners in the supplied batch; 26 database tests and typecheck pass.                                                                                                                            |
| 2026-10-10 | Base repository now validates table identifiers before SQL construction; 27 database tests and typecheck pass.                                                                                                                                                     |
| 2026-10-10 | BaseRepository.softDelete now requires declared tombstone support; database tests and database/example/minimal-consumer typechecks pass.                                                                                                                           |
| 2026-10-10 | Spreadsheet parser and row-conversion failures now surface as typed validation errors; malformed XLSX regression, 17 package tests, typecheck, and formatting pass.                                                                                                |
| 2026-10-10 | Worksheet dimensions are checked against row/cell budgets before object conversion; import-export tests (18), typecheck, and formatting pass.                                                                                                                      |
| 2026-10-10 | Import row validation now fails closed when a validator returns data alongside errors; import-export tests (19), typecheck, and formatting pass.                                                                                                                   |
| 2026-10-10 | Import validation now normalizes reported errors to their source row and safely rejects malformed entries; import-export tests (20) and typecheck pass.                                                                                                            |
| 2026-10-10 | Import parsing now rejects blank and duplicate headers before conversion to prevent silent column remapping; import-export tests (21), typecheck, and formatting pass.                                                                                             |
| 2026-10-10 | Import commit failures now emit a post-rollback failure audit; dual commit/audit failures remain observable; import-export tests (22) and typecheck pass.                                                                                                          |
| 2026-10-10 | Export worksheet names are validated before record accessors run; import-export tests (23) and typecheck pass.                                                                                                                                                     |
| 2026-10-10 | Spreadsheet formula neutralization now covers non-ASCII whitespace and BOM prefixes; import-export tests (27) and typecheck pass.                                                                                                                                  |
| 2026-10-10 | Keyboard-wedge scan state is cleared before callback delivery so consumer exceptions cannot retain stale data; hardware tests (8) and typecheck pass.                                                                                                              |
| 2026-10-10 | ThemeProvider now tracks operating-system color-scheme changes while in system mode and cleans up the listener; UI tests (6), single-worker Vitest, and UI typecheck pass.                                                                                         |
| 2026-10-10 | App-shell navigation now exposes accessible item names, current-page state, and sidebar toggle state; UI tests (7) and typecheck pass.                                                                                                                             |
| 2026-10-10 | Maintenance inspection rejects negative, fractional, or non-finite custom candidate counts and reports them as handler errors; maintenance tests (19) and typecheck pass.                                                                                          |
| 2026-10-10 | Declarative pruning filters are restricted to single-column literal comparisons at manifest and handler boundaries; feature-system (20), maintenance (19), security (6), and typechecks pass.                                                                      |
| 2026-10-10 | DataTable now rejects invalid pagination sizes before initializing TanStack Table; UI tests (12) and typecheck pass.                                                                                                                                               |
| 2026-10-10 | UI architecture docs now describe implemented behavior; removed unused workspace/component/Vite-plugin dependencies and refreshed lockfile; UI tests/typecheck and diff checks pass.                                                                               |
| 2026-10-10 | UI now declares React as a peer dependency and React DOM as test-only; lockfile, UI tests (12), and typecheck pass.                                                                                                                                                |
| 2026-10-10 | Console logging now recursively redacts sensitive nested fields and safely handles cycles/bigints; core tests (8), log-redaction security test, and typechecks pass.                                                                                               |
| 2026-10-10 | Organisation domains now have a normalized unique index in TypeScript and native migrations, with matching case/whitespace-normalized preflight lookups; typechecks and formatting pass.                                                                           |
| 2026-10-10 | Identity helper now distinguishes ephemeral provider generation from persistence; the misleading metadata-only legacy method is deprecated; identity-core typecheck and Rust formatting pass.                                                                      |
| 2026-10-10 | Native device-key reconciliation now changes the local-device marker atomically and clears an old marker before promoting a matching peer row; native-core typecheck passes.                                                                                       |
| 2026-10-10 | Existing device-key permissions are now restricted through the opened file handle before a bounded seed read; native/security typechecks and formatting pass.                                                                                                      |
