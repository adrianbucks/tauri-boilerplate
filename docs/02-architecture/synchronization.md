# Synchronization & P2P

## Current Implementation

**Status**: ✅ Full synchronization stack implemented — canonical envelopes, authenticated handshake, durable outbox/inbox, conflict engine, tombstones, and live iroh QUIC transport.

Implemented across `packages/sync-protocol`, `packages/sync`, `packages/tasks`, `crates/sync-core`, and `crates/crypto-core`.

### Test evidence

```
cargo test -p sync-core -- test_iroh_loopback_two_node_envelope_exchange
test result: ok. 1 passed; 0 failed

pnpm --filter @platform/sync test   (IrohSyncTransport.test.ts: 100% pass)
pnpm --filter @tests/security test  (sync-authorization.test.ts: 7/7 passed)
pnpm --filter @platform/tasks test  (33 tests: TaskQueueService + TaskWorker + OutboxSyncWorker)
```

---

## Architecture overview

The sync layer is responsible only for **how** authorised peers exchange data — not **whether** they are allowed to. All seven authorization gates are resolved before any data flows.

```
Business mutation
    ↓ (same local transaction)
core_sync_outbox (signed SyncEnvelope)
    ↓ (async — OutboxSyncWorker)
IrohSyncTransport
    ↓ (iroh QUIC stream, ALPN: tauri-boilerplate-sync/1.0)
Peer inbox
    ↓ (signature verification → HLC ordering)
Apply transaction
    ├── domain state
    ├── sync cursor update
    ├── conflict record (if required)
    └── audit event (for security-relevant operations)
```

---

## Seven admission gates

Every incoming connection from a peer traverses all seven layers before any data flows. Failure at any layer results in rejection — not silent filtering.

```
1. iroh QUIC transport connection established
       ↓
2. Cryptographic peer identity verified
   (peer's Ed25519 public key matches a known core_devices record)
       ↓
3. Application handshake verified
   (applicationId, protocolVersion, supportedFeatures match)
       ↓
4. Organisation relationship verified
   (peer belongs to the same organisation, or cross-org access is explicitly authorised)
       ↓
5. Device/user authentication verified
   (device is ACTIVE in core_devices; session is valid)
       ↓
6. Sync-group authorisation verified
   (device is ACTIVE member of the requested sync group)
       ↓
7. Data-scope/namespace permission verified
   (requested namespace is within the device's permitted namespaces)
       ↓
Synchronisation begins (only for authorised namespaces)
```

---

## Live iroh transport (WP-014)

### Native endpoint (`crates/sync-core`)

```rust
// crates/sync-core/src/endpoint.rs — IrohSyncEndpoint
pub struct IrohSyncEndpoint {
    endpoint: iroh::Endpoint,  // iroh 1.2.0
    // ALPN: "tauri-boilerplate-sync/1.0"
    // Framing: 4-byte length prefix + 1-byte ACK
    // Background inbound message listener
}

impl IrohSyncEndpoint {
    pub async fn start(&mut self) -> Result<NodeAddr, SyncError>;
    pub async fn connect(&mut self, peer_addr: NodeAddr) -> Result<(), SyncError>;
    pub async fn send_envelope(&self, peer_id: &str, data: Vec<u8>) -> Result<(), SyncError>;
    pub async fn disconnect(&mut self, peer_id: &str) -> Result<(), SyncError>;
    pub fn is_connected(&self, peer_id: &str) -> bool;
}
```

### Tauri IPC commands

| Command | Purpose |
|---|---|
| `sync_start_endpoint` | Initialize iroh QUIC endpoint |
| `sync_connect_peer` | Connect to a peer by `NodeAddr` |
| `sync_disconnect_peer` | Disconnect from a peer |
| `sync_send_envelope` | Transmit a signed envelope to a peer |
| `sync_is_connected` | Check connection status |
| Event: `sync://envelope-received` | Notify webview of incoming envelope |

### TypeScript transport adapter (`packages/sync`)

```typescript
// packages/sync/src/transport/IrohSyncTransport.ts
export class IrohSyncTransport implements SyncTransport {
  async initialize(): Promise<void>;
  async connect(peer: PeerInfo): Promise<void>;
  async sendEnvelopes(peerId: string, envelopes: SyncEnvelope[]): Promise<void>;
  async disconnect(peerId: string): Promise<void>;
  on(event: "envelope-received", handler: (env: SyncEnvelope) => void): void;
}
```

Private keys never enter `IrohSyncTransport` — Invariant #5 is upheld.

---

## Canonical signed envelopes (`packages/sync-protocol`)

### SyncEnvelope structure

```typescript
interface SyncEnvelope {
  envelopeId: string;        // Stable unique operation ID
  schemaVersion: number;     // Protocol version
  namespace: string;         // "appId/orgId/syncGroupId/featureId/entityType"
  entityId: string;          // Stable entity identity
  operationType: "create" | "update" | "delete" | "patch";
  payload: Record<string, unknown>;
  logicalTimestamp: string;  // HLC timestamp (e.g., "2026-09-13T10:00:00Z+1")
  signerPublicKey: string;   // "ed25519_pk_<hex>"
  signature: string;         // 128-hex Ed25519 signature
  // signature covers: canonicalSerialize(envelope without signature field)
}
```

### Deterministic serialization

```typescript
// Canonical serialization: sorted UTF-8 key JSON
const canonicalBytes = canonicalSerialize(envelopeWithoutSignature);
// Keys sorted lexicographically, no extra whitespace
// Used as the signing input and for signature verification
```

### Building an envelope

