# Focused Plan: Feature and Application Review

**Status:** In progress; feature and app slices are being checked against current platform contracts.

## Scope

Review each feature (`example-feature`, `identity-admin`, `organisations`) against its manifest and platform contracts, then review the demo and minimal-consumer apps in smaller functional slices. Keep domain logic in `features/` or `apps/` and reusable mechanisms in `packages/` or `crates/`.

## Review sequence

1. For each feature, map manifest declarations to registered services, permissions, schemas, migrations, sync policies, pruning policies, and tests.
2. Trace mutations from UI to feature service to repository and native database; check authorization, tenant scoping, correlation IDs, audit, and outbox atomicity.
3. Inspect app startup/teardown, route and state composition, IPC gateway usage, capability files, and user-visible error handling.
4. Compare minimal-consumer integration with demo integration to expose accidental coupling or undocumented setup requirements.
5. Fix confirmed issues in a feature/app-sized change and add focused behavior/security regression coverage.

## Acceptance criteria

- Permission call sites map to declared permissions and are authorized at meaningful service boundaries.
- Synchronizable data has an explicit valid policy and deletions use the tombstone flow.
- Domain operations remain tenant-scoped, auditable, and atomic where required.
- Capabilities follow least privilege and carry clear justification; no broad grants are introduced as a workaround.
- Existing user-facing behavior is preserved or intentional enhancements are documented and covered.
- A downstream consumer can use platform APIs without modifying platform packages.
- Findings and verification are recorded in the parent [review plan](./codebase-review-plan.md).

## Findings

### Fixed: note deletion used inconsistent operation IDs and timestamps

- **Evidence:** The note row, tombstone, and signed delete envelope were assigned independent operation IDs; the tombstone service also generated its own deletion timestamp. This prevented reliable correlation of the replicated deletion and could leave the entity and tombstone metadata out of sync.
- **Change made:** Note deletion now generates one operation ID and one timestamp, writes both through the repository and tombstone service, and uses that operation ID in the signed outbox envelope. `TombstoneService.record()` accepts an optional caller-provided timestamp while retaining its generated-timestamp behavior for existing callers.
- **Regression coverage:** The minimal-consumer integration fixture now asserts that the note row, tombstone, and delete envelope share the same operation ID, and that the note and tombstone timestamps match.
- **Verification:** Minimal-consumer and sync package typechecks, formatting, and `git diff --check` passed. Tests were not run during this review pass.

### Fixed: minimal-consumer note listing could disclose cross-organisation records

- **Evidence:** `NotesService.listNotes()` used `NotesRepository.findAll({ excludeDeleted: true })` when no sync group was specified. That query had no organisation predicate, despite the service already deriving the caller's organisation.
- **Impact:** Any subject authorized to read notes could receive active notes belonging to every organisation in the local database.
- **Change made:** Added `NotesRepository.findAllWithinOrganisation()` and made ungrouped listing filter by the subject's organisation while excluding tombstoned rows.
- **Regression coverage:** Added a `tests/security/` regression with active records in two organisations and a deleted record in the caller's organisation; the caller receives only its own active record.
- **Verification:** The focused security regression and minimal-consumer package test passed; `pnpm --filter @apps/minimal-consumer typecheck` and `git diff --check` passed. The existing app fixture now seeds its required sync group, so enforced foreign keys validate the intended outbox flow.

### Fixed: feature services duplicated role-table queries outside authorization persistence

- **Evidence:** The minimal-consumer notes service, example-widget service, organisation service, identity-admin service, and sync-group service each queried `core_user_roles` before calling `AuthorizationEngine`. Effective grants were also queried directly by the engine.
- **Change made:** Added `AuthorizationRepository` for role and effective-permission reads. `AuthorizationEngine.requireForSubject()` now resolves role bindings at the authorization boundary, and all affected services use it while preserving their trusted-context path.
- **Regression coverage:** Authorization tests verify subject-role resolution rejects bindings whose role belongs to a different organisation. The RBAC security suite adds the same cross-tenant mismatch case; service tests retain successful and denied authorization behavior.
- **Verification:** Focused tests passed (39 tests across six files); typechecks passed for authorization, example-feature, identity-admin, organisations, and minimal-consumer. No feature/app service retains a direct `core_user_roles` role lookup.

