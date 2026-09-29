# Agent and Developer Guidelines

This document is the canonical operational guide for AI agents and human developers contributing to the Tauri Boilerplate codebase.

---

## 1. Prime Directive

**Never guess at a security-sensitive or version-sensitive API.**
Inspect the repository, inspect installed package/crate dependencies, consult current official documentation (Tauri 2, Rust, Drizzle, iroh, TanStack, React 19), and implement proof-of-concept spikes rather than assuming API shapes.

---

## 2. The 10 Critical Invariants

Every change to the codebase must uphold these 10 non-negotiable invariants:

1. **Do not bypass the repository layer**: Never execute direct SQL queries or open raw connections in UI components or service classes. Access database state exclusively through domain repositories and transactions.
2. **Do not hardcode role checks**: Never write `if (user.role === 'admin')`. Always evaluate permissions via the authorization engine: `authorization.require(principal, 'permission.name', resourceScope)` or `authorization.can()`.
3. **Do not sync without a sync policy**: Any synchronisable entity must declare a valid `SyncPolicyDefinition` in its `FeatureManifest`, including namespace, schema version, conflict strategy, and tombstone tracking.
4. **Do not transmit data before passing all 7 authorisation layers**: Reachability via network/transport is never authorisation. All 7 admission gates (transport, peer identity, protocol version, organisation match, session/device status, sync group membership, namespace permissions) must pass before application data is exchanged.
5. **Do not leak private keys**: Never expose private cryptographic keys (Ed25519 seed or signing keys) to the TypeScript runtime, web storage, IPC parameters, or SQLite databases. Private keys remain exclusively in native custody (`crates/identity-core`).
6. **Do not use raw DELETE for synchronisable entities**: Always use the tombstone pattern (`deleted_at`, `deleted_by`, `delete_operation_id`). Hard deletes allow offline peers to resurrect stale state.
7. **Do not guess evolving APIs**: Do not invent speculative APIs for Tauri v2, iroh, Drizzle, or TanStack. Check lockfiles, official release docs, and verify via spikes.
8. **Do not grant broad Tauri capabilities**: Every capability in `capabilities/*.json` must be scoped narrowly to specific commands with explicit justification comments. Never grant `core:default` or wildcards casually to fix a test.
9. **Add security regression tests**: Every security change, tenant boundary fix, or permission update must be accompanied by an automated regression test in `tests/security/`.
10. **Maintain the boilerplate/implementation boundary**: Do not add domain-specific business logic into platform packages (`packages/`) or native crates (`crates/`). Domain logic belongs strictly in `features/` or `apps/`.

---

## 3. Mandatory Reading by Task

Before modifying any subsystem, read the relevant architectural document and current state evidence:

| Task Area | Mandatory Documents |
| :--- | :--- |
| **Any Task** | [`docs/PROJECT_REFERENCE.md`](../PROJECT_REFERENCE.md), [`docs/verification/CURRENT_STATE.md`](../verification/CURRENT_STATE.md) |
| **Architecture / Boundaries** | [`docs/architecture/SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md), [`docs/decisions/ADR_INDEX.md`](../decisions/ADR_INDEX.md) |
| **Database & Migrations** | [`docs/architecture/DATA_AND_DATABASE.md`](../architecture/DATA_AND_DATABASE.md), [`packages/database`](../../packages/database), migration suites |
| **Identity & Authentication** | [`docs/architecture/IDENTITY_AND_AUTHENTICATION.md`](../architecture/IDENTITY_AND_AUTHENTICATION.md), [`crates/identity-core`](../../crates/identity-core) |
| **Authorization & Tenancy** | [`docs/architecture/SECURITY_ARCHITECTURE.md`](../architecture/SECURITY_ARCHITECTURE.md), [`packages/authorization`](../../packages/authorization) |
| **Replication & Sync** | [`docs/architecture/SYNC_ARCHITECTURE.md`](../architecture/SYNC_ARCHITECTURE.md), [`packages/sync-protocol`](../../packages/sync-protocol), [`packages/sync`](../../packages/sync) |
| **Background Execution** | [`docs/architecture/BACKGROUND_TASKS.md`](../architecture/BACKGROUND_TASKS.md), [`packages/tasks`](../../packages/tasks) |
| **Native & Tauri IPC** | [`docs/architecture/SECURITY_ARCHITECTURE.md`](../architecture/SECURITY_ARCHITECTURE.md), `apps/demo/src-tauri` |

---

## 4. Forbidden vs. Required Code Patterns

### Forbidden Anti-Patterns
```typescript
// ❌ Hardcoded role checking
if (user.role === "admin") { ... }

// ❌ Caller-constructed security context
const ctx = { userId: req.body.userId, organisationId: req.body.organisationId };

// ❌ Direct raw SQL execution from UI or application service
await db.execute("SELECT * FROM widgets WHERE org = " + orgId);

// ❌ Hard delete on synchronisable entities
await db.execute("DELETE FROM core_sync_entities WHERE id = ?", [id]);

// ❌ Fabricating cryptographic identity
const publicKey = "ed25519_pk_" + deviceId;

// ❌ Trusting handshake without cryptographic signature check
if (handshake.appId === "demo") return true;

// ❌ Exposing private keys to webview or logs
console.log("Device private key seed:", privateKeySeed);

// ❌ Broadening Tauri capability permissions to bypass errors
{ "permissions": ["core:default", "*"] }
```

### Required Patterns
```typescript
// ✅ Centralized capability and permission enforcement
await authorization.requireTrusted(trustedContext, "widgets.write", { organisationId });

// ✅ Tenant-scoped repository queries
const widget = await widgetRepository.findByIdWithinOrganisation(id, trustedContext.organisationId);

// ✅ Atomic business mutations with transactional audit and outbox
await db.transaction(async (tx) => {
  await widgetRepo.withTransaction(tx).update(widget);
  await auditService.withTransaction(tx).record(auditEvent);
  await outboxService.withTransaction(tx).queueOperation(syncEnvelope);
});

// ✅ Replication-safe tombstone deletion
await tombstoneService.markDeleted({
  entityId,
  namespace,
  deletedBy: trustedContext.userId,
  deleteOperationId
});

// ✅ Deterministic canonical serialization and cryptographic verification
const canonicalBytes = canonicalSerialize(envelopeWithoutSignature);
const isValid = await verifySignature(canonicalBytes, envelope.signature, peerPublicKey);

// ✅ Idempotent inbox processing
await inboxService.receiveEnvelope(envelope);
```

---

## 5. Security Change Gate Protocol

Human review and explicit verification are mandatory before merging changes that impact:
1. Cryptographic algorithms, key generation, or native key custody (`crates/identity-core`, `crates/crypto-core`).
2. Authentication, password verification (Argon2id), session issuance, and lockout policies.
3. Authorization logic, RBAC evaluation, and tenant isolation filtering.
4. Tauri IPC command registration and capability definitions (`capabilities/*.json`).
5. Sync admission handshake, replay resistance, and envelope signing.
6. Database migrations altering security, audit, or user authentication schemas.
7. Application packaging, code signing, and release pipeline security.

---

## 6. Research Gate Protocol

When an architectural or dependency milestone is designated as a **RESEARCH GATE** (e.g. `R-002: iroh P2P transport integration`):
- Do not implement speculative APIs or install unverified packages.
- Produce a structured research artifact with:
  1. Technical question and scope.
  2. Official evidence and verified documentation sources.
  3. Operating system constraints (Windows & Android compatibility).
  4. Evaluated alternatives and tradeoffs.
  5. Recommended minimal proof-of-concept (spike).
  6. Concrete acceptance criteria and corresponding ADR updates.

---

## 7. Development & Verification Workflow

Before proposing or merging any change:
1. **Pre-check**: Read `docs/verification/CURRENT_STATE.md` to confirm the baseline.
2. **Execute tests**:
   ```bash
   pnpm typecheck
   pnpm test
   pnpm --filter @tests/security test
   cargo test --workspace
   ```
3. **Format & Lint**:
   ```bash
   pnpm format:check
   cargo fmt --all -- --check
   cargo clippy --workspace --all-targets -- -D warnings
   ```
4. **Documentation Synchronization**: Code and documentation must never diverge. When modifying behaviors, update the corresponding `docs/architecture/` files, `docs/verification/CURRENT_STATE.md`, and record new ADRs when introducing architectural decisions.
