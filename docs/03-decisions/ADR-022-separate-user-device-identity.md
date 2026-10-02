# ADR-022: Separation of User, Device, and Session Identity

## Status

Accepted

## Context

In client-side and field applications, physical devices (e.g. shared tablets, warehouse terminals) may host multiple user accounts. Conflating user credentials with device network keys introduces security risks: logging out of a user account should not destroy device network pairing, nor should a user's password recover or expose the device's cryptographic transport keys.

## Decision

We strictly decouple the three identity dimensions:

1. **Device Identity (`crates/identity-core`)**:
   - Represents the physical hardware installation and network transport participant.
   - Genuine Ed25519 keypair derived from a 32-byte seed generated with OS cryptographically secure random bytes.
   - Private seed held exclusively in native custody (`device_identity.key` with restricted permissions) and never exposed across IPC or stored in JavaScript.
   - Public key string (`ed25519_pk_<hex>`) bound to `core_devices`.
2. **User Identity (`core_users`)**:
   - Represents the human actor and authority.
   - Verified offline using Argon2id memory-hard password verifiers with a 5-consecutive-failure lockout cooldown window.
3. **Session (`NativeSessionView` & `TrustedOperationContext`)**:
   - Time-bounded binding of an authenticated user, approved device, and specific organisation.
   - Issued exclusively by the native runtime after successful authentication.
   - Callers cannot construct arbitrary operational contexts; all privileged operations require a validated `TrustedOperationContext`.

## Consequences

- Physical device remains enrolled and authorized for replication independently of user session state.
- Invariant #5 (private keys never in JS) is strictly upheld.
- User switching on shared devices does not require re-pairing the device with the sync mesh.
