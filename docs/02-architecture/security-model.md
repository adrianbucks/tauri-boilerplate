# Security Model & Threat Architecture

## Current Implementation

**Status**: ✅ Defense-in-depth security model with seven-layer admission verification, append-only audit trail, strict tenant scoping, and comprehensive regression test suites in `tests/security/`.

Implemented across `packages/authorization`, `packages/identity`, `packages/audit`, `crates/identity-core`, and `crates/native-core`.

---

## 1. Threat Model & Environmental Assumptions

We operate under an adversarial threat model:

1. **Frontend Compromise**: The JavaScript webview context may be vulnerable to XSS or malicious third-party dependencies. Untrusted UI inputs and states must never be assumed authentic.
2. **Physical/Local Database Access**: The local SQLite database file may be copied or inspected. Sensitive cryptographic secrets must not be stored in cleartext SQLite.
3. **Malicious or Stale Peers**: P2P network peers may present expired certificates, altered clocks, or forge message payloads.
4. **Hostile Network Environment**: Public LANs and internet relay connections are subject to eavesdropping, packet replay, and man-in-the-middle attempts.
5. **Revocation Latency**: Devices or users may be revoked while operating offline.
6. **Accidental Boundary Erosion**: Future developer or AI contributions may inadvertently omit tenant filters or bypass authorization gates.

> **Boundary Disclaimer**: As a client application platform, full OS compromise or kernel-level tampering is outside the scope of software-level application controls.

---

## 2. Seven-Layer Admission Model

> **Core Security Invariant #4**: *A peer being reachable does not mean it is authorised.* Never allow the sync layer to become the security layer.

Every incoming synchronization request must successfully pass **all 7 layers** in order before any application data is ingested or exchanged:

```
[Layer 1: Network Transport]
       │ iroh QUIC over TLS 1.3 with ALPN validation
       ▼
[Layer 2: Protocol Handshake]
       │ Envelope schema validation & version compatibility
       ▼
[Layer 3: Device Identity Verification]
       │ Ed25519 signature proof against known device public key
       ▼
[Layer 4: Device Admission Status]
       │ Verify device state is ACTIVE (not SUSPENDED or REVOKED)
       ▼
[Layer 5: Organisation Isolation]
       │ Mutual tenant boundary check (both peers belong to target organisation)
       ▼
[Layer 6: Sync Group Authorization]
       │ Membership check in the specific Sync Group governing the namespace
       ▼
[Layer 7: Entity Authorization & Permissions]
       │ Authorization engine evaluates principal permissions for the operation
```

If any single layer check fails, the stream is rejected, the connection is terminated, and a `SECURITY_REJECTION` audit event is logged.

---

## 3. Trust Boundaries

```text
Untrusted UI Input (React)
       ↓
Validated Application Request (Zod / Schema)
       ↓
Trusted Native Principal (NativeSessionStore via Argon2id)
       ↓
Central Authorization Gate (requireTrusted with Tenant Scope)
       ↓
Platform Repository Layer (Drizzle with mandatory organisationId)
       ↓
Native Storage Gateway (Bundled SQLite WAL + SQL Safety Guard)
```

---

## 4. Audit Architecture (`@platform/audit`)

Audit logging provides non-repudiation and traceability for sensitive operations.

### Properties

- **Strictly Append-Only**: The `core_audit_events` table permits only `INSERT` queries. `UPDATE` and `DELETE` operations are blocked by repository design and database triggers.
- **Mandatory Correlation**: Every audit record carries a `correlationId` tracking operations across service boundaries.
- **Zero Credential Exposure**: Passwords, private keys, session tokens, and raw encryption payloads are strictly forbidden from audit payloads.

```typescript
// packages/audit/src/types.ts
export interface AuditEvent {
  readonly id: string;
  readonly eventType: AuditEventType;
  readonly userId: string | null; // null for pre-login device actions
  readonly deviceId: string;
  readonly organisationId: string;
  readonly correlationId: string;
  readonly timestamp: string; // ISO-8601 UTC
  readonly metadata: Record<string, unknown>;
}
```

### Event Catalogue

```text
Identity & Auth:     USER_CREATED, USER_UPDATED, USER_SUSPENDED, USER_REVOKED,
                     SESSION_ESTABLISHED, SESSION_INVALIDATED,
                     DEVICE_REGISTERED, DEVICE_APPROVED, DEVICE_REVOKED
Tenancy & Roles:     ORGANISATION_CREATED, ROLE_ASSIGNED, ROLE_REVOKED,
                     MEMBERSHIP_REQUESTED, MEMBERSHIP_APPROVED
Sync & P2P:          SYNC_GROUP_CREATED, SYNC_GROUP_MEMBER_ADDED,
                     HANDSHAKE_ESTABLISHED, REVOCATION_PROPAGATED,
                     CONFLICT_DETECTED, CONFLICT_RESOLVED
Security Boundary:   SECURITY_REJECTION, UNAUTHORIZED_ACCESS_ATTEMPT
Data Lifecycle:      RECORD_CREATED, RECORD_UPDATED, RECORD_DELETED,
                     IMPORT_STARTED, IMPORT_COMPLETED, EXPORT_CREATED
```

---

## 5. Revocation Propagation

When an administrator revokes a device or user:

1. **Immediate Local Application**: The revoking node updates local SQLite, marking the entity `REVOKED`. Active sessions for that entity are immediately purged.
2. **Active Peer Disconnection**: Active P2P connections to the revoked peer receive a `PeerRevocationNotice` envelope and are closed immediately.
3. **Offline Reconnect Rejection**: When an offline peer reconnects, handshake exchange Layer 4 inspects the revocation list and denies connection.
4. **Local Tombstone Retention**: Revocation records are permanent and never deleted from the local database.

---

## 6. Data Classification Matrix

| Classification | Definition | Replication Rule | Local Storage |
| :--- | :--- | :--- | :--- |
| `PUBLIC` | Metadata, public organization details | Unrestricted to authenticated peers | SQLite standard |
| `INTERNAL` | Business entities, inventory, widgets | Scoped to authorized Sync Groups | SQLite standard |
| `CONFIDENTIAL`| Audit logs, user profiles, permissions | Scoped to administrative Sync Groups | SQLite standard |
| `RESTRICTED` | Cryptographic keys, credentials | **NEVER SYNCHRONIZED** | Native Rust memory / OS secure storage |

---

## 7. Security Regression Test Suite

All security-critical invariants are verified by automated regression tests in `tests/security/`:

```text
tests/security/
├── rbac-security.test.ts               # Role permissions, scope enforcement, cross-tenant rejection
├── device-pairing-security.test.ts     # Handshake signing, device admission, spoofed ID rejection
└── tauri-capability-governance.test.ts # Capabilities validation, window matching, no wildcard permissions
```

> **Mandatory Rule (Invariant #9)**: Every security-related change or fix must include an accompanying negative test in `tests/security/` that verifies unauthorized attempts fail deterministically.
