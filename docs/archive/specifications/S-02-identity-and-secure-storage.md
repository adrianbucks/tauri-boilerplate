# S-02 --- Identity and Secure Storage

**Status:** Research required\
**Priority:** P0

## Objective

Implement persistent cryptographic device identity without exposing
private keys to TypeScript.

## Model

```text
Device
  deviceId
  keyId
  publicKey
  algorithm
  createdAt
  status
  revokedAt?
```

Private material remains inside native secure storage.

## Lifecycle

First launch generates and persists a real keypair, records public
metadata and returns only public identity.

Subsequent launches load and verify the existing identity.

Signing uses `identity.sign(message)` while keeping the private key
native.

## Pairing

Bind device identity, organisation, application/protocol version,
nonce/challenge and signed transcript.

## Tests

Restart persistence; real signature verification; no private-key
serialisation; revoked identity rejection; malformed payload rejection;
secure-store unavailable handling; rotation.

## Acceptance criteria

No random identifier may be labelled as an Ed25519 key unless it is a
real keypair generated and verified by the selected cryptographic
implementation.

## Research gate

Select cryptographic and OS secure-storage implementations for Windows
and Android.
