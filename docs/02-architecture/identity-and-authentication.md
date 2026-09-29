# Identity & Authentication

## Current Implementation

**Status**: ✅ Production-ready native Ed25519 identity and Argon2id authentication.

Implemented across `crates/identity-core`, `crates/native-core`, and `@platform/identity`:

### Native Cryptographic Device Identity (`DeviceKeyProvider`)

- **Key generation**: Genuine Ed25519 32-byte seed generated using OS cryptographically secure random bytes (`rand_core` / `getrandom`).
- **Key derivation**: `SigningKey` and `VerifyingKey` derived from the seed; canonical public key string: `ed25519_pk_<hex>`.
- **Protected storage**: Seed persisted in `device_identity.key` with restricted filesystem permissions (platform-protected file storage).
- **Invariant #5**: Private keys held strictly in native Rust custody — never cross the IPC boundary, never enter SQLite or JavaScript memory.
- **Device binding**: Native public key bound durably to `core_devices` on startup.

### Offline Credential Verification

- **Password storage**: Argon2id memory-hard password verifiers in `core_users.credential_verifier`.
- **Verification**: Via native `authenticate_user` IPC command — password never crosses IPC boundary in plaintext.
- **Lockout protection**: 5 consecutive failures trigger a lockout cooldown window (`locked_until` timestamp).
- **Device approval**: Device approval status checked before granting authentication.

### Session Lifecycle & Trusted Principal

- `UserSessionService.authenticate(request, gateway)` delegates directly to the native boundary.
- Native verification produces `NativeSessionView` → mapped to immutable `TrustedOperationContext`.
- Frontend request contexts cannot select identity or permissions — all authorization derives from the trusted principal.

### Test evidence

```
cargo test -p identity-core
test result: ok. 4 passed; 0 failed
# Tests: genuine Ed25519 generation, signature rejection by wrong key,
#        restart persistence with protected keyfile,
#        device identity binding survives database restart

cargo test -p native-core -- authenticates_active_user locks_after_repeated_failures
test result: ok. 2 passed; 0 failed

pnpm --filter @tests/security test
test result: 4 test files passed; 30+ passed
```

---

## Identity model

The platform distinguishes three distinct identity concepts:

```
User identity
   = Human account — authenticated by credential (Argon2id password)
   = Scoped to one organisation

Device identity
   = Physical installation / cryptographic transport participant
   = Ed25519 key pair, protected in native storage
   = One device may host multiple user profiles

Session
   = Time-bounded authenticated binding of user + device + organisation
   = Produced exclusively by native authentication
   = Represented as TrustedOperationContext in TypeScript

Transport identity
   = Cryptographic network endpoint identity for iroh QUIC
   = Currently maps to device identity (Ed25519 key)
```

A shared device may contain multiple user profiles, but it remains one device/transport participant.

---

## Authentication flow

```
Credential (Argon2id password)
       ↓ IPC call (authenticate_user)
Native authentication (crates/native-core)
       ↓ Argon2id verify, lockout check, device status check
NativeSessionView in native custody
       ↓ mapped across IPC (no private material crosses)
TrustedOperationContext in TypeScript
       ↓
AuthorizationEngine.requireTrusted(trustedContext, permission, scope)
```

Frontend-provided `userId`, `deviceId`, `organisationId`, or roles are **untrusted inputs to validate**, never proofs of authority.

---

## Key custody

The `DeviceKeyProvider` abstraction in `crates/identity-core`:

```rust
pub trait KeyProvider {
    fn generate() -> Result<Self, IdentityError>;
    fn public_identity(&self) -> &str;   // "ed25519_pk_<hex>"
    fn sign(&self, message: &[u8]) -> Vec<u8>;
    fn rotate(&mut self) -> Result<(), IdentityError>;
    fn revoke(self) -> Result<(), IdentityError>;
}
```

The webview receives only the public identity string and operation results — never private key material.

### Key storage location

```
{app_data_dir}/device_identity.key   ← 32-byte Ed25519 seed
                                         restricted filesystem permissions
                                         never committed to source control
                                         never transmitted over IPC
```

---

## TrustedOperationContext

The `TrustedOperationContext` is the secure subject used by all platform services:

```typescript
// packages/core/src/context/TrustedOperationContext.ts
interface TrustedOperationContext {
  readonly userId: string;
  readonly deviceId: string;
  readonly organisationId: string;
  readonly permissions: readonly string[];
  readonly sessionId: string;
  readonly correlationId: string;
  // This type is opaque — callers cannot construct it directly
}
```

**How it is obtained** (only valid path):

```typescript
// packages/identity/src/UserSessionService.ts
const ctx = await UserSessionService.getTrustedOperationContext(sessionId);
// Throws AuthenticationError if session was not established via native auth
```

**What is forbidden**:

```typescript
// ❌ Caller-constructed context — FORBIDDEN
const ctx = {
  userId: req.body.userId,
  organisationId: req.body.organisationId,
  permissions: ["admin"],
};
```

---

## Session lifecycle

| State | Trigger | Effect |
|---|---|---|
| Created | `authenticate_user` IPC succeeds | `NativeSessionView` created in native; `TrustedOperationContext` created in TS |
| Active | — | All privileged operations require `TrustedOperationContext` |
| Expired | Idle timeout | Session invalidated; re-authentication required |
| Logged out | `logout_user` IPC called | Session cleared in both native and TS |
| Revoked (device) | Admin revokes device | All sessions on that device invalidated |
| Locked | 5 failed auth attempts | `locked_until` timestamp; further attempts rejected until expiry |

### Shared device user switching

One physical device may host multiple local user profiles. Switching users:
1. Calls `logout_user` on the current session.
2. Clears the `TrustedOperationContext` from memory.
3. Returns to the login screen.
4. New user authenticates independently via `authenticate_user`.

Device transport identity (the Ed25519 key) is not affected by user switch.

---

## Native Tauri commands

| Command | Auth required | Purpose |
|---|---|---|
| `authenticate_user` | No (pre-auth) | Verify credential, produce NativeSessionView |
| `logout_user` | Yes | Invalidate session |
| `get_device_identity` | No | Return public key + device ID |
| `get_database_health` | No | Return WAL/FK/integrity status |

Private key operations (signing sync envelopes) happen internally in Rust and results are returned — the key never leaves native custody.

---

## Authorization integration

Roles are data, not hardcoded branches. The authorization engine:

```typescript
// ✅ Correct
await authorization.requireTrusted(
  trustedContext,
  "widgets.delete",
  { organisationId: ctx.organisationId },
);
```

Permission evaluation verifies:
1. Active user account.
2. Active and approved device.
3. Correct organisation scope.
4. Role-derived permission.
5. Resource scope constraints.
6. Minimum authentication strength (where required by policy).

---

## Device recovery

Recovery is a separate security workflow. Lost/stolen/replaced devices must be revocable and re-enrollable without:
- Exposing old private keys.
- Bypassing authorization.
- Allowing resurrection of revoked device identity.

Recovery mechanics: An admin approves a new device binding for the user. The old device key is revoked in `core_devices` and the revocation propagates via the sync layer.

---

## Future considerations

| Item | Status |
|---|---|
| OS platform keystore integration (Windows DPAPI / Android Keystore) | Research gate — see ADR-028 |
| Step-up authentication for sensitive operations | Not yet implemented |
| Credential change flow | Not yet implemented |
| Biometric authentication integration | Future consideration |
| Transport key / device key separation | Evaluated — currently same key |
