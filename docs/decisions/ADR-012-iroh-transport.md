# ADR-012: iroh Peer-to-Peer Networking Transport

**Status**: Accepted  
**Date**: 2026-08-30  
**Authors**: Antigravity Pair Programming

---

## Context

Local-first business applications need to discover and synchronize data directly between devices on local area networks (LANs) and across wide area networks (WANs) without mandating a central sync server.

## Options Considered

### Option A: Custom WebSocket / WebRTC Mesh

- Direct browser WebRTC or local WebSocket servers.
- _Downsides_: High complexity for NAT traversal, signaling server requirement, connection instability across network interface changes.

### Option B: libp2p

- Extensive P2P networking stack.
- _Downsides_: Heavyweight footprint, high configuration complexity, slow startup times on mobile.

### Option C: iroh (n0-computer) (Chosen)

- Built in Rust using QUIC (via `quinn`).
- Direct peer addressing via Ed25519 public keys (Node IDs).
- Automatic hole-punching for NAT traversal and DERP relay fallback when direct connections fail.
- Excellent connection migration support across WiFi/cellular transitions.
- Lean binary size and active maintenance.

## Decision

We adopt **iroh** as the primary networking transport layer in `crates/sync-core`:

1. Every device runs an embedded iroh endpoint identified by its `NodeId`.
2. Local discovery uses mDNS; global discovery uses relay nodes.
3. Transport layer remains completely decoupled from authorisation and replication policies.

## Consequences

- Direct, encrypted, high-performance QUIC communication between Windows and Android devices.
- Seamless fallback to relay servers when devices are behind strict NATs.