### Fixed: minimal-consumer notes wrote placeholder signatures into the durable sync outbox

- **Evidence:** Create, update, and delete built envelopes with the literal signer key `ephemeral_local_signer` and signature `ephemeral_local_signature`. These do not conform to the sync protocol's Ed25519 formats and cannot be verified by peers.
- **Impact:** The app persisted unsendable operations while presenting mutations as successfully queued for sync.
- **Change made:** `NotesService` now requires an explicit `NotesSyncSigner`, creates envelopes with `SyncEnvelopeBuilder`, and calls the injected signing callback on canonical operation bytes. `createMinimalConsumerApp()` requires the signer dependency; the private key remains outside TypeScript and signing failures abort the same transaction as the note/outbox writes.
- **Regression coverage:** The app test checks canonical public-key/signature formats in outbox rows and verifies a signer failure rolls back the note and outbox. Security coverage verifies malformed signer output also rolls back both writes.
- **Verification:** Minimal-consumer tests and tenant/signature security tests passed (3 tests); app typecheck, formatting, and `git diff --check` passed.
- **Integration requirement:** The consuming Tauri app must provide the device public key and a `SignFn` adapter that invokes the native `sign_message` command. This repository exposes the native command but the minimal-consumer package does not include a frontend invoke adapter.

### Fixed: note updates could emit empty changes and tombstoned notes remained directly addressable

- **Evidence:** `updateNote()` accepted an empty patch and whitespace-only titles, writing a new timestamp and outbox operation without a meaningful change. `findByIdWithinOrganisation()` also returned tombstoned rows, allowing `getNote()` to expose deleted content and updates to modify records after deletion.
- **Change made:** Reject empty update patches and blank/non-string titles; reject non-string content at runtime. The organisation-scoped ID lookup now excludes deleted rows, so reads return `null`, updates fail as not found, and repeated deletes remain idempotent.
- **Regression coverage:** The app test verifies invalid updates do not add outbox rows. The security test verifies deleted notes cannot be listed, read, or updated.
- **Verification:** Minimal-consumer and security regression tests passed (3 tests); app typecheck, formatting, and `git diff --check` passed.

### Fixed: note reads and sync writes ignored sync-group membership

- **Evidence:** `NotesService` checked note permissions but did not verify that the requested group existed, belonged to the caller's organisation, was active, or had approved membership for the caller's device. Ungrouped note listing also returned records without considering the device's group memberships.
- **Impact:** A notes permission alone could disclose another same-tenant group's records or enqueue signed mutations for a group the device was not approved to use.
- **Change made:** `SyncGroupService.requireActiveMembership()` validates group status, tenant ownership, device membership, and any user-bound membership. Note create/update/delete and group-specific reads enforce membership. Ungrouped listing uses an existence query for approved device/user membership; a later review found it also needed to check global device status, now fixed below.
- **Regression coverage:** Security tests cover same-tenant non-member reads/writes, cross-tenant listing, deleted records, and failure atomicity.
- **Verification:** Authorization and app/security tests passed (12 tests across three files); authorization/app typechecks, formatting, and `git diff --check` passed.

### Fixed: sync-group lifecycle persistence lived inside the authorization service

- **Evidence:** `SyncGroupService` issued direct SQL for group creation, membership requests and decisions, member revocation, and membership checks. This made the service responsible for both authorization workflows and database persistence.
- **Change made:** Added `SyncGroupRepository` to own all sync-group and membership SQL. `SyncGroupService` now composes repository operations with its existing authorization checks and transaction boundaries.
- **Regression coverage:** The lifecycle test verifies an approved, user-bound device can use its group and that the same device is denied when presented with a different user identity.
- **Verification:** Authorization package tests and typecheck passed; `SyncGroupService` contains no direct query/execute calls; `git diff --check` passed.

### Fixed: identity-admin service issued user, role, and device SQL directly

