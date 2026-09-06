# R-001 — Device Identity Key Custody Spike

**Status:** WINDOWS EVIDENCE COMPLETE; ALGORITHM/POC GATE OPEN
**Date:** 2026-09-05
**Scope:** Windows and Android native device identity used for audit attribution and future signed sync operations.

## Question

How should the platform generate, persist, and use a device signing key without exposing private key material to the webview or ordinary TypeScript runtime, while keeping the protocol algorithm compatible across Windows and Android?

## Current evidence

- The current `identity-core` implementation generates random bytes and labels part of them as an Ed25519 public key. It does not create a keypair, retain a private key, or sign data.
- Native startup now binds the generated public identity to `core_devices`, making the device ID stable across database restarts. This is persistence, not protected key custody.
- Android's official Keystore documentation states that key material does not enter the application process, can be hardware-bound, and can be restricted by purpose and user authentication.
- Android `KeyGenParameterSpec` documents non-exportable private-key operations, key aliases, signing purposes, authentication requirements, StrongBox preference, and security-level inspection.
- Android's documented examples use EC P-256 and ECDSA for asymmetric signing. This does not by itself establish Ed25519 availability in the supported Android matrix.
- Windows CNG documents `NCryptCreatePersistedKey` for provider-managed persisted
  keys, `NCryptFinalizeKey` for completing them, and `NCryptSignHash` for signing
  without exporting private key material. The API supports named current-user
  keys and documents VBS/TPM requirements for stronger protection flags.
- Windows CNG algorithm and signature compatibility with the Android choice has
  not yet been proven in a two-platform spike.

## Constraints

- Private key material must never cross the Tauri/webview boundary.
- `core_devices.public_key` must be sufficient for peer registration and signature verification; it must not be treated as private-key storage.
- The provider must distinguish generated, loaded, revoked, rotated, and unavailable states.
- Android and Windows implementations may use different native custody APIs, but the protocol must have an explicit algorithm/key-format negotiation policy.
- The provider must expose signing as an operation, not as a private-key export method.
- Tests must prove restart stability, wrong-key rejection, revocation behavior, and no private-key serialization.

## Alternatives

1. **Application-managed Ed25519 keypair**
   - Simple Rust implementation and consistent protocol format.
   - Fails the protected-custody requirement unless the private key is itself wrapped by a platform provider.

2. **Platform-native signer abstraction**
   - Windows and Android keep private keys in their native providers; Rust receives public metadata and asks the provider to sign bytes.
   - Requires native Tauri/mobile integration and protocol algorithm negotiation.
   - Best fit for the stated custody requirement.

3. **Platform-native EC P-256 everywhere**
   - Android has documented Keystore support and signing examples.
   - Windows CNG provides persisted provider-managed key and signing APIs, but
     the exact algorithm/provider configuration still needs a proof of concept.
   - Requires changing any protocol assumptions that currently name Ed25519.
   - Must not be selected until handshake and key-format compatibility are specified.

## Recommendation

Adopt a `DeviceKeyProvider` abstraction with these operations:

- `load_or_create(application_id, platform) -> PublicDeviceIdentity`;
- `sign(key_id, canonical_bytes) -> Signature`; and
- `revoke(key_id) -> result`.

The abstraction must never return private key bytes. Keep the current SQLite binding as metadata only. Select the concrete algorithm after the Windows provider spike and a two-platform signature verification test. Do not label the current random placeholder as a cryptographic public key.

## Smallest proof of concept

1. Windows native provider: create or open a non-exportable signing key under an application-scoped alias and return public metadata.
2. Android provider: create or open an application-scoped Keystore signing key and report `KeyInfo` security level when available.
3. Native test: sign canonical bytes, verify with the returned public key, restart, sign again, and reject a signature made by a different key.
4. Boundary test: verify no command response, serialized state, log, or JavaScript gateway type contains private key material.

## Acceptance criteria

- Official Windows and Android provider evidence is recorded.
- The algorithm and public-key encoding are explicit and compatible with the sync handshake design.
- Device identity survives app/database restart without regenerating the key.
- Signing works without exporting private material.
- Revoked or unavailable keys fail closed.
- Windows and Android tests run on supported targets, with hardware-backed status reported rather than assumed.
- ADR-019 and the sync protocol specification are updated before production use.

## Sources

- Android Keystore system: https://developer.android.com/privacy-and-security/keystore
- Android `KeyGenParameterSpec`: https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec
- Android key attestation overview: https://developer.android.com/privacy-and-security/security-key-attestation
- Windows `NCryptCreatePersistedKey`: https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/nf-ncrypt-ncryptcreatepersistedkey
- Windows `NCryptFinalizeKey`: https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/nf-ncrypt-ncryptfinalizekey
- Windows `NCryptSignHash`: https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/nf-ncrypt-ncryptsignhash

## Remaining work

- Resolve Ed25519 versus platform-supported EC signing compatibility.
- Implement Windows and Android provider spikes and native signature verification tests.
- Update ADR and protocol documents after review.
