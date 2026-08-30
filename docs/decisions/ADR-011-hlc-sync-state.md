# ADR-011: Hybrid Logical Clock (HLC) and P2P Sync State Machine

## Status

Accepted

## Context

Decentralized peer-to-peer data replication requires:

1. Monotonic causality tracking that remains resilient against physical clock drift, leap seconds, and out-of-order packet arrival.
2. A deterministic state machine representing the lifecycle of peer connections through all 7 authorization phases.
3. Declarative conflict resolution policies per entity type (`lww`, `additive`, `append-only`, `manual`).

## Decision

We implement `@platform/sync-protocol` and `@platform/sync`:

1. **Hybrid Logical Clock (`HybridLogicalClock`)**:
   - Encodes wall-clock physical time (ms), logical counter, and node ID into a lexicographically sortable hex string: `{physical_hex}_{counter_hex}_{nodeId}`.
   - `now()` increments locally; `update(remoteHlc)` reconciles remote timestamps to maintain monotonic causality across the cluster.
   - `compare(hlcA, hlcB)` provides total deterministic ordering for Last-Write-Wins (LWW) conflict resolution.

2. **13-State Connection Lifecycle (`SyncStateMachine`)**:
   - `DISCONNECTED` → `DISCOVERED` → `IDENTIFIED` → `CONNECTING` → `CONNECTED` → `AUTHENTICATING` → `AUTHORISED` → `IDLE` ↔ `SYNCING`
   - Terminal/error states: `REVOKED`, `EXPIRED`, `INCOMPATIBLE`, `ERROR`.

3. **Conflict Resolution Registry (`ConflictRegistry`)**:
   - Features register conflict policies in their manifest.
   - Core conflict strategies are evaluated deterministically without human intervention, recording any manual conflicts in `core_sync_conflicts` for inspection.
