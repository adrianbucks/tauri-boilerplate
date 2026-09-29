# R-011 - Offline Authentication and Credential Verification

**Status:** VERIFIER PROTOTYPE IMPLEMENTED; INTEGRATION REQUIRES SECURITY REVIEW  
**Scope:** local password authentication; PIN, platform authenticators and
recovery remain separate follow-up slices.

## Question

How should a local user prove identity before the platform issues a trusted
session when the application must continue working without network access?

## Evidence

- OWASP recommends Argon2id for password storage, with a minimum baseline of
  19 MiB memory, two iterations and one degree of parallelism. Work factors
  must be calibrated against the supported device matrix.
- The RustCrypto `argon2` crate supports Argon2id and PHC password-hash
  strings, including random salt generation and verification from the stored
  parameters.
- Tauri documents the webview/Rust boundary as a trust boundary. Commands must
  define and validate the data crossing IPC; frontend reachability is not
  authorization.

Sources:

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [RustCrypto Argon2 documentation](https://docs.rs/argon2/latest/argon2/)
- [Tauri Security](https://v2.tauri.app/security/)

## Recommended design

1. Store a versioned Argon2id PHC verifier for the user. Never store a
   plaintext password, PIN or biometric template.
2. Verify credentials only in the native authentication service. The webview
   may submit a credential over an explicitly scoped command, but it never
   receives the verifier or a reusable authentication token.
3. Use a typed command such as `authenticate_user` with validated claims:
   `userId`, selected organisation and credential. The native service must
   derive the organisation from the user record and reject mismatches.
4. Keep failed-attempt counters, lockout expiry and credential metadata in the
   same local transaction as the authentication decision. Do not log the
   credential, verifier, or raw command payload.
5. Use a bounded lockout policy: count failures per user and device, apply a
   persisted cooldown, reset the counter only after successful verification,
   and provide an administrative/recovery path separate from normal login.
6. Calibrate Argon2id parameters on supported Windows and Android hardware.
   Use the OWASP baseline as the floor, not as a claim that the final device
   parameters are already selected.
7. Issue the session and trusted principal from the native/session boundary
   only after credential verification, active user/device checks, organisation
   validation and lockout checks all pass.

## Data model proposal

Add a new immutable migration rather than editing an applied migration. The
user credential state needs fields equivalent to:

- `credential_verifier` - PHC string, restricted to native service access;
- `credential_algorithm_version` - explicit application format version;
- `failed_authentication_attempts` - integer counter;
- `locked_until` - nullable UTC timestamp;
- `credential_updated_at` - UTC timestamp for rotation and audit decisions.

The exact storage and optional pepper policy remain subject to the secure
storage decision. A pepper must not be stored alongside the database hash; if
selected, it belongs in the native protected key provider and requires a
rotation/recovery policy.

## Security acceptance tests

- Correct credential issues exactly one session and trusted principal.
- Incorrect credentials never issue a session and increment the counter.
- A locked account rejects both correct and incorrect credentials until the
  lockout policy permits another attempt.
- Successful authentication resets the failure counter transactionally.
- Caller-supplied organisation, device or role claims cannot change the
  principal derived from native state.
- Revoked or suspended users/devices cannot authenticate.
- Credential, verifier, session secret and recovery material never appear in
  logs, errors or frontend responses.
- A failed transaction cannot persist a session while losing its lockout
  update, or persist the lockout update while issuing a session.
- Hash parameters are parsed from the PHC record and legacy/unsupported
  algorithms are rejected or explicitly upgraded by policy.
- Authentication latency and memory use are measured on Windows and Android;
  the selected parameters are recorded with the test evidence.

## Decision

The bounded Rust-native Argon2id verifier and internal authentication path are implemented in
`crates/crypto-core`. It hashes to a PHC string, generates salts internally,
enforces a 1 KiB input limit, and fails closed for malformed verifiers. It is
used by native-core to validate active users and devices, derive role-bound
permissions, persist failed-attempt counters and apply a five-failure,
five-minute cooldown. It is not yet the complete application authentication
system: credential provisioning is a native setup API, typed Tauri exposure is
implemented, and session expiry, persistence and recovery remain outstanding.

Do not wire the current
`UserSessionService.createSession()` to credentials yet: it currently accepts
identifiers without proof and must be replaced by the native authentication
operation rather than extended with a cosmetic password parameter.
