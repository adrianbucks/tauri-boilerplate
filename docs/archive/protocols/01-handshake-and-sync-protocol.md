# Handshake and Sync Protocol

This is the **target wire protocol**. Handshake metadata validation and in-process pairing checks exist; there is no iroh transport, signed envelope exchange, or durable operation log. See [architecture/06](../architecture/06-synchronisation-and-p2p.md) and [S-06](../specifications/S-06-iroh-transport-and-handshake.md).

## Overview

Synchronisation is the fourth and last layer of the platform. It is responsible only for **how** authorised peers exchange data — not **whether** they are allowed to. Authorisation is fully resolved before any sync operation begins.

This document covers:

- iroh transport
- The seven-layer pre-sync authorisation stack
- The replication decision (iroh-docs vs custom operation log)
- Operation model
- Ordering and conflict resolution
- Tombstones and deletes
- Offline queue
- Sync state machine
- Namespace design
- Protocol versioning

---

## Transport: iroh

iroh provides the low-level P2P transport layer.

Reference:

- https://github.com/n0-computer/iroh
- https://docs.iroh.computer/

### What iroh provides

- NAT traversal (QUIC)
- Relay fallback when direct connection is impossible
- Peer addressing by public key (not IP address)
- Connection lifecycle management

### What iroh does NOT provide (handled by platform)

- Application-level identity verification
- Sync group authorisation
- Data-scope access control
- Conflict resolution
- Offline queue management

### iroh node lifecycle

```
Application starts
    ↓
initialise iroh node (crates/sync-core)
    ↓
node generates its iroh peer ID (derived from device keypair)
    ↓
node begins listening for connections
    ↓
Application shuts down → node shuts down cleanly
```

Android lifecycle: the iroh node must handle foreground/background/suspended/terminated transitions. **RESEARCH REQUIRED** — [R-06](../research/R-06-iroh-transport-and-iroh-docs.md).

---

## The seven-layer authorisation stack

Every incoming connection from a peer traverses all seven layers before any data flows. Failure at any layer → connection rejected, sync does not begin.

```
1. iroh connection established
       ↓
2. Peer identity verified
   (peer's public key matches a known device record)
       ↓
3. Application handshake
   (applicationId, protocolVersion, supportedFeatures exchanged)
       ↓
4. Organisation validation
   (peer belongs to the same organisation, or cross-org access is explicitly authorised)
       ↓
5. Device/user authentication
   (device is in ACTIVE status; session is valid)
       ↓
6. Sync-group authorisation
   (device is ACTIVE member of the requested sync group)
       ↓
7. Data-scope authorisation
   (requested namespace is within the device's permitted namespaces)
       ↓
Synchronisation begins (only for authorised namespaces)
```

---

## Sync state machine

The `SyncManager` in `packages/sync` maintains this state per peer connection:

```
DISCOVERED      ← peer seen (mDNS or relay)
    ↓
IDENTIFIED      ← peer identity verified
    ↓
CONNECTING      ← iroh connection being established
    ↓
CONNECTED       ← iroh connection established
    ↓
AUTHENTICATING  ← handshake and seven-layer auth in progress
    ↓
AUTHORISED      ← all layers passed; ready to sync
    ↓
SYNCING         ← data exchange in progress
    ↓
IDLE            ← sync complete; connection maintained for future changes
    ↓
DISCONNECTED    ← peer disconnected (retriable)

Terminal error states:
REVOKED         ← device was revoked during session
EXPIRED         ← membership lease expired
INCOMPATIBLE    ← protocol versions incompatible
ERROR           ← unrecoverable error (see diagnostics)
```

State transitions are logged and observable by the UI.

---

## Sync diagnostics model

```typescript
interface SyncDiagnostic {
  peerId: string;
  deviceId: string;
  connectionMode: "direct" | "relay";
  relayUsed: string | null;
  lastConnected: string | null;
  lastSuccessfulSync: string | null;
  pendingOperations: number;
  failedOperations: number;
  conflicts: number;
  authorisationState: SyncState;
  protocolVersion: number;
}
```

Diagnostics are displayed in the demo app diagnostics screen and included in the exported diagnostic bundle.

---

## Replication architecture decision (Phase 0 gate)

Two paths — still decided by a current iroh-docs spike ([R-06](../research/R-06-iroh-transport-and-iroh-docs.md)). The platform package boundary is the same for both paths.

### Option A — iroh-docs adapter

```
SQLite (query layer)
    ↕
sync adapter (crates/sync-core)
    ↕
iroh-docs (replication store, one document per sync-group namespace)
    ↕
iroh (transport)
```

