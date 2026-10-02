# Research Gate R-002: Replication Substrate Evaluation & Decision

**Status:** ✅ DECIDED (Option 1 Selected)  
**Date:** 2026-09-13  
**Governing Work Package:** WP-014 (Real iroh P2P Transport)  
**Acceptance Gates:** G-06 (Sync Protocol), G-07 (Replication Durability), G-08 (Convergence)

---

## 1. Context and Problem Statement

The platform requires decentralized, local-first cross-device data replication without relying on mandatory centralized servers. Network participants must be able to communicate directly over peer-to-peer connections across local networks and NAT boundaries, with encrypted relay fallback when direct hole-punching fails.

However, replication cannot merely mirror raw key-values or tables:

1. **Invariant #4**: A peer being reachable does not mean it is authorized. All 7 admission layers (transport, peer identity, protocol version, organisation match, session/device status, sync-group policy, and namespace permissions) must be evaluated before application mutations are exchanged.
2. **Invariant #1**: Database access must remain transactionally coupled with application business state and `core_audit_events`.
3. **Invariant #6**: Synchronisable entities require explicit soft-delete tombstones (`deleted_at`, `deleted_by`, `delete_operation_id`).
4. **Domain Conflict Semantics**: Specific fields require non-LWW handling (e.g. additive vs. absolute quantity protection).

---

## 2. Alternatives Evaluated

### Option 1: Custom Signed Operation Envelopes over iroh QUIC (`iroh::Endpoint`) — _(SELECTED)_

In this architecture, `iroh::Endpoint` is used purely as the secure peer-to-peer transport substrate. It manages NAT traversal, QUIC encryption, peer discovery via public keys (`NodeId`), and DERP relay fallback. The application-level replication engine sends and receives authenticated, canonically serialized `SyncEnvelope`s across dedicated bidirectional QUIC streams.

- **Pros**:
  - Direct transactional coupling: Inbound envelopes are processed by `InboxService` inside a native SQLite transaction alongside business tables and audit logs.
  - Strict 7-layer admission: Handshake messages and envelopes pass cryptographic verification and tenant authorization checks before application state changes.
  - Domain-safe conflicts: Full control over conflict strategies (`ConflictEngine`) and tombstone lifecycles.
  - Clean boundary: Platform replication logic in `@platform/sync` is decoupled from network packet transport via `SyncTransport`.
- **Cons**:
  - Platform owns chunking and streaming for very large binary files (addressed by Option 3 in future phases).

### Option 2: Document CRDT Synchronization via `iroh-docs`

`iroh-docs` provides an integrated key-value document synchronization model backed by Willow CRDTs.

- **Pros**:
  - Built-in multi-peer CRDT reconciliation out of the box.
- **Cons**:
  - **Violates Invariant #1 & Invariant #4**: `iroh-docs` manages its own internal database. Synchronizing `iroh-docs` state into local SQLite tables requires reactive watchers, creating severe race conditions, duplicate writes, and inability to guarantee atomic commits across domain mutations and audit trails.
  - No per-mutation tenant authorization or fine-grained RBAC evaluation.
  - Limited to key-value CRDT semantics (cannot enforce custom domain rules like absolute inventory guards).

### Option 3: Hybrid Operation Log + iroh Blobs

Uses Option 1 for all structured transactional mutations and replication envelopes, and leverages `iroh-blobs` for content-addressed streaming of large binary attachments (>1 MiB).

- **Evaluation**:
  - Highly compatible with Option 1. The operation envelope carries the 32-byte Blake3 hash of the blob as metadata, and the blob is pulled asynchronously once the envelope passes all 7 admission gates.
  - Scheduled for Phase 7 (Large Objects / R-008).

---

## 3. Decision

We adopt **Option 1**:

1. Integrate `iroh` (v1.2.0) into `crates/sync-core`.
2. Configure `iroh::Endpoint` to listen on custom ALPN: `tauri-boilerplate-sync/1.0`.
3. Stream canonical, Ed25519-signed `SyncEnvelope` frames across QUIC streams.
4. Integrate with the existing `OutboxSyncWorker` and `InboxService` pipelines.
5. Upgrade ADR-012 from `Proposed` to `Accepted`.
