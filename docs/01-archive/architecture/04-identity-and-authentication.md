# 07 — Identity and Authentication

| | |
| **Current** | TypeScript device/session services, in-memory invalidation, and a Tauri command that returns public identity fields. `crates/identity-core` uses placeholder random IDs, not Ed25519 or OS secure storage. |
| **Target** | Device keypairs in Rust + OS secure storage; TypeScript receives only public identity; sessions bound to user, device, organisation, and membership. |
| **Remaining** | [S-02](../specifications/S-02-identity-and-secure-storage.md), [S-03](../specifications/S-03-authentication-session-and-tenancy.md), [R-04](../research/R-04-identity-cryptography-and-secure-storage.md). |

Interfaces below are the identity contract to implement. Do not describe placeholder identifiers as cryptographic identity.

## Scope

This document covers:

- Device identity (cryptographic, established at first launch)
- User identity (organisation-scoped, provisioned by admin)
- Session model (device + user + organisation binding)
- Secure key storage (research-dependent — see ADR-019)
- Authentication design options (not yet decided — documented here for future design work)

---

## Identity package: `packages/identity`

```
packages/identity/src/          ← current
├── index.ts
├── types.ts
├── device/
│   └── DeviceIdentityService.ts
└── user/
    └── UserSessionService.ts
```

Target modules such as a dedicated first-launch initialisation flow remain to be extracted once real key generation exists.

### Identity interfaces

```typescript
// packages/identity/src/types.ts

interface DeviceIdentity {
  deviceId: string; // Stable ID — generated at first launch
  publicKey: string; // Base64-encoded public key
  platform: "windows" | "android";
  applicationId: string; // Which application this device belongs to
  registeredAt: string; // UTC ISO-8601
}

interface UserIdentity {
  userId: string;
  organisationId: string;
  displayName: string;
  status: "ACTIVE" | "SUSPENDED" | "REVOKED";
}

interface Session {
  sessionId: string;
  userId: string;
  deviceId: string;
  organisationId: string;
  roles: string[]; // Role IDs (permissions resolved separately)
  establishedAt: string; // UTC ISO-8601
  expiresAt: string | null; // null = no expiry (administrator session)
}
```

**Rule**: TypeScript code only ever receives `DeviceIdentity` and `UserIdentity` objects. Private keys are never present in TypeScript memory.

---

## Device identity lifecycle

### First launch

```
Application starts
    ↓
Check: does core_devices contain this device?
    ↓ No
Generate Ed25519 key pair (in Rust — crates/identity-core)
    ↓
Store private key in secure storage (per ADR-019)
    ↓
Store DeviceIdentity record in core_devices (public key, platform, applicationId)
    ↓
Device status = UNREGISTERED (awaiting admin approval)
    ↓
Display pairing/registration screen in UI
```

### Subsequent launches

```
Application starts
    ↓
Load DeviceIdentity from core_devices
    ↓
Verify private key accessible in secure storage
    ↓
If key missing: error — device recovery flow required
    ↓
Continue to login screen
```

### Device status transitions

```
UNREGISTERED → PENDING_APPROVAL (after membership request submitted)
PENDING_APPROVAL → APPROVED (after admin decision)
APPROVED → ACTIVE (after first successful sync session)
ACTIVE → SUSPENDED (admin action)
SUSPENDED → ACTIVE (admin action)
ACTIVE → REVOKED (admin action — permanent)
SUSPENDED → REVOKED (admin action — permanent)
```

A REVOKED device may continue to operate locally (reads, writes) per the offline availability policy, but cannot establish new authorised sync sessions.

---

## `crates/identity-core`

```rust
// crates/identity-core/src/lib.rs

pub struct DeviceKeyPair {
    private_key: SigningKey,  // Ed25519 — never serialised to TypeScript
    public_key: VerifyingKey,
}

pub trait SecureStorage: Send + Sync {
    fn store_key(&self, id: &str, key: &[u8]) -> Result<(), IdentityError>;
    fn retrieve_key(&self, id: &str) -> Result<Vec<u8>, IdentityError>;
    fn delete_key(&self, id: &str) -> Result<(), IdentityError>;
}

// Implementations behind this trait (one per platform, selected at compile time or runtime)
struct StrongholdStorage { ... }    // If ADR-019 chooses Stronghold
struct DpapiStorage { ... }         // Windows DPAPI
struct KeystoreStorage { ... }      // Android Keystore
```

The `SecureStorage` trait is the abstraction point. Platform selection is tracked in [ADR-019](../decisions/ADR-019-secure-storage.md) and [R-04](../research/R-04-identity-cryptography-and-secure-storage.md); it is not implemented.

---

## Secure key storage research (RESEARCH REQUIRED)

**See**: [R-04](../research/R-04-identity-cryptography-and-secure-storage.md) and ADR-019.

**Options to evaluate**:

