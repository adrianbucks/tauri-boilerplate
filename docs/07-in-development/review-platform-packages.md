# Focused Plan: Platform Package Review

**Status:** In progress; package slices are being reviewed and recorded incrementally against the source and verification evidence.

## Scope and order

Review each package independently while checking its dependency edges:

1. `core`, `database`, `platform`
2. `identity`, `authorization`, `audit`
3. `sync-protocol`, `sync`, `tasks`
4. `feature-system`
5. `maintenance`, `import-export`, `hardware`, `ui`

Adjust ordering if manifests show different real dependencies. This is a review route, not a presumed architecture verdict.

## Review questions

- Are package exports small, typed, and stable, and are dependencies pointed in the documented direction?
- Do services use repository abstractions rather than reaching around them to issue SQL?
- Are tenant scope and authorization required at the mutation boundary and difficult to bypass accidentally?
- Do entity, audit, and outbox writes share a transaction when they represent one business mutation?
- Are retries and duplicate delivery safe and idempotent? Are errors typed, propagated, and actionable?
- Do schemas and migrations preserve existing data and enforce intended constraints?
- Do packages avoid importing application or feature-specific behavior?

## Implementation and verification

Fix confirmed problems within a coherent package boundary. Add package tests for behavior changes and `tests/security/` tests for security or tenant changes. Run relevant package typechecks/tests during work, followed by the repository-level TypeScript typecheck and test/security/sync/feature validation gates prescribed by the guides.

## Acceptance criteria

- Dependency direction and public APIs are documented and validated against actual manifests/source.
- Tenant, authorization, audit, and replication invariants are covered at their actual enforcement boundaries.
- Multi-record mutations have explicit atomicity guarantees and failure-path tests.
- No package gains domain behavior that belongs in `features/` or `apps/`.
- Findings and verification are recorded in the parent [review plan](./codebase-review-plan.md).

## Findings

### Fixed: failed import commits were not audited

- **Evidence:** Validation failures emitted `IMPORT_FAILED`, but exceptions during transactional commit rolled back and escaped without a corresponding failure event, despite `executeImport()` documenting start/completion/failure auditing.
- **Change made:** After the import transaction rolls back, emit `IMPORT_FAILED` in a separate database operation with entity, row count, commit phase, and error type. If recording that event also fails, throw a `DatabaseError` retaining both failures as its cause rather than silently dropping the audit failure.
- **Regression coverage:** A commit callback that writes and then throws leaves no imported row and records `IMPORT_STARTED` followed by `IMPORT_FAILED`; impossible commit counts also produce a failure audit.
- **Verification:** Import-export tests passed (22); import-export typecheck and formatting passed.

### Fixed: invalid worksheet names were checked after export accessors ran

- **Evidence:** `ExportEngine.toXlsx()` evaluated every configured accessor and built export rows before validating the worksheet name. An invalid configuration could therefore trigger expensive or side-effecting accessors before rejection.
- **Change made:** Worksheet-name validation now runs immediately after export-definition validation, before records or accessors are processed.
- **Regression coverage:** A test asserts that an invalid worksheet name rejects without invoking the configured accessor.
- **Verification:** Import-export tests (23) and typecheck passed; formatting passed.

### Fixed: formula neutralization missed non-ASCII leading whitespace

- **Evidence:** Export sanitization recognized only ASCII spaces, tabs, carriage returns, and line feeds before spreadsheet formula markers. Other whitespace characters could leave a formula marker at the start after a spreadsheet consumer trims the prefix.
- **Change made:** Formula marker detection now treats JavaScript whitespace and the BOM character as leading whitespace for both CSV and XLSX string values.
- **Regression coverage:** CSV export tests cover form feed, vertical tab, non-breaking space, and BOM prefixes.
- **Verification:** Import-export tests (27) and typecheck passed; formatting passed.

### Fixed: duplicate spreadsheet headers could silently remap imported columns

- **Evidence:** The pinned SheetJS parser renames duplicate object headers (for example, the second `SKU` becomes `SKU_1`). An import validator reading `SKU` could then silently ignore the duplicated source column, producing ambiguous or incomplete records. Blank headings also have no stable mapping.
- **Change made:** Inspect the declared header row before object conversion and reject empty headings or duplicate headings after whitespace trimming and case normalization.
- **Regression coverage:** CSV inputs with duplicate and empty headings reject before conversion.
- **Verification:** Import-export tests passed (21); import-export typecheck and formatting passed.

### Fixed: malformed validator errors could crash counting or misattribute rows

- **Evidence:** `ImportEngine.validate()` previously copied validator-provided error objects directly into the result. A null entry could later crash `failedRows` calculation, while an incorrect `rowIndex` could attribute a failure to another row and undercount failures.
- **Change made:** Validate each reported error entry's required fields and assign its row index from the actual input position. Malformed entries become a safe row-level validation failure.
- **Regression coverage:** Error row indices are normalized to the current row; a null error entry produces a row-level error instead of crashing.
- **Verification:** Import-export tests passed (20); import-export typecheck and formatting passed.

### Fixed: row validation errors could be ignored when data was also returned

- **Evidence:** `ImportEngine.validate()` accepted any result with `valid: true` and defined data before checking its `errors` field. A validator could therefore report a row error while the engine committed that row as valid.
- **Change made:** Treat any non-empty validator error list as a row failure before considering the `valid` flag or returned data. Malformed non-array error collections are converted into row validation failures.
- **Regression coverage:** A validator returning `valid: true`, data, and a row error produces no valid row and preserves the error.
- **Verification:** Import-export tests passed (19); import-export typecheck and formatting passed.

### Improved: worksheet dimensions are bounded before row conversion

- **Evidence:** The import engine enforced its cell-count limit only after `sheet_to_json()` materialized worksheet rows. A wide or sparse worksheet range could therefore incur excessive conversion work before the existing cell limit took effect.
- **Change made:** Decode the worksheet's declared range before conversion; reject invalid dimensions, excessive row counts, and estimated cell counts above the configured cap. Existing post-conversion checks remain for actual row and value limits.
- **Regression coverage:** A CSV with more than 100,000 declared columns is rejected at the worksheet-range boundary.
- **Verification:** Import-export tests passed (18); import-export typecheck and formatting passed.

### Fixed: malformed spreadsheet parser failures escaped as untyped errors

- **Evidence:** `ImportEngine.parseBuffer()` called SheetJS workbook parsing and row conversion without an error boundary. Malformed XLS/XLSX inputs could expose dependency-specific exceptions to callers; a named first sheet with no worksheet object was also treated as a successful empty import.
- **Change made:** Wrap workbook and row conversion failures in typed `ValidationError`s and reject a missing first worksheet explicitly.
- **Regression coverage:** A truncated XLSX signature input is rejected with `ValidationError` and a stable import parse message.
- **Verification:** Import-export tests passed (17); import-export typecheck and formatting passed.

### Fixed: soft deletion was callable for repositories without tombstone columns

- **Evidence:** `BaseRepository.softDelete()` emitted updates to `deleted_at`, `deleted_by`, and `delete_operation_id` for every subclass, even though `supportsSoftDelete` is opt-in and `findAll()` already uses it as the schema capability flag.
- **Change made:** Reject soft deletion when the repository does not declare soft-delete support, before attempting SQL.
- **Regression coverage:** A repository without tombstone support rejects the call and leaves the connection usable; soft-delete-capable repository tests remain green.
- **Verification:** Database tests passed (28); database, example-feature, and minimal-consumer typechecks passed; formatting passed.

### Fixed: repository table names were interpolated without validation

- **Evidence:** `BaseRepository` validated dynamic sort and column names but interpolated the subclass-provided `tableName` directly into `SELECT`, `INSERT`, and `UPDATE` statements. An unsafe runtime subclass value could alter the generated SQL identifier context.
- **Change made:** Validate table names with the same strict identifier rule before every repository SQL operation.
- **Regression coverage:** A malicious table name is rejected before query execution, and the database connection remains usable.
- **Verification:** Database tests passed (27); database typecheck and formatting passed.

### Fixed: removed applied migrations were silently ignored

- **Evidence:** `MigrationEngine` checked checksums only for supplied definitions. If an already-applied migration disappeared from the supplied list, the engine silently proceeded, masking migration-history drift and potentially leaving later schema assumptions unsupported.
- **Change made:** For owners represented in the supplied migration batch, compare persisted identities against the complete supplied set and fail closed if an applied migration is missing. Other owners are excluded so platform and feature batches can be applied independently.
- **Regression coverage:** Applies one feature migration, then supplies a later version without the historical definition; the engine rejects and leaves the recorded history unchanged.
- **Verification:** Database tests passed (26); database typecheck and formatting passed.

### Fixed: duplicate migration identities could partially apply an invalid batch

- **Evidence:** `MigrationEngine.applyMigrations()` sorted and applied definitions as it iterated. Two definitions with the same owner/version identity could therefore apply the first migration and fail only when the second attempted to record the same primary key. Invalid versions and empty metadata were also discovered only during database operations.
- **Change made:** Preflight the complete migration list before creating migration state or applying SQL. Require valid positive safe-integer versions and non-empty owner/name/checksum/SQL strings; reject duplicate owner/version identities.
- **Regression coverage:** Duplicate and invalid migration definitions reject before any migration table or migration SQL is created.
- **Verification:** Database tests passed (25); database typecheck and formatting passed.

### Fixed: repository field aliases could target the same SQL column

- **Evidence:** `BaseRepository` converts camelCase property names to snake_case column identifiers. Runtime records containing both `createdAt` and `created_at` therefore generated duplicate target columns; updates could similarly assign the same column more than once with order-dependent values.
- **Change made:** Insert and update now reject field sets whose normalized SQL column names are not unique, in addition to validating each identifier.
- **Regression coverage:** Insert and update collision cases fail before SQL execution and leave the connection usable.
- **Verification:** Database tests passed (23); database typecheck and formatting passed.

### Fixed: empty repository inserts produced malformed SQL