SQLite remains the operational query model. iroh-docs handles offline writes, ordering, and authorship. The adapter syncs iroh-docs entries into SQLite on receipt.

**Proceed with this option only if a current spike confirms**:

- Documents can be partitioned by sync group
- Revoked peers can be excluded from future updates
- Historical data access can be restricted
- Conflict semantics are acceptable for the entity types in scope

### Option B — custom operation log

```
SQLite (query layer)
    ↕
operation log (packages/sync-protocol, core_sync_* tables)
    ↕
custom reconciliation (crates/sync-core)
    ↕
iroh (transport)
```

### Option C — hybrid

iroh as transport; borrow iroh-docs primitives where useful; custom domain operation model on top.

---

## Operation model (used if Option B or C)

```typescript
// packages/sync-protocol/src/SyncOperation.ts

interface SyncOperation {
  operationId: string; // ULID — globally unique
  applicationId: string; // Which application produced this
  organisationId: string; // Scoping
  syncGroupId: string; // Which group this belongs to
  featureId: string; // Which feature owns this entity type
  entityType: string; // e.g., 'inventory_item'
  entityId: string; // The stable entity ID (entity_id column)
  operation: "create" | "update" | "delete";
  payload: unknown; // Feature-defined; validated by feature schema
  authorId: string; // userId who generated this operation
  deviceId: string; // Device that generated this operation
  logicalTimestamp: string; // HLC timestamp string
  schemaVersion: number; // Feature schema version when this was generated
  protocolVersion: number; // Sync protocol version
  signature?: string; // Future: admin/device signature
}
```

---

## Idempotency guarantee

Every `operationId` must be unique. Receiving a duplicate produces `already_applied` — never a second database mutation.

```typescript
// On receiving an operation:
const existing = await db.query(
  "SELECT id FROM core_sync_sessions WHERE operation_id = ?",
  [op.operationId],
);
if (existing.length > 0) {
  return { result: "already_applied" };
}
// Otherwise: apply and record
```

The `operationId` UNIQUE constraint in the database provides the hard guarantee.

---

## Ordering — Hybrid Logical Clock

Use HLC timestamps for ordering sync operations across devices.

**RESEARCH REQUIRED** — [R-07](../research/R-07-local-first-replication-and-conflicts.md): confirm HLC representation before implementing.

Properties of HLC:

- Monotonically increasing per device (wall clock never goes backwards from the HLC perspective)
- Causally ordered when devices communicate
- Survives clock skew between devices

HLC format (design decision during [R-07](../research/R-07-local-first-replication-and-conflicts.md)):

```typescript
// Option: string encoding "wallClockMs_logicalCounter_deviceId"
// Example: "1709123456789_0042_dev_01J2KX..."
```

**Do not assume network delivery order.** Operations received out of order are sorted by HLC before application.

### Causal metadata

For entity types requiring stronger causal guarantees (collaborative documents), add:

```typescript
causalDependencies?: string[]   // operationIds this operation depends on
```

This is not needed for append-only events or most business records.

---

## Conflict policies

A feature registers its conflict policy per entity type and field:

```typescript
// packages/sync-protocol/src/ConflictRegistry.ts

type ConflictStrategy =
  | "lww" // Last-Write-Wins (by HLC timestamp)
  | "append-only" // Records are immutable after creation
  | "additive" // Values are summed (e.g., quantity adjustments)
  | "manual" // Conflict detected and surfaced to user
  | "immutable" // Record cannot be changed after creation
  | "crdt"; // Use CRDT semantics (Automerge — see R-008)

registerConflictPolicy({
  entityType: "inventory_item",
  field: "quantity",
  strategy: "manual", // quantity conflicts must be resolved by a human
});

registerConflictPolicy({
  entityType: "inventory_item",
  field: "updated_at",
  strategy: "lww",
});
```

**Default**: if no policy is registered, the platform applies `lww` and records the conflict in `core_sync_conflicts` for audit purposes.

**Do not use CRDT (`crdt` strategy) everywhere.** It is expensive in memory and CPU. Use it only for entity types that genuinely require it.

---

## Tombstones for deletes

Never execute a raw `DELETE` on a synchronised record.

### Tombstone operation

```typescript
// Delete operation payload
{
  operation: 'delete',
  entityId: 'item_01J2...',
  entityType: 'inventory_item',
  deletedAt: '2026-08-30T10:00:00Z',
  deletedBy: 'user_01J2...',
  operationId: 'op_01J2...',
  logicalTimestamp: '...',
}
```

### Database representation

