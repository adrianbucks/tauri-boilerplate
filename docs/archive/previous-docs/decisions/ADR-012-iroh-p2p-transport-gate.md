# ADR-012: Peer-to-Peer Replication Transport (iroh Research Gate)

## Status
Accepted (via Research Gate R-002 Resolution)

## Context
The platform requires local-first, decentralized replication across devices without mandatory centralized cloud relay dependencies. The network layer must support direct peer-to-peer communication across NATs, authenticated connections, and relay fallbacks when direct paths are unavailable.

## Decision
1. Adopt **iroh** (v1.2.0 `Endpoint` over QUIC with encrypted DERP relays) as the production peer-to-peer transport layer.
2. Resolve **Research Gate R-002**: Select Option 1 (streaming canonical signed `SyncEnvelope` frames across bidirectional QUIC streams with custom ALPN `tauri-boilerplate-sync/1.0`), rejecting `iroh-docs` because it bypasses the 7-layer sync admission pipeline and cannot couple mutations transactionally with local SQLite tables and audit logs.
3. Expose the native transport to TypeScript through `IrohSyncTransport` implementing the standard `SyncTransport` interface in `@platform/sync`.

## Consequences
- Clean boundary between application replication logic and network packet transport.
- Offline and local-network operation without mandatory cloud dependencies.
- Implementation tracking under Work Package WP-014.