- **Evidence:** `BaseRepository.insert()` accepted an empty runtime object and generated `INSERT INTO table () VALUES ()`, which SQLite rejects with a low-level syntax error instead of a repository validation error.
- **Change made:** Reject non-record values and records with no enumerable fields before constructing SQL.
- **Regression coverage:** An empty record rejects with a typed validation message, and the connection remains usable afterward.
- **Verification:** Database tests passed (22); database typecheck and formatting passed.

### Fixed: concurrent memory transactions were treated as nested savepoints

- **Evidence:** `MemoryDatabaseConnection.transaction()` previously inferred nesting from a shared active-transaction flag. An independent call made while another callback was awaiting work created a savepoint in that transaction, so the calls could become coupled.
- **Change made:** Top-level memory transactions now queue serially. Intentional nested work uses the explicit `TransactionClient.savepoint()` contract. Both adapters scope transaction clients to their callback; the native adapter drops queued operations when a savepoint callback fails.
- **Regression coverage:** Controlled overlap verifies a failed first transaction rolls back without discarding the queued second transaction. Savepoint tests verify nested rollback in memory and native operation buffers, and escaped clients reject later operations.
- **Verification:** Database tests passed (21); database typecheck passed; integration tests passed (2) and integration typecheck passed; full workspace TypeScript typecheck passed (41 tasks); formatting and `git diff --check` passed.

### Fixed: in-memory SQLite queries leaked prepared statements on failure

- **Evidence:** `MemoryDatabaseConnection.query()` and transaction-scoped `query()` freed prepared statements only after successful binding and row iteration. A binding or iteration error bypassed `stmt.free()`, retaining SQLite/WASM resources on a long-lived test or memory-backed connection.
- **Change made:** Both query paths now free each prepared statement in `finally`, regardless of success or failure.
- **Regression coverage:** A failed parameter-binding query is followed by a successful query on the same connection.
- **Verification:** Database tests passed (17); database typecheck, Prettier, and `git diff --check` passed.

### Fixed: interrupted in-memory transactions left stale adapter state

- **Evidence:** `MemoryDatabaseConnection` cleared its outer-transaction flag only after a successful commit or rollback. If the connection closed while the callback was pending, both operations could fail and leave the flag set; after reinitialization, the next transaction would incorrectly attempt to create a savepoint outside a transaction.
- **Change made:** Mark the adapter as transactional only after `BEGIN` succeeds and always clear outer transaction state in `finally`.
- **Regression coverage:** Closes the connection while a transaction callback is suspended, confirms that transaction rejects, and then verifies queries and a subsequent transaction work after reinitialization.
- **Verification:** Database tests passed (18); database typecheck, Prettier, and `git diff --check` passed.

### Fixed: row validation could silently drop records and report a clean import

- **Evidence:** `ImportEngine.validate()` accepted a row only when `result.valid && result.data` was truthy. Valid primitive values such as `0`, `false`, or an empty string were dropped. A validator returning `valid: false` without errors, or `valid: true` without data, produced neither a row nor an error, allowing `executeImport()` to report success with missing records. Thrown row-validator exceptions also escaped instead of becoming a validation report.
- **Change made:** Accept any defined data value, synthesize a row-level error when the validator returns an incomplete result, and convert thrown validator exceptions into row validation errors. `failedRows` now counts distinct failed rows rather than individual field errors.
- **Regression coverage:** Added cases for falsy valid data, failure-without-error, and thrown validator exceptions.
- **Verification:** `pnpm --filter @platform/import-export test` passed (12 tests); import-export typecheck and `git diff --check` passed.

### Fixed: declared import formats were ignored and invalid commit counts could misreport atomic writes

- **Evidence:** `ImportDefinition.acceptedFormats` was never checked, so handlers accepted file types their definitions explicitly disallowed. Commit callbacks could also report negative, fractional, or greater-than-input counts after writing records, resulting in misleading success summaries.
- **Change made:** Detect CSV, XLSX, and legacy XLS by file signature/text validity and reject formats not allowed by the definition before parsing. Validate imported counts inside the transaction as safe integers from zero through the validated-row count; invalid counts throw and roll back the import.
- **Regression coverage:** Added format mismatch tests for CSV/XLSX and a commit callback test that writes a row then reports an impossible count, proving the transaction rolls the write back.
- **Verification:** `pnpm --filter @platform/import-export test` passed (14 tests); import-export typecheck and `git diff --check` passed.

### Fixed: spreadsheet exports allowed formula prefixes after whitespace and ambiguous XLSX columns

- **Evidence:** Export sanitization only recognized `=`, `+`, `-`, or `@` at the first character, allowing spreadsheet formula markers preceded by spaces, tabs, or line breaks. XLSX export also converts rows to objects keyed by the sanitized header, so duplicate headers silently overwrote earlier column values. Worksheet names were passed to SheetJS without validating Excel's name constraints.
- **Change made:** Sanitize formula-leading strings when the marker follows spreadsheet whitespace; validate that exports have non-empty, unique sanitized column headers; and reject invalid XLSX worksheet names before workbook creation.
- **Regression coverage:** Added CSV and XLSX checks for whitespace-prefixed formulas, duplicate/empty headers, and invalid worksheet names.
- **Verification:** `pnpm --filter @platform/import-export test` passed (16 tests); import-export typecheck and formatting passed.

### Fixed: delayed keyboard-wedge terminators could classify manual typing as a scan

- **Evidence:** The scanner checked elapsed time only when another character arrived. A long pause after the final character was not checked before Enter/Tab, allowing manually typed text to be emitted as a barcode. Scanner timing, minimum length, and terminator options were also unchecked.
- **Change made:** Require the terminator to arrive within the configured inter-key window, reset timing state after terminators/stopping, discard buffered input when timestamps move backwards, and validate scanner options at construction.
- **Regression coverage:** Added delayed-terminator and invalid-option tests; existing fast-scan and custom-terminator tests remain green.
- **Verification:** `pnpm --filter @platform/hardware test` passed (6 tests); hardware typecheck, formatting, and `git diff --check` passed.

### Fixed: sortable data-table headers were not keyboard accessible

- **Evidence:** Sorting was attached to a `<th>` click handler, which is not keyboard-operable by default and did not expose sort state to assistive technology.
- **Change made:** Render sortable headers with a native button, provide an accessible column-specific label, hide decorative sort icons from assistive technology, and expose the current direction through `aria-sort` on the header cell.
- **Regression coverage:** Server-rendered component test checks for a native button, its accessible name, and the initial `aria-sort` state.
- **Verification:** UI tests passed (2 tests; single-worker run due to an initial test-run stall); UI typecheck, formatting, and `git diff --check` passed.

### Fixed: theme persistence trusted invalid values and the context guard was ineffective

- **Evidence:** `ThemeProvider` cast any stored string to `Theme` and inserted it into the document root class list. Access to `localStorage` could throw in restricted browser contexts. The context was initialized with a non-undefined default object, so `useTheme()` outside a provider never raised its documented error. Theme controls also lacked explicit button types and accessible state labels.
- **Change made:** Validate persisted/default themes before use, fall back when storage reads/writes fail, memoize the context value and setter, make the context genuinely absent outside its provider, and add semantic labels/pressed state to theme controls.
- **Regression coverage:** Added provider-boundary and server-rendered theme-control accessibility tests.
- **Verification:** `pnpm --filter @platform/ui test -- --pool=threads --maxWorkers=1 --minWorkers=1` passed (4 tests); UI typecheck, formatting, and `git diff --check` passed.

### Fixed: input validation errors were not programmatically associated with their fields

- **Evidence:** `Input` rendered validation text without setting `aria-invalid` or connecting that text to the input. IDs derived from labels also collided when a form reused the same label.
- **Change made:** Generate a stable unique ID with React's `useId()` when callers do not provide one, associate validation text through `aria-describedby`, preserve caller-provided descriptions, and mark invalid fields with `aria-invalid`.
- **Regression coverage:** Added server-rendered markup coverage for invalid state, described-by association, and preservation of an existing help-text ID.
- **Verification:** UI tests passed (5 tests); UI typecheck, formatting, and `git diff --check` passed.

### Fixed: invalid maintenance batch sizes could remove the batch limit

- **Evidence:** Maintenance options accepted negative batch sizes without validation. SQLite interprets a negative `LIMIT` as no upper bound, so a caller could cause a pruning handler to delete every eligible row in one statement.
- **Change made:** Validate default and per-call batch sizes as positive safe integers. Validate retention overrides/defaults as positive finite values with representable cutoff dates. `pruneAll()` validates every handler's effective retention before starting any pruning, so a bad later handler cannot leave earlier handlers partially processed. Updated the handler contract to clarify it uses bounded statement batches rather than one transaction spanning them.
- **Regression coverage:** Tests verify invalid batch and retention values reject before pruners run, and invalid retention on a later handler prevents any earlier handler from pruning.
- **Verification:** `pnpm --filter @platform/maintenance test` passed (11 tests); maintenance typecheck and `git diff --check` passed.

### Fixed: direct pruner calls could bypass orchestrator batch validation

- **Evidence:** `PruningHandler.prune()` is public and registry getters expose handlers. An integrator could call a core or declarative handler directly with a negative batch size, bypassing orchestrator checks and reintroducing SQLite's unbounded negative-`LIMIT` behavior.
- **Change made:** Added shared pruning-context validation to every built-in pruner so batch bounds and cutoff dates are checked at the actual destructive-operation boundary as well as at orchestration.
- **Regression coverage:** Directly invokes every registered core pruner with a negative batch size and asserts rejection before SQL execution.
- **Verification:** `pnpm --filter @platform/maintenance test` passed (12 tests); maintenance typecheck and `git diff --check` passed.

### Fixed: validated declarative pruning policies remained caller-mutable

- **Evidence:** `DeclarativeTablePruner` validated table, timestamp-column, and filter strings in its constructor but retained the caller's object by reference. A caller could change those values afterward and alter interpolated SQL without revalidation.
- **Change made:** The pruner now stores a frozen snapshot of the policy fields it validated.
- **Regression coverage:** Mutates the original policy's table, column, and filter after construction, then verifies the pruner still queries the originally validated table and filter.
- **Verification:** `pnpm --filter @platform/maintenance test` passed (13 tests); maintenance typecheck and `git diff --check` passed.