- **Evidence:** `IdentityAdminService` executed SQL for user creation, role assignment, and device status changes directly from service methods, despite the documented repository boundary.
- **Change made:** Added a feature-owned `IdentityAdminRepository` for those writes. The service retains authorization, transaction, membership lifecycle, and audit orchestration.
- **Regression coverage:** Existing feature tests exercise user creation with/without role assignment, device approval/revocation, authorization denial, and cross-tenant rejection. The sync-group test fixture now includes the active-status column used by the authorization gate.
- **Verification:** Identity-admin tests passed (6); feature typecheck and `git diff --check` passed. `IdentityAdminService` contains no direct query/execute calls.

### Fixed in TypeScript service: example widgets did not enforce sync-group membership

- **Evidence:** `WidgetService` checked widget permissions and organisation scope but did not verify that the caller's device and user were approved for the widget's sync group.
- **Impact:** A user with a widget permission could access or mutate same-organisation records associated with a group they were not admitted to.
- **Change made:** Widget creation, group listing, reads, updates, and tombstone deletes now require an active group and matching device/user membership through `SyncGroupService`.
- **Regression coverage:** Feature tests cover non-member read/update/delete and unapproved-group access; the RBAC security suite covers a caller with the widget permission but no group membership.
- **Verification:** `widgetService.test.ts` passes (7 tests), feature typecheck passes, and `rbac-security.test.ts` passes (15 tests). Security typecheck passes after removing its package-local `rootDir`, which incorrectly excluded imported app source.

### Open: demo native widget commands bypass group-level admission checks

- **Evidence:** The earlier membership fix applies to `WidgetService`, but the shipped demo UI calls Rust `create_widget`, `create_widgets`, and `list_widgets` commands through `NativePlatformGateway`. `authorize_widget_create()` checks only `widgets.create` and organisation equality; it does not receive a group ID. The Rust create paths accept a caller-provided `sync_group_id` without verifying the group exists, is active, belongs to the session organisation, or has approved membership for the session device/user. `list_widgets` filters by organisation only and does not filter by admitted groups. The demo UI hardcodes `grp_demo`; no native startup migration or checked-in demo setup creates this group or an approved membership for the local device.
- **Impact:** Native demo callers with widget permissions can create records labelled for arbitrary groups and list same-organisation widgets from groups they have not joined. The TypeScript feature authorization is bypassed by the app's actual native CRUD path.
- **Plan:** Move the demo's widget-specific policy into an app-owned native service boundary or route the UI through a single application service that can enforce membership atomically with persistence. Keep SQL in repositories, bind checks to the authenticated `NativePrincipal`, and ensure list results are limited to approved memberships. Do not add widget business policy to reusable `native-core` as a shortcut. Add native Rust and `tests/security/` regression coverage before closing.
- **Status:** Security-sensitive; implementation is coupled to the native transaction and app/domain boundary design. Preserve the existing demo flow with an explicit, authorized group and device-membership provisioning path; do not auto-approve arbitrary caller-supplied groups. No behavior changed in this review slice.

### Fixed: widget repository returned database-shaped rows as application records

- **Evidence:** Repository methods returned SQLite's snake_case columns while services consumed the camelCase Drizzle `WidgetRecord` shape. Membership checks received `undefined` group IDs, and returned deleted timestamps had the wrong property name.
- **Change made:** `WidgetRepository` now maps database column names to the declared application record shape at the persistence boundary.
- **Regression coverage:** Existing widget lifecycle and cross-organisation tests exercise mapped IDs, group membership, quantities, and tombstone fields.
- **Verification:** `widgetService.test.ts` passes (7 tests), feature typecheck passes, and `git diff --check` passes.

### Fixed: widget updates and tombstone deletes were not atomic with authorization

- **Evidence:** `updateWidget()` and `deleteWidget()` checked permission, loaded the organisation-scoped record, verified sync-group membership, and then wrote outside a transaction.
- **Impact:** Membership or record state could change between admission and mutation, and individual persistence errors could leave the operation outside a consistent transaction boundary.
- **Change made:** Permission, record lookup, group membership validation, and update/tombstone persistence now run through one database transaction. Updates also reject empty patches, blank names, and quantities that are negative or not safe integers.
- **Regression coverage:** Feature tests verify invalid updates leave data unchanged. Security tests grant widget permissions while withholding group membership and verify update/delete denial leaves the authorized widget unchanged.
- **Verification:** Widget feature tests pass (8); RBAC security tests pass (15); both package typechecks and `git diff --check` pass.

