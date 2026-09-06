# Identity and Secure Storage Implementation Plan

## Current state

The repository has TypeScript identity abstractions and a Rust
identity-core scaffold. The current implementation should be treated as
a placeholder until it generates, persists, signs with and protects a
real cryptographic device identity.

## Target identity model

Each installed application instance has a device identity:

```text
Device
 ├── deviceId
 ├── publicKey
 ├── privateKey (native secure storage only)
 ├── status
 ├── organisation membership
 └── metadata
```

The private key must never enter:

- TypeScript memory;
- browser storage;
- SQLite;
- logs;
- diagnostic exports;
- sync payloads.

## 1. Cryptography

Select and document the exact cryptographic scheme.

The intended direction is Ed25519 or another well-supported signature
scheme with:

- key generation;
- public-key serialization;
- deterministic canonical representation;
- signing;
- verification;
- secure key import/export rules;
- versioning.

Do not fabricate public keys from device IDs.

## 2. Key storage

Windows:

- evaluate DPAPI/Credential Manager and/or an appropriate Rust
  secure-storage implementation;
- define backup/recovery semantics;
- define behaviour after reinstall.

Android:

- use Android Keystore through a supported native integration;
- test API 35+ physical devices;
- document hardware-backed versus software-backed guarantees.

## 3. Identity lifecycle

Define:

```text
FIRST_INSTALL
   ↓
KEY_GENERATED
   ↓
DEVICE_REGISTERED
   ↓
ACTIVE
   ↓
SUSPENDED / REVOKED
```

Identity creation must be idempotent across application restarts.

## 4. Native boundary

Preferred API:

```text
TypeScript:
  getPublicDeviceIdentity()
  sign(data)
  verify(publicKey, data, signature)

Rust:
  secure key retrieval
  signing
  key lifecycle
```

TypeScript receives signatures and public information, never the private
key.

## 5. Pairing

Pairing should establish:

- peer public key;
- device identity;
- organisation context;
- challenge/response proof of private-key possession;
- protocol compatibility;
- membership state;
- expiry/nonce;
- optional administrator approval.

## 6. Security tests

Required:

- identity survives restart;
- generated public key verifies signatures;
- wrong key cannot verify;
- tampered payload fails;
- challenge replay fails;
- expired challenge fails;
- revoked device fails;
- private key never appears in logs;
- private key never appears in SQLite;
- TypeScript APIs cannot retrieve the private key.