### Fixed: migration engine sorting could override feature dependency order

- **Evidence:** `DependencyResolver` emits feature migrations in topological dependency order, but `Platform.init()` passed all feature migrations to `MigrationEngine.applyMigrations()`, which re-sorted them alphabetically by owner. A dependent feature with an alphabetically earlier ID could migrate before its dependency.
- **Change made:** Platform startup now groups migrations by feature in the resolver's order and applies each feature owner group sequentially. The migration engine can retain its generic owner/version ordering within each group.
- **Regression coverage:** Added a platform integration test where feature `a-dependent` depends on `z-base` and creates an index on the base table; initialization succeeds and the index exists.
- **Verification:** `pnpm --filter @platform/platform test` passed (9 tests across 2 files); platform typecheck and `git diff --check` passed.

### Fixed: feature registry allowed caller mutation after manifest validation

- **Evidence:** `FeatureRegistry` stored the caller's manifest object directly and returned the cached ordered feature array and migration array. A caller could mutate manifest data after validation or mutate the resolver's cached collection through a getter.
- **Change made:** Registration now snapshots declarative manifests with `structuredClone` and recursively freezes the snapshot. Cached feature arrays and migrations are returned as defensive collection copies.
- **Regression coverage:** Added tests that mutate the original manifest and returned collections, then verify registered metadata and cached migration/permission counts remain unchanged.
- **Verification:** `pnpm --filter @platform/feature-system test` passed (15 tests); feature-system typecheck passed.

### Fixed: feature manifests accepted invalid sync policies and fractional migration versions

- **Evidence:** `ManifestValidator` checked only that migration versions were positive, allowing fractional values. It did not validate sync entity names, namespace traversal/required path placeholders, conflict strategies, or duplicate sync entity declarations.
- **Change made:** Migration versions must be positive safe integers. Sync policies now require valid unique entity types, safe namespace segments including application/organisation/sync-group placeholders, supported conflict strategies, and a boolean `syncable` declaration.
- **Regression coverage:** Added invalid migration, unsafe namespace, and unsupported conflict strategy tests.
- **Verification:** `pnpm --filter @platform/feature-system test` passed (15 tests); feature-system typecheck and `git diff --check` passed.

### Fixed: membership approval, rejection, and revocation accepted a caller-provided user ID without authorization

- **Evidence:** Pairing approval passed `ctx.userId` as a string to `approveMembership()`. Approval, rejection, and revocation accepted raw actor IDs and skipped `sync.manage` enforcement on that overload. Review of the revocation call path found the same bypass remained after the first fix.
- **Change made:** Removed raw-string actor parameters for all three operations. They now require an `OperationContext` or native trusted context and always enforce `sync.manage` before mutation.
- **Regression coverage:** Security tests prove unauthorized approval, rejection, and revocation do not change requests, membership, or revocation records. Valid pairing fixtures explicitly grant `sync.manage`.
- **Verification:** `pnpm --filter @platform/authorization test` passed (7 tests); `pnpm --filter @platform/sync test` passed (27 tests); `pnpm --filter @tests/security test -- sync-authorization.test.ts` passed (11 tests). Authorization, sync, and security typechecks passed.

### Fixed: membership decisions were not scoped to the actor's organisation

- **Evidence:** Approval and rejection loaded membership requests by ID and wrote decisions without checking the sync group's owning organisation. Revocation accepted a group ID and performed its writes without verifying group ownership. Pairing validated the peer handshake organisation but did not ensure the selected sync group belonged to that organisation or matched the local operation context.
- **Impact:** An authorised `sync.manage` user could decide a request or revoke a membership in another organisation if they knew the IDs. An inbound pairing could also create a request against a group owned by a different organisation.
- **Change made:** Membership approval, rejection, and revocation now verify the group organisation against the actor context before mutation. Multi-write decisions open a transaction when the caller does not supply one. Pairing checks the local context, validated handshake, and active target group organisation before registering the device.
- **Regression coverage:** Added security cases proving cross-organisation approval, rejection, revocation, and pairing leave records unchanged.
- **Verification:** Authorization package tests passed (7); sync package tests passed (27); focused sync security tests passed (11); authorization, sync, and security typechecks passed.
- **Limitation:** These transaction paths still depend on reads inside `TransactionClient`; the production native driver does not implement transactional reads. The broader B-01 fix remains necessary.

### Fixed: suspended devices could pass the sync eligibility check

- **Evidence:** `PairingService.canSync()` rejected only missing, revoked, and unregistered device records. A device with an active group membership could still pass while `PENDING_APPROVAL` or `SUSPENDED`. The service also read device state with direct SQL, bypassing the identity repository, and its comment incorrectly claimed to enforce all seven admission layers.
- **Change made:** Device lookup now uses `DeviceIdentityService.getDeviceById()`, and only `APPROVED` or `ACTIVE` device states proceed to group-membership validation. The method documentation now describes this as one eligibility check and explicitly does not claim complete transport admission.
- **Regression coverage:** `tests/security/sync-authorization.test.ts` exercises pending, suspended, revoked, and unregistered rejection despite active membership, and confirms approved and active devices with membership remain eligible.
- **Verification:** `pnpm --filter @platform/sync test` passed (30 tests); sync typecheck passed; `pnpm --filter @tests/security test -- sync-authorization.test.ts` passed (16 tests); Prettier and `git diff --check` passed.
- **Remaining scope:** This does not implement the seven-layer transport admission design; native inbound delivery and outbound transmission remain tracked in the [native review plan](./review-native-foundation.md).

### Fixed: a negative outbox batch limit could remove the row bound

- **Evidence:** `OutboxService.pendingBatch(limit)` passed arbitrary caller values to SQLite. SQLite interprets a negative `LIMIT` as unbounded, so malformed task payloads could load every pending envelope at once; fractional and excessively large values were also not rejected.
- **Change made:** The default is now tied to a 50-row maximum, and the service rejects non-positive, non-safe-integer, or over-limit values before querying the database.
- **Regression coverage:** Outbox unit tests cover negative, zero, fractional, non-finite, and over-limit values plus the default path. A security governance test ensures the validation remains before the SQL query.
- **Verification:** `pnpm --filter @platform/sync test` passed (37 tests); sync typecheck passed; the sync transport security governance test passed (4 tests). Prettier and `git diff --check` passed.

### Fixed: invalid outbox retry thresholds could fail work immediately

- **Evidence:** `OutboxService.markFailed()` used `attempt_count + 1 >= maxAttempts` without validating the caller's threshold. Zero or negative values therefore marked the first failed send as terminal; fractional and non-finite values had undefined policy meaning.
- **Change made:** Retry thresholds must now be positive safe integers before timestamp generation or database mutation. The default retry behavior is unchanged.
- **Regression coverage:** Outbox tests exercise zero, negative, fractional, non-finite values, and verify the row remains pending with no attempt recorded. Security governance ensures the check precedes the update.
- **Verification:** `pnpm --filter @platform/sync test` passed (42 tests); sync typecheck passed; sync transport security governance passed (4 tests); Prettier and `git diff --check` passed.

### Fixed: late outbox outcomes could overwrite terminal state

- **Evidence:** `markSent()` and `markFailed()` updated an envelope by ID without checking its current state. A delayed failure could change attempt metadata after successful delivery, and a delayed success could resurrect an envelope already marked `FAILED`.
- **Change made:** Both state transitions now update only rows that are still `PENDING`. SQLite performs the state predicate and update atomically, so terminal outcomes cannot be overwritten by a later attempt result.
- **Regression coverage:** Outbox tests apply success then late failure, and terminal failure then late success; both assert status and attempt metadata remain unchanged. Security governance checks both SQL updates retain the pending-state predicate.
- **Verification:** `pnpm --filter @platform/sync test` passed (44 tests); sync typecheck passed; sync transport security governance passed (4 tests); Prettier and `git diff --check` passed.

### Fixed: outbox accepted malformed or untransmittable envelopes

- **Evidence:** `OutboxService.enqueue()` trusted the TypeScript `SyncEnvelope` type at runtime. Malformed values could be persisted, and envelopes larger than the native 10 MiB frame limit could be durably queued even though the transport would reject them later.
- **Change made:** The shared `SyncEnvelopeBuilder.validateEnvelope()` now enforces the 10 MiB UTF-8 serialized-envelope limit, and `build()` checks operation size before signing and validates the completed envelope. Outbox enqueue validates runtime values before generating or inserting a row and maps failures to `ValidationError`.
- **Regression coverage:** Protocol tests reject oversized envelopes. Outbox tests reject malformed and oversized input and verify no row is persisted. Security governance guards validation before insertion.
- **Verification:** Sync-protocol tests passed (40), sync tests passed (45), both package typechecks passed, and sync transport security governance passed (4). Prettier and `git diff --check` passed.

### Fixed: conflict resolution treated production ISO logical timestamps as invalid HLC values

- **Evidence:** `NotesService` and existing persisted sync fixtures use ISO timestamps followed by a decimal counter and device ID, but `HybridLogicalClock.parse()` only understood hexadecimal underscore-delimited timestamps. Parse failures silently became zero-valued timestamps, so LWW comparisons could treat newer remote operations as equal and retain the local version.
- **Change made:** The parser now strictly recognizes canonical hexadecimal HLC values and the existing ISO colon/pipe formats. Invalid timestamps throw instead of silently sorting as zero; comparison uses ordered comparisons rather than potentially imprecise numeric subtraction. Counter exhaustion advances physical time or fails explicitly when timestamp space is exhausted.
- **Regression coverage:** Protocol tests cover production ISO ordering, pipe-format compatibility, malformed dates/timestamps, and `ConflictEngine` tests confirm a later ISO remote timestamp wins LWW. The security suite verifies malformed timestamps cannot influence LWW resolution.
- **Verification:** Sync-protocol tests passed (38); sync conflict tests passed (7); sync security tests passed (13); both package typechecks, formatting, and `git diff --check` passed.

### Fixed: an unsigned envelope ID could bypass operation identity binding