| Option                             | Platform       | Notes                                                             |
| ---------------------------------- | -------------- | ----------------------------------------------------------------- |
| Tauri Stronghold                   | Cross-platform | Vault-like encrypted storage; research current maintenance status |
| Windows DPAPI / Credential Manager | Windows only   | OS-native, no external dependency                                 |
| Android Keystore                   | Android only   | Hardware-backed on modern devices; accessible from Rust via JNI   |
| Encrypted file                     | Cross-platform | Fallback if others are not viable; key derivation needed          |

**Requirements for the chosen solution**:

- Private key never surfaces in a process accessible to TypeScript
- Key survives application updates (not cleared on reinstall unless intentionally)
- Works on Windows 10 22H2+ and Android API 35+
- Usable from Rust without requiring a full JVM bridge on Windows
- Evaluated with a current spike and recorded in ADR-019 before implementation (not complete)

**What must never happen**:

- Store private keys in `localStorage`, `sessionStorage`, or any web storage
- Store private keys in SQLite (even in an encrypted column)
- Log private keys at any log level
- Return private key material from any Tauri command

---

## User identity and authentication

### Current design state

The architecture does not yet define a central authentication provider. This is a deliberate deferred decision.

**Open design questions** (resolve before Phase 2 production auth):

1. Who creates a user record? (Admin provisioning? Self-registration?)
2. Who proves their identity at login? (Password? Device-bound credential? Passkey?)
3. How does a new device become associated with an existing user?
4. What happens when a user changes device?
5. What happens when a device is lost — can the user recover without an admin?

### Possible future authentication models

These are candidates, not decisions:

| Model                             | Notes                                                                   |
| --------------------------------- | ----------------------------------------------------------------------- |
| Organisation-issued credentials   | Admin creates user + initial credential; simple, no external dependency |
| Invitation + device pairing       | Link is sent, device pairs, identity established from device keypair    |
| External identity provider (OIDC) | Suitable if customers have existing IdP infrastructure                  |
| Passkeys (WebAuthn)               | Modern, phishing-resistant; evaluate Tauri WebAuthn support             |
| Device-bound credentials          | Credential tied to device keypair — no separate password                |
| Hybrid                            | Device keypair as primary + admin-issued credential as backup           |

### Phase 2 development approach

Phase 2 uses **administrator-issued credentials** as a development placeholder:

- Admin creates user record in the database
- Admin issues an initial session token (or PIN) to the user
- User presents the token on their device to establish a session
- This is documented as a development limitation — not a production authentication design
- Production auth model is decided before the boilerplate is marked "production-ready"

This allows the RBAC, sync groups, and platform infrastructure to be developed and tested without blocking on the auth decision.

---

## Cryptographic approval of administrative decisions

Administrative decisions (approve device, revoke device, grant role) should eventually be signed by the admin's key.

**Future signed decision structure**:

```typescript
interface MembershipDecision {
  requestId: string;
  userId: string;
  deviceId: string;
  organisationId: string;
  groups: string[];
  role: string;
  decision: "APPROVED" | "REJECTED";
  timestamp: string;
  approverId: string;
  signature: string; // Admin signs this structure with their private key
}
```

**Phase 2 scope**: Record the decision in the database without the signature field. Signature is added in a later phase when the admin key model is designed.

**RESEARCH REQUIRED** — see [R-04](../research/R-04-identity-cryptography-and-secure-storage.md):

- Signing key ownership (who holds the admin signing key?)
- Key rotation (how are admin keys rotated safely?)
- Administrator succession (what if the admin device is lost?)
- Offline validation (can peers validate a signed decision without contacting a server?)
- Compromised admin recovery

---

## Session management

A session binds a user to a device within an organisation:

```typescript
interface Session {
  sessionId: string;
  userId: string;
  deviceId: string;
  organisationId: string;
  roles: string[];
  establishedAt: string;
  expiresAt: string | null;
}
```

Sessions are established locally when:

- The user presents valid credentials on an approved device
- The device is ACTIVE in the relevant sync group

Sessions are invalidated when:

- The device is revoked (immediate local invalidation)
- The user is suspended
- The session expires (if expiry is configured)
- The user explicitly signs out

Session state is held in Rust memory and in the local SQLite `core_sessions` table (if persistent sessions are required). Sessions are never transmitted to peers.

## Current implementation status

`packages/identity` currently implements public identity/session types, device registration, device status checks, organisation matching, persisted role lookup during session creation, expiry checks, and in-memory invalidation. `crates/identity-core` currently returns placeholder random identifiers and public-key-shaped strings; it does not implement Ed25519 keypairs or secure storage. The Tauri identity command returns public identity data but identity persistence, recovery, durable sessions, and a production authentication provider are absent.

Keep private-key isolation, immutable device identity, explicit revocation, organisation binding, and recovery design as hard requirements. Do not describe the current placeholder identity as cryptographic identity.
