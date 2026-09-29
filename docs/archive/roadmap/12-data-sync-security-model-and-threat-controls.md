# Data, Sync and Security Threat-Control Plan

## Objective

Turn the documented seven-layer security concept into enforceable
controls.

## Seven layers

```text
1. Transport
2. Peer cryptographic identity
3. Application/protocol handshake
4. Organisation isolation
5. Device/user authentication
6. Sync-group authorization
7. Data-scope authorization
```

## Layer 1 --- Transport

Control:

- authenticated iroh connection;
- direct/relay mode;
- connection lifecycle;
- transport encryption.

## Layer 2 --- Peer identity

Control:

- public key lookup;
- signature verification;
- proof of private-key possession;
- device status.

## Layer 3 --- Handshake

Control:

- application ID;
- protocol version;
- supported features;
- nonce/challenge;
- timestamp/expiry;
- canonical encoding.

## Layer 4 --- Organisation

Control:

- peer membership;
- cross-organisation grants if ever supported;
- tenant-scoped queries.

Default policy should be deny.

## Layer 5 --- Device/user

Control:

- active device;
- active user session;
- membership;
- revocation.

## Layer 6 --- Sync group

Control:

- approved membership;
- target sync group;
- device scope;
- membership expiry/revocation.

## Layer 7 --- Data scope

Control:

- namespace;
- feature;
- entity type;
- resource scope;
- payload schema.

## Threats to explicitly test

- forged device identity;
- stolen device identifier;
- modified operation payload;
- replayed operation;
- duplicate operation;
- cross-tenant operation;
- unauthorized sync group;
- unauthorized namespace;
- revoked peer reconnect;
- stale peer receiving future data;
- tombstone resurrection;
- schema downgrade;
- protocol downgrade;
- oversized/malformed payload;
- malicious migration;
- log secret leakage.

## Security principle

The sync transport is not the authorization layer.

A successful network connection only establishes a communication
channel. It does not establish permission to exchange application data.