- **Evidence:** Envelope signatures cover the inner operation, while `envelopeId` is an outer field used as the durable inbox idempotency key. Runtime transport handling trusted `JSON.parse()` output as `SyncEnvelope`, and `InboxService.receive()` did not verify that the outer ID matched the signed operation ID before its idempotency lookup.
- **Impact:** A peer could alter the outer ID without invalidating the operation signature, causing the same signed operation to occupy an attacker-selected idempotency key. Structurally invalid JSON values could also reach registered receive handlers as if they were typed envelopes.
- **Change made:** Added runtime validation for operation fields, versions, logical timestamp, envelope ID binding, signing timestamp, public key, and signature format. `IrohSyncTransport` validates before dispatch, and `InboxService` validates before database access or persistence. Signature verification returns false for malformed envelope values.
- **Regression coverage:** Sync-protocol tests cover envelope ID tampering; transport tests prove malformed envelopes do not reach handlers; inbox and `tests/security/` regressions prove a mismatched ID is rejected without inserting an inbox row.
- **Verification:** Sync-protocol tests passed (39); focused sync inbox/transport tests passed (9); sync security tests passed (14); both package typechecks, Prettier, and `git diff --check` passed.

### Fixed: malformed permission scope JSON could become an unrestricted grant

- **Evidence:** `AuthorizationEngine.getEffectivePermissions()` swallowed JSON parse errors and left `scopeConstraints` undefined. `ScopeEvaluator` interprets undefined constraints as a grant across the organisation. JSON values such as `null`, arrays, strings, numbers, and booleans were also not validated as scope objects.
- **Impact:** Corrupt or invalid persisted scope data could silently broaden a permission instead of denying it.
- **Change made:** Only SQL NULL represents an unconstrained grant. Malformed JSON and non-object JSON values now cause that grant to be omitted, so authorization fails closed.
- **Regression coverage:** Authorization and security tests cover malformed JSON and non-object JSON values and assert the permission is denied.
- **Verification:** `pnpm --filter @platform/authorization test` passed (7 tests); `pnpm --filter @tests/security test -- rbac-security.test.ts` passed (13 tests); authorization and security typechecks passed.

### Confirmed: native transactions cannot provide interactive reads or write results

- **Evidence:** `PairingService.requestPairing()` calls `DeviceIdentityService.registerDevice(..., tx)`, which reads through `tx.query()`. `approvePairing()` reads through `tx.query()` and calls `SyncGroupService.approveMembership(..., tx)`, which performs another transactional read. Membership approval, rejection, revocation, organisation creation, feature operations, and import paths also pass transaction clients to code that may query. The native transaction client rejects every `tx.query()` because it batches the callback's operations and invokes Rust only after the callback returns; the memory driver instead executes interactively.
- **Impact:** Transactions with reads fail on the production Tauri-backed connection even where memory-backed tests pass. This affects core service behavior and can prevent pairing and membership operations from working in production.
- **Related write-result defect and fix:** Queued native `tx.execute()` previously returned `{ rowsAffected: 0 }` before executing, which callers could misinterpret as a confirmed zero-row update. The transaction-client result now makes `rowsAffected` optional, and the native batch driver returns no fabricated count. Added a regression assertion. This removes the false result but does not provide post-write counts to callback code.
- **Consumer inventory (source reviewed 2026-10-10):**

  | Consumer                                                                             | Transaction behavior                                                                                                                                                                   | Native compatibility / consequence                                                                                  |
  | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
  | `OrganisationService.createOrganisation()`                                           | Authorization permission resolution and `findByDomain()` read inside callback; then insert                                                                                             | Incompatible. Duplicate-domain check must remain atomic with insert.                                                |
  | `IdentityAdminService.createUser()`                                                  | Permission resolution and role-management/role-tenant validation read inside callback; remaining user, role, and audit writes are queued                                               | Incompatible because of authorization and role validation reads.                                                    |
  | `IdentityAdminService.approveDevice()` / `revokeDevice()`                            | Permission and membership/group reads inside callback; device status update checks affected-row count                                                                                  | Incompatible; native queued writes do not return per-operation affected-row counts.                                 |
  | `WidgetService.createWidget()`                                                       | Permission and tenant-scoped SKU lookup inside callback; then insert                                                                                                                   | Incompatible. SKU uniqueness check must be protected against races by database constraints/atomic design.           |
  | `NotesService.createNote()` / `updateNote()` / `deleteNote()`                        | Permission, current note/group, and membership reads happen in transaction; entity and signed outbox writes must commit together                                                       | Incompatible and security-sensitive; moving reads outside would create authorization and stale-write windows.       |
  | `SyncGroupService.approveMembership()` / `rejectMembership()` / `revokeMembership()` | Permission plus request/group ownership reads in transaction; decision/member/revocation writes are multi-row                                                                          | Incompatible; authorization and request state need an atomic native operation or interactive transaction.           |
  | `PairingService.requestPairing()`                                                    | Preflight group check occurs before callback; `DeviceIdentityRepository` resolves the exact requested peer ID (or explicit local marker) inside callback; then membership/audit writes | Incompatible; preflight alone cannot safely replace the identity check under concurrency.                           |
  | `PairingService.approvePairing()`                                                    | Reads request inside callback and delegates to membership approval; device status update checks affected rows                                                                          | Incompatible on reads and unavailable write-result dependency.                                                      |
  | `TombstoneService.record()` / `SyncManager.enqueueOperation()`                       | Write-only when called with a transaction; `TombstoneService.isDeleted()` is read-dependent if passed one                                                                              | The write-only methods fit the current native batch model; the optional read-in-transaction method does not.        |
  | `ImportEngine.importData()`                                                          | Transaction callback delegates to plugin-defined commit implementation, then emits audit writes                                                                                        | Compatibility is unknown per definition until every commit callback is audited; contract permits arbitrary queries. |
  | `MigrationEngine`                                                                    | Applies migration writes through transaction                                                                                                                                           | Currently write-only based on inspected migration callback path.                                                    |

- **Plan:** The consumer inventory is complete for checked-in TypeScript source. Follow the staged design and implementation criteria in [the native interactive transaction plan](./native-interactive-transactions.md). Compare an interactive native protocol with typed atomic operations, while keeping generic transaction batches explicitly write-only. Select a design with Rust/IPC security review before migration. Do not move isolation-sensitive reads outside a transaction.
- **Verification needed:** Add production-driver coverage for pairing request and approval, including missing/stale request and missing device cases; assert membership, device status, and audit changes commit or roll back together. Verify cancellation, concurrent transactions, lock contention, and renderer/native failure. The interactive read limitation remains unresolved.

### Fixed: peer registration could return the first unrelated device record

- **Evidence:** `DeviceIdentityService.registerDevice()` previously called `getLocalDevice()` before considering `options.deviceId`. Since `getLocalDevice()` selected the first `core_devices` row, pairing a peer after local registration returned the local identity and did not persist the peer. Session validation also relied on that first-row lookup.
- **Impact:** Pairing requests could refer to a peer absent from the device table, and approval could not reliably update the corresponding identity. If peers were persisted, first-row session validation could inspect the wrong device.
- **Change made:** Added `DeviceIdentityRepository` for device persistence. Explicit device IDs now resolve by exact ID and reject public-key substitution. Local records have an explicit `is_local` marker; platform migration v6 adds it, and native key-provider initialization marks the device matching its exact ID and public key. Session validation loads the device bound to the current session.
- **Regression coverage:** Identity tests cover local plus peer registration in both orders and reject key substitution; platform migration coverage verifies the marker upgrade; the security suite verifies a conflicting key cannot replace a peer identity; native tests cover migration and identity persistence across restart.
- **Verification:** Identity tests pass (13), platform tests pass (10), sync tests pass (30), RBAC security tests pass (21), relevant TypeScript typechecks pass, `cargo fmt --check` passes, and focused native schema/device-identity tests pass.
- **Remaining limitation:** Native transaction callbacks still cannot query intermediate state. The repository change preserves the existing API's transaction behavior but does not resolve the broader transaction architecture issue described above.

### Fixed: the memory database reported SQLite guarantees it did not provide

- **Evidence:** `MemoryDatabaseConnection.healthCheck()` hard-coded WAL, foreign-key enforcement, and `integrity_check = ok`; `init()` did not enable SQLite foreign keys. The in-memory SQL.js database therefore reported native-like guarantees without configuring or measuring them.
- **Impact:** Tests could pass while relying on foreign-key constraints that were disabled, and health checks misrepresented in-memory durability.
- **Change made:** Enable foreign keys during initialization, read actual journal mode/foreign-key state/integrity result, report WAL as disabled when the in-memory engine does not provide it, and report unhealthy when a required invariant is off. The native health result applies the same foreign-key requirement.
- **Regression coverage:** Added a child-row insert test that verifies a missing parent is rejected and a health test that disables foreign keys; health-check expectations now reflect the actual in-memory mode.
- **Verification:** `pnpm --filter @platform/database test` passed (16 tests); `pnpm --filter @platform/database typecheck` passed; Prettier and `git diff --check` passed.

### Fixed partially: `SyncManager.connect()` no longer reports peer connection or authorization from caller metadata

- **Evidence:** `packages/sync/src/manager/SyncManager.ts` previously transitioned caller-supplied `PeerInfo` through `CONNECTED` and `AUTHORISED` after checking only `peer.organisationId`. `PeerInfo` provides no authenticated identity, admission status, protocol version, membership proof, or namespace permissions. The method does not establish a `SyncTransport` session itself.
- **Impact:** The state API claimed a live, authorized peer without establishing transport or checking the seven admission gates. No production call sites were found in `apps/` or `features/`, so this was an unsafe contract rather than an observed production data leak.
- **Change made:** `connect()` now rejects organisation mismatches and otherwise transitions directly to `ERROR` until a trusted admission verifier and real transport connection are supplied. It no longer emits false `CONNECTING`, `CONNECTED`, or `AUTHORISED` states or records successful peer diagnostics.
- **Regression coverage:** Package and security tests assert same-organisation caller metadata cannot yield `CONNECTED`, `AUTHORISED`, or diagnostics.
- **Verification:** Sync package tests passed (27); focused sync authorization security tests passed (12); sync package typecheck passed.
- **Plan:** Design an admission result produced from authenticated transport identity plus native authorization state, and require it before the manager exposes an authorized state or data send path. Align inbound envelope handling with the same admission boundary. Preserve a development simulator only if it cannot be mistaken for production authorization.
- **Verification needed:** Add `tests/security/` coverage for each rejected admission layer and prove no outbound send or inbound application handler runs before all required gates pass. Do not expand `PeerInfo` with caller-asserted fields and treat them as proof.