```sql
-- inventory_items has tombstone columns:
ALTER TABLE inventory_items ADD COLUMN deleted_at TEXT;
ALTER TABLE inventory_items ADD COLUMN deleted_by TEXT;
ALTER TABLE inventory_items ADD COLUMN delete_operation_id TEXT;

-- All queries filter out deleted records:
SELECT * FROM inventory_items WHERE deleted_at IS NULL;
```

### Why tombstones matter

Without tombstones: an old peer that missed the delete will re-insert the record when it reconnects.

With tombstones: the delete operation propagates, and all peers mark the record deleted at the same logical timestamp.

### Tombstone lifecycle (RESEARCH REQUIRED — see R-005)

Tombstones must be retained long enough that all peers have received them. Open questions:

- What is the retention period for tombstones?
- How do we safely garbage-collect tombstones without resurrecting data?
- What happens to a peer that was offline for longer than the tombstone retention period?
- Should there be a minimum supported peer version before tombstones can be collected?

---

## Offline queue

The platform maintains a local queue of pending operations:

```typescript
type OfflineQueueState =
  | "pending" // Generated locally, not yet transmitted
  | "processing" // Currently being transmitted
  | "applied" // Confirmed applied by at least one peer
  | "failed" // Transmission failed; will retry
  | "quarantined"; // Cannot apply (unknown feature, schema too old, rejected)
```

### Local-first rule

The local database is the immediate operational system. A user operation completes locally as soon as the SQLite transaction commits. The network is a background concern.

```
User creates a stock movement
    ↓
validate → authorise → SQLite transaction (business + audit + replication metadata) → COMMIT
    ↓
UI: "Saved"
    ↓ (async, background)
sync engine picks up pending operation → transmits to connected peers
    ↓
UI: "Synced" (when confirmed)
```

If sync fails, the operation stays in `failed` state and retries on reconnect. Local operation is never blocked.

---

## Namespace design

The sync namespace hierarchy:

```
application/
  organisation/
    sync-group/
      feature/
        entity-type
```

Example for WMS Coventry warehouse inventory:

```
wms/acme/coventry-warehouse/inventory/items
wms/acme/coventry-warehouse/inventory/movements
wms/acme/birmingham-warehouse/inventory/items
```

**Rules**:

- Namespaces are always generated from validated, normalised identifiers — never raw user-input strings
- Namespace generation is deterministic and centralised in `packages/sync-protocol`
- The sync engine is given the allowed namespace list; it has no mechanism to request others

---

## Unknown feature handling

When a peer sends data for an unknown or unsupported feature:

| Situation                                 | Action                                                       |
| ----------------------------------------- | ------------------------------------------------------------ |
| Known feature, supported version          | Process normally                                             |
| Known feature, unsupported schema version | Quarantine; retry after upgrade                              |
| Unknown feature namespace                 | Quarantine; do not discard (may be meaningful after upgrade) |
| Invalid signature                         | Reject                                                       |
| Unauthorised namespace                    | Reject; record in security audit                             |

Do not silently discard quarantined data. It occupies space in `core_sync_conflicts` with state `quarantined`.

---

## Protocol versioning

```typescript
const SYNC_PROTOCOL_VERSION = 1; // Monotonic integer
```

Handshake message:

```typescript
interface SyncHandshake {
  applicationId: string;
  applicationVersion: string; // SemVer
  protocolVersion: number; // Must match or be compatible
  supportedFeatures: string[]; // Feature IDs this device has installed
  supportedEntityVersions: Record<string, number>; // featureId → schema version
  deviceId: string;
  organisationId: string;
}
```

If `protocolVersion` values are incompatible → reject with `INCOMPATIBLE` state and a clear error message. Never attempt to communicate using an incompatible protocol.

---

## Sync test harness (`tests/sync/`)

The sync harness simulates multiple devices for automated testing:

```typescript
interface SyncTestHarness {
  addDevice(config: DeviceConfig): SimulatedDevice;
  connect(deviceA: SimulatedDevice, deviceB: SimulatedDevice): void;
  disconnect(device: SimulatedDevice): void;
  partition(deviceA: SimulatedDevice, deviceB: SimulatedDevice): void;
  restore(deviceA: SimulatedDevice, deviceB: SimulatedDevice): void;
  delayMessages(ms: number): void;
  duplicateMessages(factor: number): void;
  reorderMessages(): void;
  dropMessages(rate: number): void;
  revokeDevice(device: SimulatedDevice): void;
  waitForSync(devices: SimulatedDevice[]): Promise<void>;
}
```

The harness is used for:

- Integration tests for the operation log / iroh-docs adapter
- Security regression tests
- Property-based testing of idempotency and ordering