### Fixed: widget creation accepted invalid quantities and direct reads exposed tombstones

- **Evidence:** Creation rejected negative quantities but accepted fractional, non-finite, or unsafe integers. The organisation-scoped ID lookup also returned deleted rows, unlike SKU and group listing queries.
- **Impact:** Invalid quantities could violate the integer domain rule or fail later during persistence. Deleted widget data remained directly readable after a successful tombstone delete.
- **Change made:** Creation now requires a non-negative safe integer, and the organisation-scoped ID lookup excludes tombstoned rows. Reads, updates, and repeated deletes therefore follow the same active-record lifecycle.
- **Regression coverage:** Feature tests cover fractional and non-finite creation quantities and confirm direct reads return `null` after deletion. The security regression confirms tombstoned widgets are inaccessible through the service.
- **Verification:** Widget feature tests pass (9); RBAC security tests pass (15); feature/security typechecks and `git diff --check` pass.

### Fixed: organisation updates were non-atomic and accepted no-op or blank-name changes

- **Evidence:** `updateOrganisation()` checked permission and loaded the organisation before writing outside a transaction. Empty patches still changed audit timestamps, and whitespace-only names were persisted.
- **Impact:** Authorization and persistence were separated by a race window, and invalid update requests could appear successful while modifying metadata.
- **Change made:** Permission resolution, organisation-scoped lookup, update, and result read now share one transaction. Empty patches and blank names are rejected before persistence.
- **Regression coverage:** Organisation feature tests verify invalid updates leave the name unchanged. The RBAC suite confirms an unauthorised update is denied and the stored organisation name remains unchanged.
- **Verification:** Organisation feature tests pass (5); RBAC security tests pass (16); feature/security typechecks and `git diff --check` pass.

### Fixed: users.create could assign arbitrary roles during account creation

- **Evidence:** `IdentityAdminService.createUser()` accepted `roleId` and inserted the role binding after checking only `users.create`. It did not verify the role belonged to the target organisation.
- **Impact:** A caller allowed to create accounts could grant a privileged role to the new user, including a role the caller could not manage; cross-organisation role IDs could also create invalid bindings.
- **Change made:** Role assignment now requires `roles.manage`, verifies the role exists within the caller's organisation, and performs both checks before inserting the user, inside the same transaction.
- **Regression coverage:** Feature tests reject cross-organisation roles and confirm no user is created. The security suite gives a user `users.create` without `roles.manage` and confirms the attempted role assignment is denied without a partial user record.
- **Verification:** Identity-admin tests pass (7); RBAC security tests pass (17); feature/security typechecks and `git diff --check` pass.

### Fixed: device approval and revocation identifiers were not bound to membership state

- **Evidence:** `approveDevice()` accepted a separate device ID and request ID, then approved the request and changed the supplied device's global status without confirming they referred to the same device. `revokeMembership()` wrote a revocation even when no active membership existed, allowing the identity-admin wrapper to revoke a device globally without a group membership.
- **Impact:** A permitted administrator could accidentally or deliberately approve/revoke a different device than the membership request or group membership represented. Already-decided requests could also be approved repeatedly.
- **Change made:** Membership approval checks that the request is pending and optionally enforces the expected device ID. Revocation requires an active/approved membership and a non-blank reason before recording the revocation or changing device status.
- **Regression coverage:** Identity-admin tests verify mismatched approval rolls back request/device state and that unrelated devices retain their status on invalid revocation. Security tests cover mismatched request approval, repeatable state protection, and revocation of a non-member.
- **Verification:** Authorization package tests pass (8); identity-admin tests pass (9); RBAC security tests pass (19); relevant typechecks and `git diff --check` pass.

### Fixed: device status could change without a registered device record