### Fixed: repository-generated SQL accepted untrusted identifiers

- **Evidence:** `BaseRepository.findAll()` interpolated `FindOptions.orderBy` directly into SQL. `insert()` and `update()` also interpolated keys from runtime objects as SQL column identifiers. Parameter binding protects values, but it cannot bind identifiers.
- **Impact:** A caller controlling sort options or object properties could inject SQL through this shared repository API, bypassing its intended parameterized-query safety.
- **Change made:** Validate sort identifiers, constrain sort direction to `ASC` or `DESC`, and validate converted insert/update column names before constructing SQL. Invalid identifiers raise a typed `ValidationError` before database execution.
- **Regression coverage:** Added `tests/security/database-query-governance.test.ts` cases for malicious sort fields, runtime sort direction, update keys, and insert keys; each case confirms persisted rows remain intact.
- **Verification:** Focused security tests passed (4 tests); full security suite passed (72 tests across 11 files); security and database typechecks passed; Prettier and `git diff --check` passed.

### Fixed: repository pagination accepted unsafe limits and offsets

- **Evidence:** `BaseRepository.findAll()` bound `FindOptions.limit` and `offset` without validation. Negative SQLite limits remove the row bound; fractional, non-finite, or excessively large page values were accepted, and an offset without a limit was silently ignored.
- **Change made:** Explicit limits must be non-negative safe integers no greater than 1,000. Offsets must be non-negative safe integers and require a page size. Calls that omit pagination retain their existing full-result behavior.
- **Regression coverage:** `tests/security/database-query-governance.test.ts` verifies negative, fractional, non-finite, over-limit, invalid-offset, and offset-without-limit inputs fail before a query and leave stored rows intact.
- **Verification:** `pnpm --filter @platform/database test` passed (16 tests); database typecheck passed; database query governance passed (5 tests); Prettier and `git diff --check` passed.

### Fixed: identifier-only session creation bypassed native authentication

- **Evidence:** The deprecated public `UserSessionService.createSession()` accepted a user ID and organisation ID, checked only local device/user status, then created a TypeScript session without credential verification. No application code called it, but package tests still relied on it. The native-session establishment helper was also public and accepted a caller-provided session view.
- **Impact:** A caller could bypass the documented native credential and lockout checks and obtain a `TrustedOperationContext` from identifiers alone.
- **Change made:** Removed `createSession()` and made native-view establishment private. Startup restoration now requests the existing session from `NativeAuthenticator.getCurrentSession()`. Session restoration also checks that the active user matches the native organisation and that the native device exists, is bound to the user if user-bound, and is APPROVED or ACTIVE. The demo now uses this restoration API.
- **Regression coverage:** Security coverage asserts that the identifier-only API is absent. Identity tests cover valid restoration, role resolution, organisation mismatch, revoked/suspended devices, and native credential failure.
- **Verification:** Identity tests passed (10); authentication boundary tests passed (4); identity and security typechecks passed; demo app typecheck passed. Full security suite not rerun after this slice.
- **Boundary note:** Native commands remain the source of authentication truth. The separate generic SQL IPC authorization gap remains open.

### Confirmed design risk: trusted operation contexts are identified structurally

- **Evidence:** `packages/core/src/context/OperationContext.ts:isTrustedOperationContext()` treats any object with a non-null `principal` object as trusted. `AuthorizationEngine.requireTrusted()` relies on this shape and then resolves permissions from the database using its caller-supplied user and organisation IDs.
- **Impact:** TypeScript callers can construct a structurally valid `TrustedOperationContext` for a different persisted user and pass it to APIs that accept trusted contexts. This bypasses the intended native-session provenance even though permissions are still resolved from persisted role bindings.
- **Plan:** Do not attempt to solve this with an exported “trusted context factory” or a caller-provided brand alone. The trusted principal must be verified against native session state at the authorization boundary, or the architecture must make the provenance token unavailable to renderer-created code. Coordinate this with the generic SQL IPC redesign and pairing authorization boundary.
- **Verification needed:** Add `tests/security/` coverage that a context with a fabricated session ID/user cannot obtain authorization; prove valid native-issued contexts still work. This remains unresolved.

### Fixed: concurrent task workers could claim and execute the same task

- **Evidence:** `TaskQueueService.claimNextBatch()` selected pending task IDs, updated them in a second statement, then re-selected by ID. Concurrent workers could select the same IDs; the second worker's conditional update would affect no rows, but its final query still returned those tasks because it did not verify the update result.
- **Impact:** The queue could deliver a task to multiple workers, causing duplicate side effects and consuming attempts inconsistently.
- **Change made:** Replaced the multi-statement selection/update/read sequence with one conditional `UPDATE ... RETURNING` statement. Only rows that transition from `PENDING` to `RUNNING` are returned. Claim limits are validated as positive safe integers.
- **Regression coverage:** Concurrent claim tests prove two simultaneous callers receive each task at most once and collectively claim all eligible tasks; invalid limits are rejected.
- **Verification:** `pnpm --filter @platform/tasks test` passed (41 tests across 4 files); `pnpm --filter @platform/tasks typecheck` passed.

### Fixed: task workers could cancel queued work before handlers were registered

- **Evidence:** When `TaskWorker.poll()` had no registered handlers, it passed no type filter to the queue and therefore claimed all pending task types. `executeTask()` then cancelled each claimed task because no handler existed. With some handlers registered, unsupported task types were filtered out and remained pending.
- **Impact:** Startup ordering could permanently cancel valid queued work before the worker's feature handlers finished registering.
- **Change made:** A worker with no registered handlers now skips claiming. With handlers registered, it always claims only supported task types, leaving other work pending for the appropriate worker.
- **Regression coverage:** Tests verify pending work remains pending with zero handlers, then can execute after handler registration, and unsupported types remain pending alongside supported tasks.
- **Verification:** `pnpm --filter @platform/tasks test` passed (41 tests across 4 files); `pnpm --filter @platform/tasks typecheck` passed.

### Fixed: concurrent task enqueue could violate unique-key deduplication behavior

- **Evidence:** `enqueue()` first queried for an active task with the key and then inserted. Two callers could both observe no match; the partial unique index correctly rejected one insert, but the method propagated the constraint error instead of returning the winning task as its API contract promises.
- **Change made:** Keep the lookup as a fast path, then on insert failure re-query the active key and return the winning task when present. Other insertion failures continue to propagate. The database partial unique index remains the concurrency enforcement boundary.
- **Regression coverage:** The task test schema now includes the production partial unique index and concurrently enqueues the same key, asserting both calls return one task ID and only one pending record exists.
- **Verification:** `pnpm --filter @platform/tasks test` passed (42 tests across 4 files); `pnpm --filter @platform/tasks typecheck` passed; `git diff --check` passed.

### Fixed: late task failures could report a retry after cancellation or overwrite a newer attempt

- **Evidence:** `markFailed()` previously read a task regardless of state, then updated only if it was still RUNNING but always returned its earlier retry decision. A cancelled/completed task could therefore be reported as rescheduled. A task recovered and reclaimed between the read and update could also be modified by a stale worker.
- **Change made:** Ignore tasks that are not RUNNING; persist failure transitions with `UPDATE ... RETURNING` conditioned on both RUNNING state and the attempt count observed during the read. Retry reporting now reflects whether the conditional reschedule actually changed a row.
- **Regression coverage:** Added coverage proving a late failure after cancellation returns `willRetry: false` and preserves CANCELLED state.
- **Verification:** `pnpm --filter @platform/tasks test` passed (43 tests across 4 files); `pnpm --filter @platform/tasks typecheck` passed.
- **Limitation:** Native transaction callbacks still cannot read intermediate values, so these read-dependent transitions remain incompatible with a transaction client on the Tauri driver; see the transaction design finding above.

### Fixed: invalid task definitions could persist unusable retry settings or payloads

- **Evidence:** `enqueue()` merged caller retry values without checking them and serialized payloads directly. Zero/negative attempt and timeout settings could create tasks that never execute or retry correctly; circular and non-JSON payloads failed late at serialization/database boundaries.
- **Change made:** Validate non-empty task type, organisation, and correlation IDs; require positive safe-integer attempts/timeouts and finite non-negative retry delays with a positive finite backoff multiplier. Reject payloads that cannot be serialized as JSON before writing.
- **Regression coverage:** Tests cover invalid retry policy, timeout, and circular payload rejection and assert no pending rows were written.
- **Verification:** `pnpm --filter @platform/tasks test` passed (45 tests across 4 files); `pnpm --filter @platform/tasks typecheck` passed; formatting and `git diff --check` passed.

### Fixed: task diagnostics accepted unbounded list limits

- **Evidence:** `TaskQueueService.listByState()` passed a caller-supplied limit directly to SQLite. Negative limits remove SQLite's row bound, and arbitrarily large or fractional values were accepted despite the method's default of 100.
- **Change made:** Added a 100-row maximum and reject non-positive, non-safe-integer, or over-limit values before the query.
- **Regression coverage:** Task package tests cover negative, zero, fractional, non-finite, and over-limit values. A security governance test checks the maximum and ensures validation runs before the query.
- **Verification:** `pnpm --filter @platform/tasks test` passed (56 tests); task typecheck passed; the task queue security governance regression passed. Prettier and `git diff --check` passed.

### Fixed: task retry jitter was configurable but not persisted

