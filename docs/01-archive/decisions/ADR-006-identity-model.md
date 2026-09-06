# ADR-006: Cryptographic Device & User Identity Model

**Status**: Accepted  
**Date**: 2026-08-30  
**Authors**: Antigravity Pair Programming

---

## Context

In a peer-to-peer, local-first system with no central authority at runtime, identity must be verifiable without contacting a central server. We need an identity model that represents devices, users, organisations, and active sessions.

## Decision

1. **Device Identity (Cryptographic)**:
   - On first application launch, Rust generates an **Ed25519** keypair.
   - The private key is placed into secure storage (see [ADR-019](./ADR-019-secure-storage.md)) and never leaves native memory.
   - The public key is base64-encoded and becomes the device's public cryptographic identity.
   - The device is assigned a unique `deviceId` (ULID/UUIDv7).

2. **User Identity (Organisation-Scoped)**:
   - Users belong to an organisation (`organisationId`).
   - User identities are provisioned by an administrator.

3. **Session Model**:
   - A `Session` binds an authenticated `userId`, a `deviceId`, an `organisationId`, and active role bindings.
   - Sessions are validated locally on the device before operations occur.

4. **Peer Handshake**:
   - During P2P pairing and handshake, devices prove possession of their private key by signing a challenge message.

## Consequences

- Zero reliance on central identity servers during offline operation.
- Devices can securely verify peer authenticity over local networks.
- Private keys never leak to frontend memory.