- **Evidence:** `IdentityAdminRepository.setDeviceStatus()` updated by device ID but did not establish that a device record existed. A membership request alone could be approved, creating an approved group membership for an unknown device; revocation could similarly record a nonexistent device.
- **Impact:** Membership and audit state could claim that an unknown identity had been approved or revoked even though no device lifecycle record existed.
- **Change made:** The identity-admin service now verifies the device record in the same transaction before approval or revocation. Approval rejects unregistered and revoked device states.
- **Regression coverage:** Feature tests verify missing-device approval leaves its request pending and missing-device revocation creates no revocation row. Security coverage confirms callers with the corresponding device permissions still cannot act on an unregistered device.
- **Verification:** Identity-admin tests pass (11); RBAC security tests pass (20); feature/security typechecks and `git diff --check` pass.

### Fixed: globally revoked devices retained usable group memberships

- **Evidence:** `IdentityAdminService.revokeDevice()` marks the device globally `REVOKED`, but only changes the selected group's membership row. `SyncGroupService.requireActiveMembership()` and `canSync()` previously checked membership status without checking the registered device status. A still-approved row for another group could therefore remain usable by feature-service admission even after global revocation.
- **Change made:** Membership authorization now reads device and group-membership eligibility together and requires the persisted device status to be `APPROVED` or `ACTIVE`. The reusable `canSync()` predicate also fails closed for missing, pending, suspended, or revoked device identities.
- **Regression coverage:** Added a `tests/security/` case that revokes a device in one group, verifies its other approved membership row remains unchanged, and confirms both `canSync()` and `requireActiveMembership()` deny the revoked device.
- **Verification:** Authorization, example-feature, minimal-consumer, integration, and security typechecks passed; Prettier and `git diff --check` passed. Tests have not been run.

### Fixed: device approval could reactivate a suspended identity

- **Evidence:** `IdentityAdminService.approveDevice()` rejected missing, unregistered, and revoked devices, but accepted a device in `SUSPENDED` or any unrecognized persisted state when a pending membership request existed. It then overwrote that state with `APPROVED`.
- **Change made:** Approval now accepts only `PENDING_APPROVAL`, `APPROVED`, or `ACTIVE` device states. Suspended, revoked, unregistered, missing, and unknown states fail before the membership request is changed.
- **Regression coverage:** Added a `tests/security/` regression that attempts to approve a suspended device and confirms its persisted status remains suspended.
- **Verification:** Authorization and identity-admin typechecks, security-suite typecheck, Prettier, and `git diff --check` passed. Tests have not been run.

### Fixed: membership requests could be rejected after approval

- **Evidence:** `approveMembership()` now guarded against non-pending requests, but `rejectMembership()` still wrote a rejection decision and changed the request status regardless of its current state.
- **Impact:** A single request could accumulate conflicting approval and rejection decisions while its approved membership remained active.
- **Change made:** Rejection now requires the request to remain `PENDING`, matching the existing approval state transition guard.
- **Regression coverage:** Security coverage creates an approved request and active membership, then verifies a later rejection fails without adding a conflicting decision.
- **Verification:** Authorization package tests pass (8); RBAC security tests pass (20); relevant typechecks and `git diff --check` pass.

### Open: organisations create and update need interactive native transactions

- **Evidence:** `OrganisationService.createOrganisation()` runs `requirePermission()` and `findByDomain()` inside `db.transaction()`. `updateOrganisation()` runs permission resolution, scoped lookup, update, and result lookup inside the callback. Native `TransactionClient.query()` explicitly rejects reads because native transactions currently collect writes and execute them after the callback; the memory database supports interactive reads, so feature tests do not expose this runtime incompatibility.
- **Impact:** Organisation creation and updates cannot complete through the native database adapter as currently composed.
- **Plan:** Resolve with the native transaction design in the [platform package review](./review-platform-packages.md). Do not move authorization or isolation-sensitive reads outside the transaction as a workaround.
- **Regression coverage:** Add native-adapter feature integration coverage after the supported transaction design is selected.

### Open: organisation creation does not bootstrap a usable tenant

