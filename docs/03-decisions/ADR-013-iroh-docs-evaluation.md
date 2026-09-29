# ADR-013: Replication Strategy — Custom Operation Log & Sync Adapter Architecture

**Status**: Accepted  
**Date**: 2026-08-30  
**Authors**: Antigravity Pair Programming

---

## Context

We must select the data replication model between devices. The system must support scoped sync groups, fine-grained namespace authorization, offline write reconciliation, deterministic conflict resolution (LWW / HLC / manual), and secure tombstone-based deletions without data resurrection.

## Options Evaluated

### Option A: Pure iroh-docs

- Treat iroh-docs as the sole replication and storage mechanism.
- _Evaluation_:
  - iroh-docs provides KV document replication per author/namespace.
  - _Challenges_: Querying relational business data (JOINs, filtered pagination, aggregation) directly from raw KV entries is inefficient compared to SQLite. Enforcing fine-grained field-level conflict policies (e.g. additive inventory vs LWW metadata) requires domain logic outside the raw doc layer.

### Option B: Pure Custom Operation Log over iroh Transport

- Every database mutation writes an explicit `SyncOperation` row in `core_sync_*`.
- Operations are transmitted over raw iroh QUIC streams to connected authorized peers.
- _Evaluation_: Full control over HLC ordering, conflict policy registries, idempotency guarantees, and schema version quarantine.

### Option C: Hybrid Architecture (Chosen)

- **Primary Query & Operational Storage**: Local SQLite database via Drizzle/repositories.
- **Replication Log**: Structured `SyncOperation` stream with unique `operationId`, HLC timestamps, and deterministic conflict policy handlers (`@platform/sync-protocol`).
- **Transport & Sync Session Management**: iroh QUIC connections with sync-group namespace partitioning (`crates/sync-core`).
- **Sync Adapter**: Bridges SQLite mutations to outbound sync buffers and applies inbound sync batches inside local SQLite transactions.

## Decision

We adopt **Option C (Hybrid Architecture)**:

1. SQLite remains the authoritative local operational state.
2. Synchronisable mutations generate immutable `SyncOperation` records.
3. Inbound operations pass through the 7-layer authorization check before being applied via their registered conflict policies.
4. Tombstones are used for all deletes (`deleted_at`, `deleted_by`, `delete_operation_id`).

## Consequences

- Full relational querying power of SQLite for local UI performance.
- Predictable, testable distributed replication semantics.
- Resilient to network partitions, out-of-order delivery, and duplicate transmissions.
