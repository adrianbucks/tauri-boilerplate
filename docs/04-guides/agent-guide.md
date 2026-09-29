# AI Agent & Automated Assistant Guidelines

This document provides the canonical operational instructions, behavioral rules, and architectural constraints for AI coding agents (such as Antigravity, Claude, ChatGPT, etc.) working on this repository.

---

## 1. The Prime Directive for AI Agents

> **Never guess at a security-sensitive, version-sensitive, or evolving API.**
> 
> Inspect existing code in the repository, examine package manifests (`package.json`, `Cargo.toml`), read lockfiles, and consult official documentation before proposing changes to Tauri 2, iroh, Drizzle, TanStack, or cryptographic primitives.

---

## 2. The 10 Critical Invariants

Every modification made by an AI assistant must strictly uphold these 10 non-negotiable invariants:

1. **Do not bypass the repository layer**: Never write raw SQL queries or open direct database connections in UI components, React hooks, or service layers. State access must flow through repository interfaces and transactions.
2. **Do not hardcode role checks**: Never write `if (user.role === 'admin')` or `if (role === 'owner')`. Always evaluate permissions via the authorization engine: `authorization.requireTrusted(ctx, 'permission.name', resource)` or `authorization.can()`.
3. **Do not sync without a sync policy**: Any synchronisable entity must declare a valid `SyncPolicyDefinition` in its `FeatureManifest`, including namespace, schema version, conflict strategy, and tombstone tracking.
4. **Do not transmit data before passing all 7 authorisation layers**: Network reachability is never authorization. All 7 admission gates (transport, protocol version, device identity, admission status, tenant match, sync group membership, namespace permissions) must be satisfied before application data is exchanged.
5. **Do not leak private keys**: Never expose private cryptographic keys (Ed25519 secret seeds or signing keys) to the TypeScript runtime, web storage, IPC parameters, SQLite, or log outputs. Private keys remain exclusively in native Rust custody (`crates/identity-core`).
6. **Do not use raw DELETE for synchronisable entities**: Always use the tombstone pattern (`deleted_at`, `deleted_by`, `delete_operation_id`). Direct SQL `DELETE` causes deleted entities to be resurrected by offline peers.
7. **Do not guess evolving APIs**: Do not invent speculative APIs for Tauri v2, iroh, Drizzle, or TanStack. Check lockfiles, official release docs, and verify via spikes.
8. **Do not grant broad Tauri capabilities**: Every capability in `capabilities/*.json` must be scoped narrowly to specific commands with explicit justification comments. Never grant `core:default` or wildcards casually to fix a test.
9. **Add security regression tests**: Every security change, tenant boundary fix, or permission update must be accompanied by an automated regression test in `tests/security/`.
10. **Maintain the boilerplate/implementation boundary**: Do not add domain-specific business logic into platform packages (`packages/`) or native crates (`crates/`). Domain logic belongs strictly in `features/` or `apps/`.

---

## 3. Forbidden vs. Required Code Patterns

### ❌ Forbidden Anti-Patterns
```typescript
// ❌ 1. Hardcoded role checking
if (user.role === "admin") { deleteWidget(id); }

// ❌ 2. Caller-constructed security context
const ctx = { userId: req.body.userId, organisationId: req.body.organisationId };

// ❌ 3. Direct raw SQL execution from UI or application service
await db.execute("SELECT * FROM widgets WHERE org = " + orgId);

// ❌ 4. Hard delete on synchronisable entities
await db.execute("DELETE FROM core_sync_entities WHERE id = ?", [id]);

// ❌ 5. Fabricating cryptographic identity
const publicKey = "ed25519_pk_" + deviceId;

// ❌ 6. Trusting handshake without cryptographic signature check
if (handshake.appId === "demo") return true;

// ❌ 7. Exposing private keys to webview or logs
console.log("Device private key seed:", privateKeySeed);

// ❌ 8. Broadening Tauri capability permissions to bypass errors
{ "permissions": ["core:default", "*"] }
```

### ✅ Required Idiomatic Patterns
```typescript
// ✅ 1. Centralized capability and permission enforcement
await authorization.requireTrusted(trustedContext, "widgets.write", { organisationId });

// ✅ 2. Tenant-scoped repository queries
const widget = await widgetRepository.findByIdWithinOrganisation(id, trustedContext.organisationId);

// ✅ 3. Atomic business mutations with transactional audit and outbox
await db.transaction(async (tx) => {
  await widgetRepo.withTransaction(tx).update(widget);
  await auditService.withTransaction(tx).record(auditEvent);
  await outboxService.withTransaction(tx).queueOperation(syncEnvelope);
});

// ✅ 4. Replication-safe tombstone deletion
await tombstoneService.markDeleted({
  entityId,
  namespace: 'feature.widgets',
  deletedBy: trustedContext.userId,
  deleteOperationId: crypto.randomUUID(),
});

// ✅ 5. Cryptographic signature verification with canonical serialization
const canonicalBytes = canonicalSerialize(envelopeWithoutSignature);
const isValid = await cryptoService.verifySignature(canonicalBytes, envelope.signature, peerPublicKey);

// ✅ 6. Idempotent inbox processing
await inboxService.receiveEnvelope(envelope);
```

---

## 4. Verification & Testing Requirements

Whenever you complete a task or refactor:
1. Always run TypeScript typechecks and unit tests:
   ```bash
   pnpm typecheck
   pnpm test
   pnpm --filter @tests/security test
   ```
2. If modifying Rust crates or native bindings:
   ```bash
   cargo test --workspace
   cargo clippy --workspace --all-targets -- -D warnings
   ```
3. Never mark a task complete if typecheck or existing tests are failing.