- **Evidence:** Both `OrganisationService.createOrganisation()` and the native `create_organisation()` command insert an active `core_organisations` row, but neither provisions an initial tenant administrator, tenant-scoped role binding, or another explicit onboarding state. The organisation feature's permissions are resolved in the current organisation context, and identity-admin role assignment only accepts roles owned by that context's organisation.
- **Impact:** A newly created tenant can exist without any principal able to manage users, roles, devices, or tenant settings inside it. The creator's organisation-level create permission does not provide a safe or explicit transition to tenant administration.
- **Plan:** Define a bootstrap contract before changing either creation path. It must state who is eligible to administer the new tenant, how that authority is granted without accepting caller-supplied privileged role IDs, what onboarding state is persisted, and how the transition is audited and made atomic across the TypeScript and native entry points. Align the UI and downstream-consumer contract with that decision.
- **Regression coverage:** Add feature and `tests/security/` cases for authorized bootstrap, unauthorized tenant takeover, duplicate/retried creation, and rollback of partial tenant setup after the contract is selected.

### Fixed: whitespace-only organisation domains were persisted differently by each adapter

- **Evidence:** The TypeScript path tested `input.domain` before trimming, so a whitespace-only value was stored as an empty string. The native path trims and discards empty values.
- **Change made:** TypeScript creation now normalizes the optional domain once and treats an empty normalized value as `null`, matching the native path.
- **Regression coverage:** Added a service case that creates an organisation with a whitespace-only domain and expects `null`.
- **Verification:** Pending focused test and typecheck.

### Fixed: organisation domain uniqueness is enforced across database adapters

- **Evidence:** The TypeScript and native creation paths perform a lookup before inserting, but the core schema has no unique constraint or index on normalized domains. Legacy rows with mixed-case or padded values are not necessarily found by the normalized equality lookup.
- **Impact:** Concurrent creation paths or legacy data can result in multiple organisations resolving to the same logical domain, despite the service-level validation.
- **Change made:** Added platform migration 8 to both TypeScript and native migration registries. Its unique expression index applies `lower(trim(domain))`, while allowing null and whitespace-only legacy values. Both TypeScript and native preflight queries now use the same normalization, and create-time normalization remains in place.
- **Migration behavior:** Existing rows with duplicate normalized non-empty domains prevent migration 8 from applying. Operators must resolve those collisions before upgrading; the migration transaction leaves the prior schema intact on failure.
- **Verification:** Platform typecheck, native-core `cargo check`, Rust formatting, Prettier, and `git diff --check` passed. Tests were not run during this review pass.

### Fixed: organisation list failures were unhandled and stale rows survived session changes

- **Evidence:** The organisations screen launched its initial native list request from an async effect without a rejection handler. It also retained rows when the native session or gateway changed, allowing a later request to fail while the previous session's data remained visible.
- **Change made:** The screen now clears rows and prior errors when the session context changes, ignores results from a superseded effect, and surfaces list failures through its existing error alert.
- **Verification:** Pending demo application typecheck and formatting checks.

### Fixed: organisation creation reported a refresh failure as an ambiguous create failure

- **Evidence:** The create handler wrapped the mutation and follow-up list refresh in one `try` block. If creation committed but refreshing the list failed, the same generic error path ran even though the success state was already set.
- **Change made:** Creation success and refresh failure now have distinct user-facing messages, and the create action is explicitly disabled while a request is in progress.
- **Verification:** Pending demo application typecheck and formatting checks.

### Fixed: demo feature navigation ignored session permissions

- **Evidence:** The demo rendered widget, organisation, and identity administration routes for every authenticated session, despite their feature permission declarations. Native commands rejected unauthorized operations, but users could still navigate to unavailable feature screens.
- **Change made:** The demo now hides those navigation entries and falls back to the dashboard when the active session lacks the corresponding read/manage permission. Native command checks remain authoritative.
- **Verification:** Pending demo application typecheck and formatting checks.

### Fixed: React Strict Mode could initialize duplicate demo platform instances

- **Evidence:** `main.tsx` wraps the application in `React.StrictMode`, while `PlatformProvider` ran its asynchronous initialization on every effect setup without guarding duplicate starts. Development Strict Mode replays the effect setup and could construct duplicate platform/sync instances and native event listeners.
- **Change made:** Added a provider-lifetime single-start guard around platform initialization.
- **Verification:** Pending demo application typecheck and formatting checks.

### Fixed: demo UI could publish a native session before platform restoration succeeded