- **Evidence:** `TaskRetryPolicy` exposes `jitter`, and `enqueue()` accepts the override, but the tasks table has no jitter column. `markFailed()` reconstructs the policy with a hard-coded `jitter: 0.25`, so callers cannot control the configured value and the default is duplicated outside `DEFAULT_RETRY_POLICY`.
- **Change made:** Added platform migration v5 to add a constrained `retry_jitter` column with the historical 0.25 default, included it in the canonical schema snapshot, task insertion, task records, and retry calculation. Existing migration v4 remains unchanged so previously applied checksums stay valid.
- **Regression coverage:** Task tests assert configured jitter is returned and invalid jitter is rejected. Platform migration tests verify v5 applies and creates the column.
- **Verification:** `pnpm --filter @platform/tasks test` passed (46 tests across 4 files); task typecheck passed; `pnpm --filter @platform/platform test` passed (8 tests across 2 files); platform typecheck passed. `git diff --check` passed.

### Fixed: shutdown could return while a poll had claimed but not dispatched tasks

- **Evidence:** `stop()` stopped the timer and immediately snapshotted `inFlight`. If a poll was awaiting the claim query, the snapshot could be empty; the poll would then dispatch claimed tasks after shutdown had already returned.
- **Change made:** Track the active poll promise and await its dispatch phase before taking the in-flight shutdown snapshot. A poll whose claim completed during shutdown now registers execution before stop waits for active work.
- **Regression coverage:** Added a gated database query test that pauses the atomic claim, calls `stop()`, releases the claim, and proves shutdown waits until the claimed handler completes.
- **Verification:** `pnpm --filter @platform/tasks test` passed (47 tests across 4 files); task typecheck passed.

### Fixed: outbox sync cancellation consumed envelope retries and wrote a success cursor

- **Evidence:** `OutboxSyncWorker.handle()` treated every dispatch rejection as a delivery failure, even when its `AbortSignal` had fired. It could increment the envelope failure count during task timeout and then persist `last_sync_at` after stopping partway through the batch.
- **Change made:** Cancellation now propagates to `TaskWorker` for task-level retry, leaves the interrupted envelope pending, and exits before persisting a cursor. Existing completed sends before cancellation remain acknowledged.
- **Regression coverage:** Worker tests cover cancellation after a completed send and cancellation during a rejected dispatch; they assert no envelope failure is recorded and no partial-batch cursor is written.
- **Verification:** `pnpm --filter @platform/tasks test` passed (57 tests); task typecheck passed; Prettier and `git diff --check` passed.

### Fixed: graceful shutdown left its losing timeout timer active; worker options were unchecked

- **Evidence:** `stop()` created a timeout for `Promise.race()` but did not clear it when handlers completed first. Constructor and `reconfigure()` accepted invalid concurrency and timing values, potentially causing no work, tight polling, or ineffective shutdown limits.
- **Change made:** Clear the graceful-shutdown timeout after either side of the race settles. Validate all configured concurrency and timing values as positive safe integers before construction or applying any reconfiguration.
- **Regression coverage:** Added tests for invalid constructor and reconfiguration values. Existing graceful shutdown coverage exercises the prompt-completion path.
- **Verification:** `pnpm --filter @platform/tasks test` passed (48 tests across 4 files); task typecheck and `git diff --check` passed.

### Fixed: worker observer callbacks could interrupt task dispatch or leak rejected executions

- **Evidence:** `onPollComplete` ran immediately after claiming and before dispatch; if it threw, claimed rows remained RUNNING without a handler invocation. `onNonRetryableError` and unexpected queue failures could also reject the execution promise after its `.finally()` cleanup, creating an unhandled rejection.
- **Change made:** Dispatch claimed tasks before notifying the poll observer, contain and log observer failures, and attach a final rejection handler to every tracked execution promise.
- **Regression coverage:** Added tests where poll and non-retryable observers throw, proving tasks still dispatch and later work continues.
- **Verification:** `pnpm --filter @platform/tasks test` passed (50 tests across 4 files); task typecheck and `git diff --check` passed.

### Fixed: pairing accepted an unsigned peer user ID

- **Evidence:** `PairingRequestInput.userId` was independent of `HandshakeMessage`, so it was not covered by the peer's Ed25519 signature. `requestPairing()` used that value to bind both the registered device and requested sync-group membership. A caller could therefore claim a different user identity for the peer.
- **Change made:** Removed `userId` from the pairing input API and bind both records to the authenticated operation context's user ID. This keeps the device and its membership aligned with the principal that initiated the pairing operation.
- **Regression coverage:** Added a security test that supplies a stale/hostile runtime `userId` property and verifies the database records use the context principal instead.
- **Verification:** `tests/security/sync-authorization.test.ts` passed (15 tests).

### Fixed: import commit callbacks could bypass the transaction

- **Evidence:** `ImportDefinition.commit()` received both the base `DatabaseConnection` and an optional transaction client. A callback could write through the base connection, outside the transaction, while `ImportEngine.executeImport()` reported the batch as atomic.
- **Change made:** The callback now requires and receives only the active `TransactionClient`; removed the base connection parameter and optional fallback from the public contract. This makes transactional persistence the default and removes an accidental escape hatch from the callback arguments. Updated the architecture reference and in-repository callback implementations.
- **Regression coverage:** Existing import lifecycle and rollback tests now exercise the required transaction-only callback signature.
- **Verification:** `pnpm --filter @platform/import-export test` passed (16 tests); package typecheck and Prettier checks passed; `git diff --check` passed.

### Fixed: scanner listener replacement could inherit a partial scan

- **Evidence:** `KeyboardWedgeScanner.startListening()` replaced the callback without clearing buffered keystrokes or the prior timestamp. Replacing a listener mid-scan could therefore deliver a barcode that began during the previous listener's lifetime.
- **Change made:** Starting a listener now resets the partial scan state so each listener receives only scans begun after it starts.
- **Regression coverage:** Added a listener-replacement lifecycle test that starts a scan under one listener, replaces it, and verifies only the new scan reaches the new listener.
- **Verification:** `pnpm --filter @platform/hardware test` passed (7 tests); package typecheck and Prettier checks passed; `git diff --check` passed.

### Fixed: a throwing scanner listener could retain completed scan state

- **Evidence:** The terminator path invoked the consumer callback before clearing the completed scan buffer. If the callback threw, the scan remained in internal state and could be merged with later input.
- **Change made:** Snapshot the current listener and reset scan state before invoking it, so callback failures cannot leave stale data behind.
- **Regression coverage:** A listener that throws on a completed scan is followed by a new listener and scan; the new listener receives only the new barcode.
- **Verification:** `pnpm --filter @platform/hardware test` passed (8 tests); hardware typecheck and formatting passed.

### Improved: shared data-table interactions were not fully keyboard accessible

- **Evidence:** The filter input relied on placeholder text without an accessible name, and rows configured with `onRowClick` had no keyboard focus or activation behavior.
- **Change made:** The filter input now has an accessible name. Clickable rows are keyboard focusable and activate on Enter or Space; clicks and key events originating in nested interactive controls do not trigger the row callback. The row describes its keyboard interaction.
- **Regression coverage:** Server-rendered component tests assert the search label and focusable row affordance.
- **Verification:** `pnpm --filter @platform/ui test` passed (6 tests); package typecheck and Prettier checks passed; `git diff --check` passed.

### Fixed: system theme changes were not observed while the app remained open

- **Evidence:** `ThemeProvider` sampled `prefers-color-scheme` only when the selected theme changed. An OS theme change did not update the document class or `isDark` state until another render changed the theme setting.
- **Change made:** Subscribe to the media-query change event while the selected theme is `system`, apply the current preference immediately, and remove the listener when the theme changes or provider unmounts.
- **Verification:** UI tests passed (6) using a single-worker Vitest run; UI typecheck and formatting passed. The default worker run stalled during collection, while the single-worker run completed successfully.

### Improved: app-shell navigation controls lacked accessible state and names

- **Evidence:** Collapsed navigation hid each item label without providing an accessible name, and the sidebar toggle exposed neither its action nor its expanded state. The navigation also did not announce the active page.
- **Change made:** Added an accessible navigation landmark, explicit button types and labels, `aria-current="page"` for the selected item, and an accessible label/expanded state on the sidebar toggle.
- **Regression coverage:** Server-rendered app-shell markup checks the landmark, item name, current page, and toggle state.
- **Verification:** UI tests passed (7) with a single-worker Vitest run; UI typecheck and formatting passed.

### Fixed: invalid data-table page sizes could reach the pagination model

- **Evidence:** `DataTable.pageSize` was passed directly to TanStack Table without runtime validation. Zero, negative, fractional, or non-finite values can produce invalid pagination behavior even when callers bypass TypeScript checks.
- **Change made:** Require a positive safe integer before creating the table model.
- **Regression coverage:** Server-rendering tests verify zero, negative, fractional, `NaN`, and infinite page sizes fail with a clear configuration error.
- **Verification:** UI tests passed (12) with a single-worker Vitest run; UI typecheck and formatting passed.

### Improved: UI architecture documentation and package dependencies drifted from implementation

- **Evidence:** The architecture page described non-existent shell header/menu elements, row selection, and Drizzle integration. The UI manifest also declared unused authorization/core packages, four unused Radix components, and a Vite plugin that belongs to the app build rather than the UI package.
- **Change made:** Rewrote the UI architecture page against the public exports and current component behavior; removed unused dependencies and refreshed the workspace lockfile. Kept Radix Slot and Tailwind CSS, which the package actually uses.
- **Verification:** UI tests passed (12) with a single-worker Vitest run; UI typecheck passed; lockfile importer matches `packages/ui/package.json`; formatting and `git diff --check` passed.

### Improved: UI package could resolve its own React runtime

- **Evidence:** `@platform/ui` declared React and React DOM as normal runtime dependencies even though the component library should share the consuming app's React instance; React DOM is only used in the package's server-rendered tests.
- **Change made:** Declared React as a peer dependency, retained React and React DOM as development dependencies for package checks, and refreshed the lockfile.
- **Verification:** UI tests passed (12) with a single-worker Vitest run; UI typecheck passed; formatting and `git diff --check` passed.

### Fixed: outbox worker dispatched only the business payload

