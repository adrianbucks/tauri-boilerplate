# 04 — Architecture Principles

---

## The four independent responsibilities

Every design decision must be traceable back to one of these four layers. They must remain separate at all times.

```
┌───────────────────────────────────────────────┐
│                    DATA                        │
│               SQLite (local)                   │
│  "What is the current local operational state?"│
└───────────────────────┬───────────────────────┘
                        │
┌───────────────────────▼───────────────────────┐
│                  IDENTITY                      │
│            Users / Devices / Sessions          │
│    "Who is making this request and from where?"│
└───────────────────────┬───────────────────────┘
                        │
┌───────────────────────▼───────────────────────┐
│               AUTHORISATION                    │
│           RBAC + Scoped Permissions            │
│    "Is this subject allowed to do this action  │
│          on this resource right now?"          │
└───────────────────────┬───────────────────────┘
                        │
┌───────────────────────▼───────────────────────┐
│              SYNCHRONISATION                   │
│           iroh / iroh-docs / op log            │
│   "How do authorised peers exchange data?"     │
└───────────────────────────────────────────────┘
```

**The most important implementation rule:**

> Never allow the sync layer to become the security layer by accident.

---

## The seven-layer authorisation stack

A peer being technically reachable **never** means it is authorised to receive application data.

Every data exchange must pass through all seven layers in sequence:

```
iroh connection
        ↓
peer identity verification
        ↓
application handshake (applicationId, protocolVersion match)
        ↓
organisation validation (same org, or explicitly cross-org authorised)
        ↓
device/user authentication (approved device, valid session)
        ↓
sync-group authorisation (device is ACTIVE member of the relevant group)
        ↓
data-scope authorisation (data is within the device's permitted namespace)
        ↓
synchronisation begins
```

Failure at any layer results in a clear rejection — not silent filtering.

---

## Core architecture rules

### Data layer rules

1. **No direct SQLite access from React components.** All reads and writes go through a repository that goes through the database package.
2. **One connection per application instance.** Features do not open their own database connections.
3. **Synchronisable entities use tombstones for deletion.** Never raw DELETE on a row that may have been replicated.
4. **Transactions capture business state atomically.** A single user operation commits business data, audit event, and replication metadata in one transaction. Network sync runs outside the transaction.

```
BEGIN
  update business tables
  insert audit event
  create replication metadata
COMMIT
  ↓
(async) sync engine notified
```

### Identity layer rules

5. **Private keys never cross the Rust/TypeScript boundary.** The frontend receives abstract identity objects, not raw keys.
6. **Device identity is established at first launch and immutable thereafter** (unless explicitly reset with admin approval).
7. **User identity is organisation-scoped.** No global user registry.

### Authorisation layer rules

8. **Never write `if (user.role === 'admin')` in feature code.** Always use `authorization.require('permission.name', resource)`.
9. **Permissions are hierarchical strings.** Example: `inventory.read`, `inventory.update`. Roles are collections of permissions — not permissions themselves.
10. **Scoped permissions include a resource dimension.** `inventory.read` + `{ warehouseId: 'COV' }` is a different grant from `inventory.read` globally.
11. **Sync groups determine which replication streams a device participates in.** Not every connected device syncs everything.

### Synchronisation layer rules

12. **Never implement `download all → filter locally`.** Implement `authorised namespaces → synchronise only those namespaces`.
13. **Every sync operation has a unique `operationId`.** Receiving a duplicate must produce `already_applied`, not a second mutation.
14. **Do not assume network delivery order.** Use HLC timestamps or causal metadata.
15. **Unknown operations are quarantined, not silently discarded.** They may become meaningful after an application upgrade.

### Local-first rules

16. **A normal user write must never wait for network.** Validate → authorise → write local SQLite → done. Sync is a background notification.
17. **If the network is unavailable, local CRUD must still work.** The UI should show "Saved locally, sync pending" — never "Save failed, network unavailable".
18. **Offline/online availability is explicitly documented per action type.** (See doc 09 — Sync and P2P.)

---

## Package dependency rules

Allowed import directions:

