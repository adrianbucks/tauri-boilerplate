# Identity and Authentication

## Identity model

The platform distinguishes:

```text
User identity
   = human/account authority

Device identity
   = physical installation / cryptographic transport participant

Session
   = time-bounded authenticated binding of user + device + organisation

Transport identity
   = cryptographic network endpoint identity (if different from device key)
```

A shared device may contain multiple user profiles, but it remains one device/transport participant.

## Current Implementation

The identity and authentication architecture is implemented across `crates/identity-core`, `crates/native-core`, and `@platform/identity`:

- **Native Cryptographic Device Identity (`DeviceKeyProvider`)**:
  - Genuine Ed25519 32-byte seed generated using OS cryptographically secure random bytes (`rand_core` / `getrandom`).
  - Derived `SigningKey` and `VerifyingKey` with canonical public key string representation (`ed25519_pk_<hex>`).
  - Key seed persisted in platform-protected file storage (`device_identity.key`) with restricted filesystem permissions.
  - Invariant #5 enforced: private keys are held strictly in native Rust custody and never cross the IPC boundary or enter SQLite/JS memory.
  - Native public key bound durably to `core_devices` on startup.

- **Offline Credential Verification & Lockout Protection**:
  - User passwords verified against Argon2id memory-hard verifiers in `core_users.credential_verifier` via native `authenticate_user` IPC command.
  - 5-consecutive-failure lockout window enforced natively via `locked_until` timestamps.
  - Device approval status checked before granting authentication.

- **Session Lifecycle & Trusted Principal**:
  - `UserSessionService.authenticate(request, gateway)` delegates directly to the native boundary.
  - Native verification produces `NativeSessionView`, which maps to an immutable `TrustedOperationContext`.
  - Frontend request contexts cannot select identity or permissions; all authorization derives from this trusted principal.

## Target authentication lifecycle

```text
Credential (Argon2id password) / OS authenticator
       ↓ IPC proof
Native authentication service (`crates/native-core`)
       ↓ Argon2id check, lockout check, device verification
NativeSessionView in native custody
       ↓ mapped across IPC
TrustedOperationContext in TypeScript
       ↓
AuthorizationEngine.requireTrusted(trustedContext, permission, scope)
```

Frontend-provided `userId`, `deviceId`, `organisationId`, or roles are **untrusted inputs to validate**, never proofs of authority.

## Offline authentication

The implementation must define and test:

- password verifier (memory-hard algorithm and calibrated parameters);
- PIN verifier and rate limiting;
- platform authenticator integration where supported;
- retry counters and lockout;
- session lifetime/idle timeout;
- logout and invalidation;
- step-up authentication for sensitive actions;
- credential change;
- account/device recovery;
- device revocation;
- shared-device user switching.

Do not store passwords/PINs plaintext. Do not store biometric templates. Do not use the transport private key as a password-recovery mechanism.

## Key custody

Target abstraction:

```text
KeyProvider
 ├── generate()
 ├── publicIdentity()
 ├── sign(message)
 ├── rotate()
 └── revoke()/destroy()
```

The webview should receive public identity and operation results, not private key material.

The exact Windows and Android implementation is a research gate. The repository must not assume that a platform keystore can satisfy the exact transport-signing semantics until tested against the selected iroh API and supported OS/API matrix.

## Authorisation

Roles are data, not hard-coded branches. Use the central authorization engine:

```text
authorize(principal, permission, resourceScope)
```

Permission evaluation must verify:

1. active user;
2. active/approved device;
3. correct organisation;
4. role-derived permission;
5. resource scope;
6. minimum authentication strength when required.

## Recovery

Recovery is a separate security workflow. Lost/stolen/replaced devices must be revocable and re-enrollable without exposing old private keys or bypassing authorisation.
