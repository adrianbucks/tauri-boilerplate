# ADR-012: Peer-to-Peer Replication Transport (iroh Architecture & Research Gate)

**Status**: Accepted (Implemented & Verified)  
**Date**: 2026-08-30 (Updated 2026-09-28)  
**Authors**: Antigravity Pair Programming

---

## Context

Local-first business applications need to discover and synchronize data directly between devices on local area networks (LANs) and across wide area networks (WANs) without mandating a central sync server. The network layer must support direct peer-to-peer communication across NATs, authenticated connections, and relay fallbacks when direct paths are unavailable.

---

## Options Considered

### Option A: Custom WebSocket / WebRTC Mesh

- Direct browser WebRTC or local WebSocket servers.
- **Downsides**: High complexity for NAT traversal, signaling server requirement, connection instability across network interface changes.

### Option B: libp2p

- Extensive P2P networking stack.
- **Downsides**: Heavyweight footprint, high configuration complexity, slow startup times on mobile.

### Option C: iroh (n0-computer) (Chosen)

- Built in Rust using QUIC (via `quinn`).
- Direct peer addressing via Ed25519 public keys (`NodeId`).
- Automatic hole-punching for NAT traversal and encrypted DERP relay fallback when direct connections fail.
- Seamless connection migration across WiFi and cellular networks.
- Lean binary size and active ecosystem maintenance.

---

## Research Gate R-002 Resolution

During evaluation of iroh integration modes, two architectural options were considered:

- **Option 1 (Chosen)**: Streaming canonical signed `SyncEnvelope` frames across bidirectional QUIC streams with custom ALPN `tauri-boilerplate-sync/1.0`.
- **Option 2 (Rejected)**: `iroh-docs` (document replication substrate). Rejected because `iroh-docs` operates as an independent document-key store, bypassing the platform's mandatory 7-layer sync admission pipeline, and cannot couple mutations transactionally with local SQLite tables and audit logs.

---

## Decision

1. Adopt **iroh** (v1.2.0 `Endpoint` over QUIC with encrypted DERP relays) as the production peer-to-peer transport layer in `crates/sync-core`.
2. Connect peers using custom ALPN `tauri-boilerplate-sync/1.0` and exchange length-prefixed JSON canonical envelopes with 1-byte mutual acknowledgements.
3. Expose the native transport to TypeScript through `IrohSyncTransport` implementing the standard `SyncTransport` interface in `@platform/sync`.
4. Enforce the 7-layer admission pipeline strictly at the protocol layer before ingesting any received envelope into SQLite.

---

## Consequences

- Direct, encrypted, high-performance QUIC communication between Windows and Android devices.
- Seamless fallback to relay servers when devices are behind strict symmetric NATs.
- Clean boundary between application replication logic and network packet transport.
- Verified by unit tests in `crates/sync-core` and acceptance gate G-12.
