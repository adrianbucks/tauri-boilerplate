# Peer-to-Peer Synchronization Protocol Specification

This document specifies the wire format, 7-layer admission handshake, envelope structure, and state machine governing P2P replication across devices.

---

## 1. Protocol Identity & Wire Framing

- **Transport**: QUIC over UDP (via iroh `v1.2.0`) with ALPN `tauri-boilerplate-sync/1.0`.
- **Wire Framing**: 
  - Each message is transmitted over a bidirectional QUIC stream.
  - Frame structure: `[ 4-byte Big-Endian Length Prefix ] + [ UTF-8 JSON Canonical Envelope ]`.
  - Recipient transmits a 1-byte acknowledgement `0x06` (ACK) or `0x15` (NAK) upon stream completion.

---

## 2. Canonical Envelope Schema

All replication frames follow the `CanonicalSyncEnvelope` structure (`@platform/sync-protocol`):

```typescript
export interface CanonicalSyncEnvelope<TPayload = unknown> {
  /** Protocol specification version (currently 1) */
  readonly version: number;
  /** Unique envelope identifier (UUID v4) */
  readonly envelopeId: string;
  /** Deterministic HLC timestamp (e.g. 2026-09-29T18:00:00.000Z:0001:node_123) */
  readonly hlcTimestamp: string;
  /** Owning tenant identifier */
  readonly organisationId: string;
  /** Target sync group identifier */
  readonly syncGroupId: string;
  /** Domain namespace (e.g. 'feature.inventory') */
  readonly namespace: string;
  /** Unique entity identifier within the namespace */
  readonly entityId: string;
  /** Replication operation type */
  readonly operation: 'UPSERT' | 'TOMBSTONE';
  /** Node ID of transmitting peer */
  readonly senderNodeId: string;
  /** Cryptographic Ed25519 signature of the canonical JSON bytes */
  readonly signature: string;
  /** Domain entity payload */
  readonly payload: TPayload;
}
```

---

## 3. Seven-Layer Handshake Pipeline

Before an envelope is accepted or ingested into the local SQLite database, the receiving peer strictly executes the 7-layer admission checks:

```text
[ Incoming Connection ]
          │
Layer 1: Network Transport
          │ ALPN matches 'tauri-boilerplate-sync/1.0'
          ▼
Layer 2: Protocol Handshake
          │ Protocol version compatible (v1)
          ▼
Layer 3: Device Identity Verification
          │ Ed25519 signature matches sender's registered public key
          ▼
Layer 4: Device Admission Status
          │ Peer device is in ACTIVE state (not REVOKED or SUSPENDED)
          ▼
Layer 5: Organisation Isolation
          │ Mutual tenant boundary check (sender and receiver share organisationId)
          ▼
Layer 6: Sync Group Authorization
          │ Both peers are registered members of target syncGroupId
          ▼
Layer 7: Namespace Permissions
          │ Principal permissions grant read/write access to the entity namespace
          ▼
[ Accept Envelope & Enqueue to Inbound Inbox ]
```

Failure at any layer aborts the stream, drops the frame, and logs a `SECURITY_REJECTION` audit event.

---

## 4. Conflict Resolution & Tombstones

- **Causality & Ordering**: Monotonically increasing Hybrid Logical Clocks (HLC) guarantee total causal order across distributed devices.
- **Tie-Breaking**: If two concurrent updates have identical physical and logical clock components, the tie is deterministically broken using lexical comparison of the generating `nodeId`.
- **Tombstones**: Deletions are never raw SQL deletes. They are recorded with `operation: 'TOMBSTONE'`, preserving `deleted_at`, `deleted_by`, and `delete_operation_id` for at least 30 days before vacuuming.

---

## 5. Peer Connection State Machine

```text
               ┌───────────────┐
               │ DISCONNECTED  │
               └───────┬───────┘
                       │ connect()
                       ▼
               ┌───────────────┐
               │  CONNECTING   │
               └───────┬───────┘
                       │ QUIC stream established
                       ▼
               ┌───────────────┐
               │ AUTHENTICATING│ (7-Layer Handshake)
               └───────┬───────┘
                       │ Handshake verified
                       ▼
               ┌───────────────┐
        ┌─────►│  AUTHORISED   │◄─────┐
        │      └───────┬───────┘      │
        │              │ stream data  │
        │              ▼              │
        │      ┌───────────────┐      │
        │      │    SYNCING    │      │
        │      └───────┬───────┘      │
        │              │ batch ACKed  │
        └──────────────┴──────────────┘
                       │
             Revocation / Error
                       ▼
               ┌───────────────┐
               │    REVOKED    │ / ERROR
               └───────────────┘
```