- **Evidence:** `OutboxService` stored `JSON.stringify(operation.payload)` in `payload_json`, while `OutboxSyncWorker` passed that value to a dispatcher that requires a serialized signed `SyncEnvelope`. The outbox also did not persist every envelope field, so reconstructing the signed envelope was not reliable.
- **Change made:** Outbox enqueue now stores the complete validated envelope in `envelope_json`; pending batches expose it, and the worker dispatches that field. Platform migration 7 adds the column without rewriting prior migrations. Legacy pending rows without a complete envelope fail visibly for repair instead of sending malformed data.
- **Regression coverage:** Outbox tests assert the full envelope round-trips; worker tests assert that dispatcher receives `envelopeJson`; sync transport governance checks cover persistence and legacy-row rejection.
- **Verification:** Sync package tests (45), task package tests (57), and platform typecheck passed.

### Fixed: an organisation sync task could load another tenant's outbox rows

- **Evidence:** `OutboxSyncWorker` carries an organisation ID, but `OutboxService.pendingBatch()` selected every pending row. A task could therefore pass envelopes from other organisations to the dispatcher.
- **Change made:** `pendingBatch()` now requires and filters by organisation ID. The worker verifies the payload matches the organisation attached to its trusted task execution context before loading any rows.
- **Regression coverage:** Outbox tests prove cross-organisation rows remain isolated; worker tests reject a mismatched task payload before querying; transport governance checks enforce both the SQL filter and context binding.
- **Verification:** Sync package tests passed (49); task package tests passed (58); sync and task typechecks passed; transport governance tests passed (6); formatting and `git diff --check` passed.

### Fixed: persisted envelope contents could disagree with outbox metadata

- **Evidence:** After loading the organization-scoped rows, `pendingBatch()` trusted the serialized envelope without comparing it to the row's envelope ID, tenant, sync group, entity, author, device, version, and signature columns. Corrupt or altered JSON could therefore cross the tenant filter with a different embedded organization.
- **Change made:** Every stored envelope is parsed and validated against the protocol schema, then checked against all persisted routing and signature metadata before a batch can be returned.
- **Regression coverage:** Sync tests mutate a stored envelope to another tenant and assert rejection; transport governance verifies the validation boundary.
- **Verification:** Sync package tests passed (49); task package tests passed (58); sync and task typechecks passed; transport governance tests passed (6); formatting and `git diff --check` passed.

### Fixed: cancelled maintenance could be reported as successful

- **Evidence:** `MaintenanceOrchestrator.pruneAll()` excluded cancellation markers when computing `success`, so an aborted run could return `success: true`. `StorageMaintenanceWorker` checked only that field and could complete a task after pruning stopped partway through.
- **Change made:** Any aborted report now has `success: false`, and the worker throws when either the report or execution signal indicates interruption. The task retry flow can now observe incomplete maintenance.
- **Regression coverage:** Orchestrator tests assert aborted runs are unsuccessful both before work and during a run; task tests assert the storage worker propagates an aborted report.
- **Verification:** `@platform/maintenance` and `@platform/tasks` test suites and typechecks passed; formatting and `git diff --check` passed.

### Fixed: feature registration could leave partial pruning state

- **Evidence:** `Platform.registerFeature()` stored the feature and registered its conflict policies before constructing pruning handlers. A duplicate or invalid later pruning policy threw after the feature and any earlier pruning policies had already been registered.
- **Change made:** Maintenance policies are now constructed and checked as a complete batch before feature registration; the registry commits all prepared handlers only after successful preflight.
- **Regression coverage:** Platform test registers one valid pruning policy followed by a conflicting core policy and verifies that neither the feature nor its earlier policy remains registered.
- **Verification:** Maintenance tests/typecheck passed; platform tests passed (11) and platform typecheck passed; formatting and `git diff --check` passed.

### Fixed: duplicate sync entity policies silently replaced conflict behavior

- **Evidence:** `ConflictRegistry.registerEntityPolicy()` used `Map.set()` without detecting an existing owner. Registering another feature for the same entity type silently replaced the first feature's conflict strategy, making behavior depend on registration order.
- **Change made:** The registry now rejects duplicate entity policies, and `Platform.registerFeature()` preflights conflicts before mutating feature, conflict, or pruning registries.
- **Regression coverage:** Platform tests register a conflicting second feature and verify it is rejected while the first feature's conflict strategy remains active.
- **Verification:** Sync-protocol tests passed (41) and typecheck passed; platform tests passed (12) and typecheck passed; formatting and `git diff --check` passed.

### Fixed: non-finite pruning retention values entered feature registries

- **Evidence:** Manifest validation rejected retention days only when `<= 0`; `NaN` and `Infinity` therefore passed registration and later caused cutoff calculation failures during maintenance inspection or execution.
- **Change made:** Feature manifest validation and direct `DeclarativeTablePruner` construction now require a positive finite retention value.
- **Regression coverage:** Feature-system tests cover NaN, infinity, zero, and negative values; maintenance tests cover direct pruner construction with infinity.
- **Verification:** Feature-system tests passed (19) and maintenance tests passed (13); both typechecks passed; formatting and `git diff --check` passed.

### Improved: failed pruning inspections appeared as zero candidates

- **Evidence:** `MaintenanceOrchestrator.inspectAll()` logged count-query failures but returned `eligibleRowCount: 0`, making unavailable inspection indistinguishable from a successful zero count in diagnostics.
- **Change made:** Candidate stats now include the error message. The diagnostics page labels the aggregate as known rows when any inspection fails, shows the error count, and marks affected handlers unavailable. Retention cutoff calculation is also inside each handler's error boundary, so invalid custom-handler metadata is reported for that handler without preventing inspection of others.
- **Regression coverage:** Maintenance tests verify count-query errors and invalid retention metadata are returned in stats without aborting the rest of inspection.
- **Verification:** Maintenance tests passed (15) and maintenance typecheck passed. Demo typecheck passed after declaring the accepted formats in its widget-import definition; formatting and `git diff --check` passed.

### Fixed: invalid custom pruning counts appeared as valid diagnostics

- **Evidence:** `inspectAll()` accepted any value returned at runtime by a custom handler's `countEligible()`, so negative, fractional, or non-finite results could be displayed as candidate counts.
- **Change made:** The orchestrator now requires a non-negative safe integer and routes invalid counts through the existing per-handler inspection error reporting.
- **Regression coverage:** Tests cover negative, fractional, `NaN`, and infinite candidate counts and assert they are reported as unavailable inspection results.
- **Verification:** `@platform/maintenance` tests passed (19) and the package typecheck passed; formatting passed.

### Fixed: declarative pruning filters could broaden deletion predicates

- **Evidence:** The handler rejected statement separators and comments, but still accepted boolean expressions such as `status = 'ARCHIVED' OR 1 = 1`. Manifest validation also allowed such a policy into the feature registry.
- **Change made:** A shared core validator limits the optional filter to one column comparison against a literal. Both feature manifest validation and direct pruner construction enforce it, keeping the generated SQL expression narrow.
- **Regression coverage:** Feature-system and maintenance tests reject broadening predicates, and the storage-governance security suite verifies both validation boundaries. Existing simple status filters remain accepted.
- **Verification:** Feature-system tests passed (20), maintenance tests passed (19), and storage-governance security tests passed (6); core, feature-system, maintenance, and security typechecks passed.

### Fixed: nested log metadata bypassed credential redaction

- **Evidence:** `ConsoleLogger` sanitized only object properties and did not recurse into arrays. Sensitive values nested inside array items could therefore be emitted in plaintext; cyclic data could also make JSON formatting fail.
- **Change made:** Recursively sanitize nested objects and arrays, normalize key names before matching sensitive fields (including private seeds), replace cyclic references with a marker, and serialize bigint values safely.
- **Regression coverage:** A security test captures the emitted JSON and verifies nested private-key, seed, signing-key, and token values are redacted, circular metadata is safe, and public values remain visible.
- **Verification:** Core tests passed (8), core typecheck passed, log-redaction security test passed (1), and the security-suite typecheck passed; formatting passed.

### Fixed: timestamp validation accepted non-ISO and impossible UTC dates

- **Evidence:** `isValidUtcIsoTimestamp()` relied on JavaScript's permissive date parser and a trailing `Z` check. This could accept non-ISO spellings and calendar dates that do not exist.
- **Change made:** Require an ISO UTC timestamp shape with a `Z` timezone, valid time fields, and a real calendar date.
- **Regression coverage:** Core timestamp tests include valid timestamps with and without fractional seconds, impossible dates, non-ISO separators, and non-UTC offsets.
- **Verification:** Core typecheck passed; tests were not run in this pass.

### Fixed: callers could mutate the active in-memory session

- **Evidence:** Session role arrays were frozen, but the session object returned by `authenticate()` and `getCurrentSession()` remained mutable at runtime. A caller could change the user, device, or organisation values later copied into trusted operation contexts.
- **Change made:** Freeze the session record when it is established. Its role array is already frozen and remains so.
- **Regression coverage:** The authentication-boundary security test verifies that the session and roles are frozen, runtime mutation is rejected, and trusted context roles remain frozen.
- **Verification:** Not run in this pass.

### Fixed: native authentication exception text could leak credentials

- **Evidence:** `UserSessionService.authenticate()` copied the native gateway exception message into `AuthenticationError.message`. A gateway error containing a password or other sensitive detail could therefore flow into diagnostics or serialized error output.
- **Change made:** Replace the gateway's exception text with a fixed internal message; retain the existing generic user-facing message.
- **Regression coverage:** The authentication-boundary security test throws an exception containing the attempted password and verifies the returned error contains only the safe fixed messages.
- **Verification:** Not run in this pass.

### Fixed: session replacement during validation could use stale state

- **Evidence:** `validateCurrentSession()` awaited a device lookup and then reread `currentSession`. A concurrent logout or login could make the continuation throw on null state or return a session whose device had not been validated.
- **Change made:** Capture the immutable session before awaiting, reject if it is no longer the active session after the lookup, and use the captured record for expiry checks and return.
- **Regression coverage:** The authentication-boundary security test pauses device validation, logs out, then resumes the lookup and verifies no trusted context is produced.
- **Verification:** Not run in this pass.

### Fixed: memory database operations could interleave with transactions