- **Evidence:** Startup restoration and fresh login set `nativeSession` before `UserSessionService.restoreNativeSession()` completed. If platform restoration failed, the login component could unmount despite the TypeScript platform remaining unauthenticated.
- **Change made:** Startup now exposes a restored session only after platform restoration succeeds and clears the native session if restoration fails. Fresh login similarly waits for platform restoration, clears the native session on failure, and publishes session state last.
- **Verification:** Pending demo application typecheck and formatting checks.

### Fixed: demo startup failures left the sign-in screen permanently disabled

- **Evidence:** The initialization guard was set before asynchronous startup and remained set on failure. `isReady` stayed false, so authentication remained disabled and the provider could not retry startup.
- **Change made:** Failed startup now tears down partial listeners and transport state, resets the guard, and exposes a retry action on the sign-in screen. Startup errors are labeled separately from credential errors.
- **Verification:** Pending demo application typecheck and formatting checks.

### Fixed: demo provider disposed the sync transport immediately after configuring it

- **Evidence:** Startup passed `syncTransport` to `Platform.configureSync()` and then immediately called `dispose()` on that same transport before exposing the platform. `SyncManager` therefore retained a stopped transport.
- **Change made:** The transport now remains active for the provider lifetime and is disposed during provider teardown or failed initialization.
- **Verification:** Pending demo application typecheck and formatting checks.

### Fixed: the demo exposed authentication but no user-facing sign-out action

- **Evidence:** The provider implemented `logout()` and the native gateway exposed session invalidation, but no demo component invoked that path.
- **Change made:** The shared app shell now accepts an optional logout callback and renders an accessible sign-out action with pending and failure feedback. The demo connects it to its existing native logout flow.
- **Verification:** Pending demo and UI package typechecks and formatting checks.

### Fixed: minimal-consumer note mutation authorization ran outside its transaction

- **Evidence:** Note create, update, and delete resolved permissions before opening their own transaction, while membership admission and persistence ran inside the transaction.
- **Impact:** A role change could occur between permission admission and the corresponding mutation.
- **Change made:** Each note mutation now resolves authorization through the exact transaction client used for membership checks, record changes, tombstone state, and outbox writes.
- **Regression coverage:** Added a security regression asserting note creation passes its transaction client to `AuthorizationEngine.requireForSubject()`.
- **Verification:** Pending minimal-consumer and security typechecks; tests have not been run.

### Fixed: note creation trusted compile-time types for title and content

- **Evidence:** `createNote()` called `.trim()` on `title` without validating its runtime type and passed `content` through without checking it was a string.
- **Impact:** Malformed values from untyped callers could surface as raw runtime errors or reach repository persistence outside the declared note contract.
- **Change made:** Creation now validates both fields at runtime and returns a domain validation error before opening the mutation transaction.
- **Regression coverage:** Added package cases for malformed title/content values and confirmed the note table stays unchanged.
- **Verification:** Pending minimal-consumer typecheck and formatting checks; tests have not been run.

### Fixed: ungrouped note listing ignored global device revocation

- **Evidence:** `NotesRepository.findAllWithinOrganisation()` filtered active membership rows but did not join `core_devices`. A device globally marked `REVOKED` or `SUSPENDED` could continue to list notes through a stale approved membership row.
- **Change made:** The membership existence query now requires the persisted device status to be `APPROVED` or `ACTIVE`, matching `SyncGroupService` eligibility rules.
- **Regression coverage:** Added a `tests/security/` case that globally revokes a device while leaving its group membership row unchanged, then verifies ungrouped listing returns no notes and group-specific reads deny access.
- **Verification:** Pending minimal-consumer and security typechecks; tests have not been run.

### Fixed: ungrouped note listing trusted a note's tenant without validating its sync group

- **Evidence:** The notes schema does not enforce that `notes.organisation_id` matches the referenced sync group's organisation. Ungrouped listing filtered notes by tenant and membership independently, so a device with a membership in another tenant's group could see a malformed note row assigned to the caller's tenant.
- **Change made:** Ungrouped listing now requires a matching active sync group with the same organisation as the note.
- **Regression coverage:** The tenant-isolation security case seeds an approved foreign-group membership plus a mismatched note row and verifies the row is excluded.
- **Verification:** Pending minimal-consumer and security typechecks; tests have not been run.