```
apps/demo
    → packages/platform
    → packages/ui
    → features/*

features/*
    → packages/authorization
    → packages/database
    → packages/audit
    → packages/sync
    → packages/feature-system
    → packages/ui
    → packages/import-export
    → packages/hardware
    → packages/core

packages/* (higher-level)
    → packages/core
    → packages/database (only: platform, sync, audit)

crates/* (Rust)
    → other crates/* as path dependencies
    → no circular deps
```

**Forbidden**:

- `packages/database` importing from `features/*`
- `packages/core` importing from any other `packages/*`
- `features/*` importing from `apps/*`
- Any feature importing directly from another feature's `internal/` modules

---

## Tauri command security rule

Every new Tauri command must be reviewed against these questions before merging:

| Question                                          | Required answer                                |
| ------------------------------------------------- | ---------------------------------------------- |
| Who can call this command?                        | Named, not "anyone"                            |
| What data can it access?                          | Scoped, not "anything"                         |
| Does it require a valid session?                  | Yes, unless it is a pre-auth bootstrap command |
| Does it access the filesystem?                    | If yes, capability must be narrowly scoped     |
| Does it expose secrets?                           | No — never                                     |
| Can it be called by an untrusted webview context? | Evaluate and document                          |

All capability grants in `tauri.conf.json` must be justified. No broad `allow-all` grants.

---

## Error handling model

### Error categories

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
  message: string; // Technical message for logs
  userMessage: string; // Localisation-ready user-facing message
  technicalDetails?: string;
  retryable: boolean;
  correlationId: string;
  cause?: unknown;
};
```

### Rust/TypeScript boundary

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

Every significant operation — import, sync session, pairing request, membership decision — generates a correlation ID at the point it begins.

That ID must appear in:

- The UI error message (if the operation fails)
- All log lines for the operation
- The audit event
- Sync diagnostics where relevant

```typescript
// Format: prefix_ulid (or uuid)
// Examples:
// imp_01J2KX...   (import operation)
// syn_01J2KX...   (sync session)
// mbr_01J2KX...   (membership request)
// auth_01J2KX...  (authorisation decision)
```

Correlation IDs enable support staff to trace any reported issue across logs, audit events, and sync state without gaining access to secrets.

---

## Data integrity principles

Database constraints are not optional:

```sql
-- Every column that cannot be null must be NOT NULL
-- Every unique business key must have a UNIQUE constraint
-- Every foreign key relationship must have a FOREIGN KEY constraint
-- Every value with a known domain must have a CHECK constraint
```

TypeScript validation and database constraints are **complementary, not alternatives**. Do not rely solely on TypeScript to enforce data integrity — SQLite constraints provide a hard guarantee regardless of which code path created the data.

---

## Performance constraints

These are baseline requirements, not aspirations:

| Operation                 | Target                         |
| ------------------------- | ------------------------------ |
| Application cold start    | < 2 seconds on target hardware |
| Page navigation           | < 200ms                        |
| Filtered table (10k rows) | < 100ms query + render         |
| Import (10k rows)         | < 10 seconds                   |
| Sync (1k entities)        | < 30 seconds on LAN            |

The UI must never load all rows into React state. Use SQLite pagination + TanStack Table + TanStack Virtual for large datasets.

---

## Offline availability matrix

Document explicitly which actions work offline. Expand this table as features are added.

| Action                              | Offline behaviour                                           |
| ----------------------------------- | ----------------------------------------------------------- |
| Read locally authorised data        | ✅ Full availability                                        |
| Create a local record               | ✅ Writes locally; sync pending                             |
| Update a local record               | ✅ Writes locally; sync pending                             |
| Request sync group membership       | ✅ Request stored locally; forwarded when connected         |
| Approve another device              | ⚠️ Policy-dependent (may require connectivity to propagate) |
| Revoke a device                     | ✅ Local revocation immediate; propagation deferred         |
| Change organisation security policy | ❌ Restricted — requires admin connectivity                 |
| Access newly authorised data        | ❌ Requires sync + authorisation after re-connection        |
| Import from file                    | ✅ Local only                                               |
| Export to file                      | ✅ Local only                                               |
