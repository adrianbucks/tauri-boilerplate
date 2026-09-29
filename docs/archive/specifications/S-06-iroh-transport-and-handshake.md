# S-06 --- iroh Transport and Secure Handshake

**Status:** Research required / protocol spike\
**Priority:** P0

## Objective

Replace simulated transport transitions with authenticated P2P
transport.

## Seven-layer gate

1.  iroh connection
2.  peer identity verification
3.  application handshake
4.  organisation validation
5.  device/user authentication
6.  sync-group authorization
7.  data-scope authorization

No application data crosses the transport before all seven succeed.

## Handshake

Define a canonical signed envelope containing protocol version,
application ID, organisation ID, device ID, public key, nonce, timestamp
and capability information.

Signature verification must cover canonical bytes, not incidental JSON
property ordering.

## Reject

Wrong application/protocol; stale timestamp; invalid signature; replayed
nonce; unknown/revoked device; wrong organisation; unauthorized sync
group; incompatible feature/schema.

## Lifecycle

`Disconnected -> Connecting -> TransportEstablished -> PeerVerified -> HandshakeVerified -> Authorized -> Syncing -> Closing`

## Tests

Signature failure, replay, stale timestamp, revoked device, wrong
organisation, authorization denial, protocol mismatch, reconnect and
relay path.

## Research gate

Implement a protocol spike against the exact pinned iroh version before
replacing the current simulated manager.