```typescript
const envelope = await SyncEnvelopeBuilder.build({
  namespace: `${appId}/${orgId}/${syncGroupId}/example-feature/widgets`,
  entityId: widget.id,
  operationType: "create",
  payload: widgetData,
  logicalTimestamp: hlc.now(),
  // Signing happens in native Rust — builder calls sign IPC command
});
```

---

## Authenticated handshake (`packages/sync-protocol`)

### HandshakeMessage

```typescript
interface HandshakeMessage {
  applicationId: string;
  protocolVersion: string;
  platform: string;             // "windows" | "android"
  signerPublicKey: string;      // "ed25519_pk_<hex>"
  nonce: string;                // 32-hex random nonce
  timestamp: string;            // ISO-8601 UTC
  signature: string;            // 128-hex Ed25519 over canonical handshake bytes
}
```

### HandshakeValidator checks

1. **Nonce freshness**: 32-hex random, not reused (tracked in `seenNonces: Set<string>`).
2. **Timestamp skew**: Timestamp within ±30 seconds of local clock.
3. **Signature validity**: Ed25519 signature over canonical handshake bytes (excluding `signature` field).
4. **Public key format**: Must match `ed25519_pk_<64 hex chars>`.
5. **Application ID match**: Must match expected application identifier.
6. **Protocol version compatibility**: Must be supported by this node.

---

## Durable replication queues (`packages/sync`)

### OutboxService

```typescript
// Atomically enqueue alongside business mutation (same transaction)
await outboxService.withTransaction(tx).queueOperation({
  namespace: "example/widgets",
  entityId: widget.id,
  envelope: signedEnvelope,
});
```

`OutboxSyncWorker` polls `core_sync_outbox` in batches, transmits via `IrohSyncTransport`, and handles retry with exponential backoff.

### InboxService

```typescript
// Idempotent receive — ON CONFLICT (envelope_id) DO NOTHING
await inboxService.receiveEnvelope(envelope);
// 1. Signature verification before insertion
// 2. HLC logical timestamp ordering on apply
// 3. Idempotent (duplicate envelopes are harmless)
```

---

## Conflict resolution (`packages/sync`)

### Supported strategies

| Strategy | Use case | Example |
|---|---|---|
| `lww` | Last-write-wins by HLC | Widget name, status fields |
| `append-only` | Audit events, logs | History entries |
| `immutable` | Primary keys, identifiers | Entity IDs |
| `additive` | Delta quantities | Stock movements (deltas only) |
| `manual` | Requires human resolution | Approval decisions |
| `crdt` | Collaborative documents | Future use |

### Safety guard

Applying an `additive` strategy to a field registered as an absolute quantity throws a `ConflictError` at registration time — preventing silent corruption of absolute values (e.g., stock-on-hand total).

```typescript
// ❌ This will throw at registry setup time:
conflictRegistry.registerPolicy("widgets", {
  field: "totalQuantity",   // registered as absolute
  strategy: "additive",     // → ConflictError thrown
});
```

### Policy registration

```typescript
// In FeatureManifest.syncPolicies
syncPolicies: [
  {
    entityType: "widget",
    namespace: "{application}/{organisation}/{syncGroup}/example-feature/widgets",
    conflictPolicy: { strategy: "lww" },
    syncable: true,
  },
],
```

Any synchronisable entity **must** declare a sync policy — this is enforced at feature registration (Invariant #3).

---

## Tombstone service

```typescript
// packages/sync/src/tombstone/TombstoneService.ts

// ✅ REQUIRED for synchronisable entity deletion
await tombstoneService.markDeleted({
  entityId: widget.id,
  namespace: "example/widgets",
  deletedBy: ctx.userId,
  deleteOperationId: generateOperationId(),
});

// The tombstone propagates to peers via outbox, preventing resurrection
```

Hard deletes are only safe when the data is provably outside replication/history requirements.

---

## HLC (Hybrid Logical Clock)

HLC provides deterministic ordering information but is **not** proof of authenticity and **not** a security clock.

- Use HLC for causal/ordering decisions.
- Use authenticated protocol nonces for replay protection.
- HLC overflow, malformed values, and deterministic tie-breaking require additional test coverage.

HLC format: `<ISO-8601 timestamp>+<monotonic counter>` — e.g., `2026-09-13T10:00:00.000Z+3`.

---

## Namespace design

```
{applicationId}/{organisationId}/{syncGroupId}/{featureId}/{entityType}
```

Examples:
```
demo/org_abc123/sg_xyz/example-feature/widgets
minimal-consumer/org_def456/sg_pqr/field-notes/notes
```

**Security principle**: Namespace patterns are security policy, not convenience wildcards. A wildcard must never escape its `organisation/sync-group` boundary unintentionally.

---

## Background sync worker

`OutboxSyncWorker` (`packages/tasks`) provides the background sync polling:

```typescript
// packages/tasks/src/workers/OutboxSyncWorker.ts
class OutboxSyncWorker {
  // Polls core_sync_outbox in configurable batches
  // Transmits via SyncTransport (IrohSyncTransport in production)
  // Handles batch failure with exponential backoff + jitter
  // Marks sent envelopes as 'sent' in the outbox
}
```

OS background lifecycle adapters (WP-016) — Android WorkManager and Windows scheduling — remain open gates for production.

---

## Open work

| Item | Work Package | Status |
|---|---|---|
| Android WorkManager adapter | WP-016a | 🚧 Open |
| Windows background task adapter | WP-016b | 🚧 Open |
| Multi-device NAT traversal benchmarking | WP-014 follow-up | 🚧 Open |
| Production relay policy (self-hosted) | ADR-030 | Deferred |
| iroh-docs evaluation completed | ADR-013 | ✅ Closed — custom operation log selected |
