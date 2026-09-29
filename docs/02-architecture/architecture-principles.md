# Architecture Principles

Treat every rule in this document as a non-negotiable coding standard for new work, not as evidence that the current codebase already satisfies it.

---

## Core data layer rules

**Rule 1: No direct SQLite access from React components or service classes.**

All reads and writes follow this chain:

```
UI → service → repository → database package → Rust (Tauri IPC) → SQLite
```

```typescript
// ❌ FORBIDDEN — direct SQL from a service
await db.execute("SELECT * FROM widgets WHERE org = " + orgId);

// ✅ CORRECT — through the repository abstraction
const widgets = await widgetRepository.findByOrganisation(organisationId, ctx);
```

**Rule 2: One connection per application instance.** Features do not open their own database connections. The single connection is owned by `@platform/database` and bridged via Tauri IPC to the Rust `DurableDatabase`.

**Rule 3: Synchronisable entities use tombstones for deletion.** Never raw `DELETE` on a row that may have been replicated.

```typescript
// ❌ FORBIDDEN
await db.execute("DELETE FROM widgets WHERE id = ?", [id]);

// ✅ CORRECT — tombstone pattern
await tombstoneService.markDeleted({
  entityId,
  namespace: "example/widgets",
  deletedBy: trustedContext.userId,
  deleteOperationId: generateOperationId(),
});
```

**Rule 4: Atomic business transactions.** A single user operation commits business data, audit event, and replication metadata in one transaction. Network sync runs outside the transaction.

```typescript
// ✅ CORRECT — atomic business + audit + outbox commit
await db.transaction(async (tx) => {
  await widgetRepo.withTransaction(tx).update(widget);
  await auditService.withTransaction(tx).record(auditEvent);
  await outboxService.withTransaction(tx).queueOperation(signedEnvelope);
});
// ↓ (async, background)
// OutboxSyncWorker transmits via iroh transport
```

---

## Identity layer rules

**Rule 5: Private keys never cross the Rust/TypeScript boundary.** The frontend receives abstract identity objects and signing results, not raw keys or seeds.

```typescript
// ❌ FORBIDDEN — exposing private key seed
console.log("Device private key:", privateKeySeed);

// ✅ CORRECT — public identity only crosses IPC
const { publicKey, deviceId } = await invoke("get_device_identity");
```

**Rule 6: Device identity is established at first launch** and is immutable thereafter unless explicitly reset with admin approval.

**Rule 7: User identity is organisation-scoped.** There is no global user registry. Every user belongs to exactly one organisation context.

---

## Authorisation layer rules

**Rule 8: Never write `if (user.role === 'admin')` in feature code.** Always use the authorisation engine.

```typescript
// ❌ FORBIDDEN
if (user.role === "admin") { deleteWidget(id); }

// ✅ CORRECT
await authorization.requireTrusted(trustedContext, "widgets.delete", { organisationId });
```

**Rule 9: Permissions are hierarchical dot-separated strings.** Roles are collections of permissions — not permissions themselves.

```
widgets.read
widgets.create
widgets.update
widgets.delete
users.approve
sync.manage
```

**Rule 10: Scoped permissions include a resource dimension.** `widgets.read` scoped to `{ organisationId: 'org_abc' }` is a different grant from an unscoped `widgets.read`.

**Rule 11: Sync groups determine replication stream participation.** Not every connected device syncs everything.

---

## Synchronisation layer rules

**Rule 12: Never implement `download all → filter locally`.** Implement `authorised namespaces → synchronise only those namespaces`.

**Rule 13: Every sync operation has a unique `operationId`.** Receiving a duplicate must produce `already_applied`, not a second mutation.

**Rule 14: Do not assume network delivery order.** Use HLC timestamps and causal metadata for ordering.

**Rule 15: Unknown operations are quarantined, not silently discarded.** They may become meaningful after an application upgrade.

---

## Local-first rules

**Rule 16: A normal user write must never wait for network.** 

```
Validate → Authorise → Write local SQLite → Done
                              ↓ (background)
                       OutboxSyncWorker → peer
```

**Rule 17: If the network is unavailable, local CRUD must still work.** The UI shows "Saved locally, sync pending" — never "Save failed, network unavailable."

---

## Offline availability matrix

