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

## Current

- `DeviceIdentityService` stores device records in SQLite.
- `UserSessionService` maintains a process-local `currentSession`.
- Session creation validates local user/device status and loads roles.
- Rust `identity-core` generates random placeholder strings rather than a real Ed25519 keypair.

## Target authentication lifecycle

```text
Credential / platform authenticator
       ↓ proof
Native authentication service
       ↓
Trusted principal
       ↓
Session issued and persisted as required
       ↓
Authorisation derives effective permissions from trusted principal
```

Frontend-provided `userId`, `deviceId`, `organisationId` or roles are **claims to validate**, not proof of identity.

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