### Fixed: identity-admin user creation trusted malformed runtime fields

- **Evidence:** `createUser()` called `.trim()` on `displayName` without checking its runtime type and treated whitespace-only email as a present value, persisting an empty string. A malformed role ID could also reach persistence.
- **Change made:** Display name and optional email/role ID types are checked before transaction entry; role IDs must be non-empty, and blank email normalizes to `null`.
- **Regression coverage:** Feature cases cover malformed display name and email values and confirm whitespace email is stored as `null`.
- **Verification:** Pending identity-admin typecheck and formatting checks; tests have not been run.

### Fixed: unauthenticated note operations returned a generic error

- **Evidence:** `NotesService.requirePermission()` correctly rejected a missing user ID but threw a plain `Error`, unlike other features that use the platform authorization error contract.
- **Change made:** Missing authenticated subjects now receive `AuthorizationError` with a safe user-facing message and the operation correlation ID.
- **Regression coverage:** Added security coverage confirming the denial prevents note and outbox writes.
- **Verification:** Pending minimal-consumer and security typechecks and formatting checks; tests have not been run.

### Fixed: widget SKU uniqueness disagreed with organisation and tombstone scope

- **Evidence:** `WidgetService.createWidget()` checks for an existing active SKU within the caller's organisation, but the widgets schema and original migration imposed a global, permanent `UNIQUE(sku)` constraint. This rejected identical SKUs in different organisations and prevented reusing an SKU after its former widget was tombstoned.
- **Change made:** Added feature migration v2 to rebuild the table while preserving rows, then enforce uniqueness with a partial index on `(organisation_id, sku)` for active records. The Drizzle schema now declares the same indexes. The original migration remains unchanged so installations with recorded v1 checksums can upgrade safely.
- **Verification:** Drizzle's SQLite index API supports unique indexes with a `where` expression ([official index documentation](https://orm.drizzle.team/docs/indexes-constraints)). The example-feature typecheck, Prettier checks for changed TypeScript/docs, and `git diff --check` passed. Tests have not been run.

### Fixed: demo native startup omitted the widget schema upgrade

- **Evidence:** The TypeScript feature manifest included widget migrations v1 and v2, but demo startup embedded and applied only v1. A previously installed native database would therefore retain the global SKU constraint despite the feature schema and SQL having moved to active organisation-scoped uniqueness.
- **Change made:** Demo startup now applies both feature-owned migrations in order, embedding the same v2 SQL used by the feature manifest. The migration ownership, version, checksum, and SQL are checked together in the existing Rust unit test.
- **Verification:** `cargo fmt --manifest-path apps/demo/src-tauri/Cargo.toml -- --check` and `cargo check --manifest-path apps/demo/src-tauri/Cargo.toml` passed. Tests have not been run.

### Open: widget mutations do not consistently produce audit and sync records

- **Evidence:** The Rust demo create path records an audit event but neither single nor bulk creation writes an operation to `core_sync_outbox`. The TypeScript `WidgetService` CRUD methods currently write widget rows without an audit event or signed outbox envelope. The feature manifest declares widgets synchronizable, and the background scheduler drains the outbox.
- **Impact:** Widget changes made through normal feature/demo entry points are not reliably replicated, despite the feature's sync policy. The two write paths also have inconsistent audit behavior.
- **Integration details:** Native signing is available through the Tauri `sign_message` command and `createNativeSignFn()`, and `SyncManager.enqueueOperation()` builds a signed envelope and persists it through `OutboxService`. However, neither Rust widget mutation path nor the TypeScript `WidgetService` is wired to that path. `OutboxService.enqueue()` requires a caller-owned transaction; current native transaction IPC is write-batch-only and cannot atomically include membership reads, widget writes, audit events, and outbox rows.
- **Plan:** Define one app-owned atomic mutation contract for create, update, bulk import, and tombstone delete as part of the native transaction design. Bind admission to the session principal and all seven gates before data transmission. Preserve native-only key handling; do not enqueue placeholder or unsigned envelopes.
- **Regression coverage:** Add security and atomicity cases once the native signing/outbox contract is selected.