| Action | Offline behaviour |
|---|---|
| Read locally authorised data | ✅ Full availability |
| Create a local record | ✅ Writes locally; sync pending |
| Update a local record | ✅ Writes locally; sync pending |
| Request sync group membership | ✅ Request stored locally; forwarded when connected |
| Approve another device | ⚠️ Policy-dependent — may require connectivity to propagate |
| Revoke a device | ✅ Local revocation immediate; propagation deferred |
| Change organisation security policy | ❌ Restricted — requires admin connectivity |
| Access newly authorised data | ❌ Requires sync + authorisation after reconnection |
| Import from file | ✅ Local only |
| Export to file | ✅ Local only |

---

## Error handling model

### Error categories (TypeScript)

```typescript
// packages/core/src/errors/
type PlatformErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "SYNC_ERROR"
  | "CONFLICT_ERROR"
  | "DATABASE_ERROR"
  | "MIGRATION_ERROR"
  | "FILE_ERROR"
  | "HARDWARE_ERROR"
  | "NETWORK_ERROR"
  | "COMPATIBILITY_ERROR";

type PlatformError = {
  code: PlatformErrorCode;
  message: string;         // Technical message for logs
  userMessage: string;     // Localisation-ready user-facing message
  technicalDetails?: string;
  retryable: boolean;
  correlationId: string;
  cause?: unknown;
};
```

### Error serialisation at the Rust/TypeScript boundary

Rust errors must be serialised into `PlatformError` before crossing to TypeScript. Raw Rust error strings must never reach the frontend as a user-visible contract.

```rust
// crates/native-core/src/error.rs
#[derive(serde::Serialize)]
pub struct PlatformError {
    pub code: String,
    pub message: String,
    pub user_message: String,
    pub retryable: bool,
    pub correlation_id: String,
}
```

---

## Correlation IDs

Every significant operation (import, sync session, pairing request, membership decision) generates a correlation ID at the point it begins. That ID must appear in:
- The UI error message (if the operation fails)
- All log lines for the operation
- The audit event
- Sync diagnostics where relevant

```typescript
// Format: prefix_ulid
// Examples:
// imp_01J2KX...   (import operation)
// syn_01J2KX...   (sync session)
// mbr_01J2KX...   (membership request)
// auth_01J2KX...  (authorisation decision)
```

---

## Data integrity constraints

Database constraints are not optional:

```sql
-- Every column that cannot be null must be NOT NULL
-- Every unique business key must have a UNIQUE constraint
-- Every foreign key relationship must have a FOREIGN KEY constraint with REFERENCES
-- Every value with a known domain must have a CHECK constraint
```

TypeScript validation and database constraints are **complementary, not alternatives**. Do not rely solely on TypeScript to enforce data integrity — SQLite constraints provide a hard guarantee regardless of which code path created the data.

---

## Performance targets

| Operation | Target |
|---|---|
| Application cold start | < 2 seconds on target hardware |
| Page navigation | < 200 ms |
| Filtered table (10k rows) | < 100 ms query + render |
| Import (10k rows) | < 10 seconds |
| Sync (1k entities) | < 30 seconds on LAN |

The UI must never load all rows into React state. Use SQLite pagination + TanStack Table + TanStack Virtual for large datasets.

---

## Tauri command security checklist

Every new Tauri command must be reviewed against these questions before merging:

| Question | Required answer |
|---|---|
| Who can call this command? | Named and minimal — not "anyone with webview access" |
| What data can it access? | Scoped, not the entire database |
| Does it require a valid session? | Yes, unless it is an explicit pre-auth bootstrap command |
| Does it access the filesystem? | Only through narrowly scoped capability grants |
| Does it expose secrets? | Never — private keys, credentials must not be returned |
| Can it be called by an untrusted webview context? | Must be evaluated explicitly for each command |

All capability grants in `capabilities/*.json` must be narrowly scoped. No `allow-all` grants. Every grant must have a comment explaining why it is needed.

---

## Research before implementation

Any item marked **RESEARCH REQUIRED** must not be solved by guessing. Before implementing:

1. Read current official documentation.
2. Inspect the current upstream repository and package versions.
3. Build a minimal proof of concept.
4. Record the result in an Architecture Decision Record.
5. Only then commit the abstraction to the platform.

This is especially critical for Tauri, iroh, Drizzle, and TanStack — all actively evolving projects.