- **Evidence:** The in-memory adapter queued transactions against other transactions but did not coordinate regular `query()` and `execute()` calls with that queue. An unrelated write during an awaited transaction callback could therefore participate in and be rolled back with the open transaction.
- **Change made:** Serialize memory adapter queries, writes, and transactions through one operation queue. Transaction-scoped operations continue to use the active transaction client directly.
- **Regression coverage:** A database test pauses a transaction, queues an ordinary write, rolls the transaction back, and verifies the outside write runs afterward and remains committed.
- **Verification:** Not run in this pass.

### Fixed: native database initialization accepted unhealthy storage

- **Evidence:** `NativeDatabaseConnection.init()` called `healthCheck()`, but that method reports failures as `healthy: false` instead of throwing. Initialization ignored the result and marked the connection ready even when required database invariants failed.
- **Change made:** Initialization now fails with a `DatabaseError` unless the native health result is healthy.
- **Regression coverage:** Database adapter tests verify unhealthy health results reject initialization; transaction mocks now return a healthy native database response.
- **Verification:** Not run in this pass.

### Improved: validate native database IPC response shapes

- **Evidence:** `NativeDatabaseConnection` asserted response types without runtime checks. A malformed IPC response could be returned as query rows or expose an invalid affected-row count as though it were valid.
- **Change made:** Validate query rows, non-negative safe-integer affected-row counts, and all required native health fields before using the values. Malformed health responses produce an unhealthy result, causing initialization to fail.
- **Regression coverage:** Database adapter tests exercise malformed query and execute responses.
- **Verification:** Not run in this pass.

### Fixed: migration sets could omit versions on a fresh database

- **Evidence:** The engine rejected duplicate migration identities and missing previously applied migrations, but accepted a fresh owner migration set such as versions 1 and 3. A missing step could leave the schema incomplete while later migrations were recorded as applied.
- **Change made:** Preflight now requires each supplied migration owner to define a contiguous sequence starting at version 1, before creating the migration history table or applying SQL.
- **Regression coverage:** Database tests verify a version gap is rejected before migration state is created.
- **Verification:** Not run in this pass.

### Fixed: native migration execution treated scripts as single statements

- **Evidence:** `MigrationEngine` passed each complete SQL migration script as one transaction operation. The native adapter and rusqlite prepared-statement API execute a single statement, while platform migration files contain multiple statements; memory-backed tests therefore did not reflect native behavior.
- **Change made:** Split migration scripts at SQLite statement boundaries and queue each statement within the same transaction. The splitter preserves quoted text, comments, and trigger bodies, including `CASE ... END` expressions.
- **Regression coverage:** Existing semicolon-in-string coverage remains, a migration test verifies trigger bodies with internal semicolons and a CASE expression execute as one atomic migration, and a native-adapter test verifies statements are sent as separate operations in one transaction.
- **Verification:** Not run in this pass.

### Fixed: platform initialization was not single-flight

- **Evidence:** Concurrent `Platform.init()` calls could both pass the initialized check and race through migration discovery and application. Synchronous feature registration also remained available after startup, allowing a feature to be registered without applying its migrations.
- **Change made:** Share one in-flight initialization promise and reject feature registration while initialization is running or after it succeeds. Failed initialization clears the in-flight promise so callers can retry.
- **Regression coverage:** Platform tests cover concurrent initialization and rejection of feature registration after startup.
- **Verification:** Not run in this pass.

### Fixed: malformed sync conflict policies could escape validation as runtime errors

- **Evidence:** The validator's rejection path interpolated `policy.conflictPolicy.strategy` even when the conflict policy was missing. Invalid untyped input therefore raised a `TypeError` instead of the package's typed validation error.
- **Change made:** Require the strategy to be a string before checking the supported strategy set, and keep the validation message independent of untrusted property access.
- **Regression coverage:** A missing conflict policy is asserted to fail through the expected validation error.
- **Verification:** Not run in this pass.

### Fixed: cyclic manifest metadata could overflow registry snapshotting

- **Evidence:** Registration deep-froze the structured-cloned manifest recursively without tracking visited objects. A cyclic extra property could cause unbounded recursion before registration completed.
- **Change made:** Track visited objects with a `WeakSet` while recursively freezing the isolated manifest snapshot.
- **Regression coverage:** Registering a manifest with cyclic extra metadata now verifies snapshotting completes and the metadata object is frozen.
- **Verification:** Not run in this pass.

### Improved: feature dependency ordering no longer depends on call-stack depth

- **Evidence:** Dependency resolution used recursive depth-first traversal and copied the full path at each edge. A sufficiently long valid chain could overflow the runtime call stack, while repeated path copies added avoidable work.
- **Change made:** Resolve dependencies with explicit traversal frames and one active path, preserving hard/optional dependency ordering and cycle diagnostics.
- **Regression coverage:** A 12,000-feature chain verifies the resolver handles deep graphs and preserves dependency order.
- **Verification:** Not run in this pass.

### Fixed: malformed feature manifests could bypass typed validation errors

- **Evidence:** Semantic validation assumed all required arrays and nested records existed with the declared TypeScript shapes. Runtime callers can provide malformed JavaScript values, causing incidental `TypeError`s before a controlled validation result.
- **Change made:** Add a structural preflight for required manifest fields and optional sections before semantic checks. Invalid input now fails with a `ValidationError` identifying the malformed field.
- **Regression coverage:** Null manifests and malformed permission entries are asserted to produce validation errors.
- **Verification:** Not run in this pass.

### Fixed: sync group creation escaped a caller transaction

- **Evidence:** `SyncGroupService.createGroup()` accepted an optional transaction and used it for authorization reads, but omitted it when inserting the group. A caller's later rollback could leave the group committed outside its transaction.
- **Change made:** Pass the caller transaction through to `SyncGroupRepository.insertGroup()` so the write participates in the same unit of work as authorization and surrounding mutations.
- **Regression coverage:** No test was added in this pass.
- **Verification:** Not run in this pass.

### Improved: audit persistence now follows the repository boundary

- **Evidence:** `AuditService` constructed SQL for audit inserts and filtered event reads directly, duplicating persistence concerns in the service layer and violating the repository-only data access invariant.
- **Change made:** Extract SQL execution and query construction into `AuditRepository`; retain event serialization, timestamps, and result mapping in `AuditService`. Transaction handles continue through the service to repository boundary.
- **Regression coverage:** No test was added in this pass.
- **Verification:** Not run in this pass.

### Fixed: canonical sync serialization omitted own `__proto__` payload keys

- **Evidence:** Recursive key sorting copied properties into a normal object with assignment. JavaScript treats assignment to `__proto__` specially, changing the accumulator prototype instead of creating an own property; JSON serialization then omitted that field from signed canonical bytes.
- **Change made:** Define each sorted key as an enumerable own data property so special property names are preserved in canonical serialization.
- **Regression coverage:** No test was added in this pass.
- **Verification:** Not run in this pass.

### Fixed: inbox duplicate IDs could return an unrelated stored envelope

- **Evidence:** `InboxService.receive()` returned an existing row by `envelope_id` before verifying the incoming signature or checking whether the signer/signature matched the stored operation. A conflicting envelope could be treated as a successful duplicate and expose the prior record.
- **Change made:** Verify first, insert with `ON CONFLICT(envelope_id) DO NOTHING` to make the unique key the atomic idempotency arbiter, then return the stored row only when its signer key and signature match the incoming verified envelope. Conflicting ID reuse now fails explicitly.
- **Regression coverage:** No test was added in this pass.
- **Verification:** Not run in this pass.

### Fixed: caller mutation during native signing could invalidate an envelope

- **Evidence:** `SyncEnvelopeBuilder.build()` canonicalized the caller-owned operation, awaited the asynchronous signer, then retained the original object in the returned envelope. A mutation during the await could make the envelope differ from its signed bytes.
- **Change made:** Snapshot the operation before validation/canonicalization and use that same snapshot to construct the envelope.
- **Regression coverage:** No test was added in this pass.
- **Verification:** Not run in this pass.

### Fixed: outbox envelope payload could disagree with its persisted payload column

- **Evidence:** `pendingBatch()` compared envelope routing and signature fields with their denormalized columns but did not compare `operation.payload` with `payload_json`. The returned outbox record could therefore expose conflicting payload representations after storage corruption or alteration.
- **Change made:** Validate the serialized envelope payload against `payload_json` before returning a pending record.
- **Regression coverage:** No test was added in this pass.
- **Verification:** Not run in this pass.

### Fixed: malformed task payloads could strand an entire claimed batch

- **Evidence:** `claimNextBatch()` transitioned rows to RUNNING before `rowToRecord()` parsed stored JSON. One corrupt payload threw while mapping the batch, hiding all claimed rows from the worker and leaving them RUNNING until later recovery.
- **Change made:** Wrap persisted payload decode failures in `DatabaseError`; during claiming, mark only the malformed row FAILED with a safe diagnostic and continue mapping valid tasks.
- **Regression coverage:** No test was added in this pass.
- **Verification:** Not run in this pass.

### Fixed: handlers that ignored timeout aborts could still complete tasks

- **Evidence:** The worker aborted the task signal at its timeout but marked the task COMPLETED whenever the handler eventually resolved, even after the timeout had elapsed.
- **Change made:** Check the abort signal after handler resolution and route timed-out work through the existing failure/retry transition.
- **Regression coverage:** No test was added in this pass.
- **Verification:** Not run in this pass.

### Fixed: AppShell exposed active navigation buttons without a handler

- **Evidence:** `onNavigate` is optional, but navigation items rendered enabled buttons and silently did nothing when no callback was supplied.
- **Change made:** Disable navigation buttons when the shell has no navigation handler and apply a visible disabled state.
- **Regression coverage:** No test was added in this pass.
- **Verification:** Not run in this pass.

### Fixed: Iroh transport retry skipped a listener after partial initialization

- **Evidence:** `IrohSyncTransport.init()` returned early whenever endpoint information existed. If native endpoint startup succeeded but event-listener registration failed, later calls could not attach the inbound listener.
- **Change made:** Initialization now retains the started endpoint and retries only the missing listener registration; it does not start a second endpoint.
- **Regression coverage:** Added a transport case where the first listener registration fails and the second succeeds, asserting endpoint startup occurs once.
- **Verification:** Pending sync package typecheck and formatting checks; tests have not been run.
