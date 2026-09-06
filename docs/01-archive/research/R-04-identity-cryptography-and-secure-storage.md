# R-04 --- Identity, Cryptography and Secure Storage

## Critical current issue

The existing native identity code generates random bytes and labels
portions as an Ed25519 public key. It does not generate a real Ed25519
keypair or persist the identity.

## Required properties

A production device identity needs:

- cryptographically secure key generation
- real signing keypair
- stable persistence across restarts
- OS-protected private-key storage
- public-key metadata in SQLite
- key identifier/version
- revocation state
- rotation policy
- signing without returning private material to the frontend

## Pairing

Pairing must bind device identity, organisation, protocol/application
context, nonce/challenge and a signed transcript. Device ID alone is not
proof of identity.

## Sources

- https://owasp.org/www-project-application-security-verification-standard/
- https://github.com/RustCrypto
- https://v2.tauri.app/security/

## Research gate

Select the exact cryptographic crate and secure-storage implementation
for Windows and Android and validate maintenance/platform support.
