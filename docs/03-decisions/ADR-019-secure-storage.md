# ADR-019: Secure Key Storage Platform Strategy

**Status**: Accepted  
**Date**: 2026-08-30  
**Authors**: Antigravity Pair Programming

---

## Context

Device identity and signing operations require persisting an Ed25519 private key across application restarts. The private key must be protected against unauthorized extraction and must never be stored in plain text in SQLite or browser storage.

## Options Considered

### Option A: Tauri Stronghold Plugin (`tauri-plugin-stronghold`)

- Encrypted vault abstraction backed by IOTA Stronghold.
- _Pros_: Cross-platform API across Windows and Android.
- _Cons_: Additional binary dependency, requires master password derivation or snapshot management.

### Option B: Platform-Native Secure Enclaves / Keystores (Chosen)

- **Windows**: Windows DPAPI (Data Protection API) / Windows Credential Manager.
- **Android**: Android Keystore (hardware-backed Keystore provider).
- **Rust trait abstraction** (`SecureStorage` in `crates/identity-core`): Provides `store_key`, `retrieve_key`, and `delete_key` with platform-specific native implementations.

## Decision

We adopt **Option B** behind the `SecureStorage` trait in `crates/identity-core`:

1. The private key is encrypted using OS-native cryptographic hardware / DPAPI.
2. The decryption key is managed by the OS security context.
3. Fallback encrypted vault mechanism is maintained for testing environments.

## Consequences

- Hardware-backed key security on modern Android devices (API 35+).
- Seamless native Windows DPAPI encryption with zero external runtime daemon requirements.
- Clean trait boundary allows swapping storage backends without affecting `packages/identity`.
