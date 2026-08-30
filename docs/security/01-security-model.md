# 16 — Security Model

---

## Core security principle

> Never allow the sync layer to become the security layer by accident.

The sync engine answers: "How can these peers exchange data?"  
The authorisation system answers: "Are these peers allowed to exchange this data?"  
These are separate systems. The sync engine is given only a list of authorised namespaces — it cannot request or receive data outside those namespaces.

---

## Tauri command security boundary

Every Tauri command is a potential attack surface if the webview is compromised.

Before merging any Tauri command, answer all of the following:

| Question                                          | Acceptable answer                                              |
| ------------------------------------------------- | -------------------------------------------------------------- |
| Who can call this command?                        | Named and minimal — not "anyone with access to the webview"    |
| What data can it access?                          | Scoped — not the entire database                               |
| Does it require a valid session?                  | Yes, unless it is an explicit pre-auth bootstrap command       |
| Does it access the filesystem?                    | Only through narrowly scoped capability grants                 |
| Does it expose secrets?                           | Never — private keys, credentials, tokens must not be returned |
| Can it be called by an untrusted webview context? | Must be evaluated explicitly for each command                  |

Commands that handle sensitive operations (key management, approval signing, device registration) must include additional validation and must not be exposed more broadly than necessary.

All capability grants in `tauri.conf.json` and in `capabilities/*.json` must be narrowly scoped. No `allow-all` grants. Every capability grant should have a comment explaining why it is needed.

---

## Capability scoping examples

```json
// capabilities/filesystem.json — only allow import file picker and export save
{
  "identifier": "import-export",
  "windows": ["main"],
  "permissions": ["fs:allow-read-text-file", "dialog:allow-open"]
}
```

```json
// capabilities/default.json — minimal base capability
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

No single capability file should grant everything. Group capabilities by feature area.

---

## Audit architecture

### Package: `packages/audit`

All audit events are append-only. No update or delete operation is allowed on `core_audit_events`.

```typescript
interface AuditEvent {
  id: string;
  eventType: AuditEventType;
  userId: string | null; // null for device-only actions pre-login
  deviceId: string;
  organisationId: string;
  correlationId: string;
  timestamp: string; // UTC ISO-8601
  metadata: Record<string, unknown>; // Event-specific structured data
}
```

### Minimum event catalogue

```
USER_CREATED          USER_UPDATED          USER_SUSPENDED        USER_REVOKED
ROLE_ASSIGNED         ROLE_REVOKED
DEVICE_REGISTERED     DEVICE_APPROVED       DEVICE_SUSPENDED      DEVICE_REVOKED
SYNC_GROUP_CREATED    SYNC_GROUP_UPDATED
SYNC_GROUP_MEMBER_ADDED   SYNC_GROUP_MEMBER_REMOVED
MEMBERSHIP_REQUESTED  MEMBERSHIP_APPROVED   MEMBERSHIP_REJECTED
ORGANISATION_CREATED  ORGANISATION_UPDATED
SESSION_ESTABLISHED   SESSION_INVALIDATED
IMPORT_STARTED        IMPORT_COMPLETED      IMPORT_FAILED
EXPORT_CREATED
RECORD_CREATED        RECORD_UPDATED        RECORD_DELETED
CONFLICT_DETECTED     CONFLICT_RESOLVED
REVOCATION_PROPAGATED
SECURITY_REJECTION    ← failed authorisation attempt (throttle before logging to prevent flood)
```

### Audit event protection

Audit events are protected at the database level:

- No `UPDATE` or `DELETE` SQL is allowed on `core_audit_events` from any application code
- The repository for audit events exposes only `emit()` — no update or delete methods
- Future hardening: cryptographic hash chaining between events (not in Phase 2 — design the extension point now)

### RESEARCH REQUIRED — audit event synchronisation

Decide before Phase 3:

1. Are audit events synchronised as normal entities across peers?
2. Are audit events cryptographically chained (each event signs the previous hash)?
3. Are audit events signed individually by the generating device?
4. Are audit events stored only in a local append-only log?
5. Is there a future compliance export path?

Do not over-engineer the first release. Design the abstraction now; choose implementation in the ADR.

---

## Cryptographic identity and signing

### Device signing

Every device generates an Ed25519 key pair at first launch (see doc 07). The private key is stored in OS-native secure storage — never in SQLite, never in JavaScript memory.

Signing is used for:

- Device identity proof during handshake
- Eventually: administrative approval signatures

### Administrative decision signing (future)

Administrative decisions (approve device, revoke device, grant role) should be signed by the admin's private key. This provides:

- Non-repudiation — the admin cannot deny issuing the decision
- Offline validation — any peer can verify the signature without contacting a server

**Phase 2 scope**: Record decisions unsigned. Add signing infrastructure in a later phase once the admin key model is designed.

**Design questions for ADR-011**:

- Does the admin have a separate signing key from their device key?
- How is the admin's signing key provisioned and protected?
- How is the admin's key rotated?
- What happens if the admin's device is lost — who can re-issue keys?
- How do peers validate a signature if they have never connected to the admin's device?

---

## Data classification

An optional classification system for future use. Do not implement the full framework in Phase 1 — build the extension point.

```typescript
type DataClassification = "PUBLIC" | "INTERNAL" | "RESTRICTED" | "CONFIDENTIAL";
```

Classification can influence:

- Which sync groups are eligible to receive the data
- Whether export permission is required
- Whether the entity requires enhanced audit logging
- Whether the entity requires encryption at rest

In Phase 1, add a `data_classification` column as nullable to all synchronisable entity tables. Leave it as a metadata field — no policy enforcement until the classification framework is designed.

---

## Privacy principles

The sync policy is explicit about every data class. Sync must never include:

- Private keys or credentials
- Diagnostic-only device data (telemetry, hardware info)
- Data that has not been explicitly classified as synchronisable
- Organisational data that the receiving sync group is not authorised to see

Data minimisation: do not synchronise fields that are not needed by the peer. The sync payload for each operation should contain only the fields relevant to the peer's role.

---

## Revocation propagation

When a device is revoked:

1. **Immediate local effect**: The revoking admin's device marks the device as REVOKED in local SQLite. No new sync sessions are established from this device's perspective.

2. **Propagation to connected peers**: If the revoked device is currently connected to any peer, that peer is notified immediately and terminates the session.

3. **Propagation to offline peers**: When an offline peer reconnects, the revocation is included in the first data exchange. The peer reads the REVOKED status and refuses to continue the session.

4. **Revoked device local behaviour**: The revoked device continues to operate locally (reads, writes to local SQLite) per the offline availability policy. It cannot establish new authorised sync sessions. The UI displays a clear "Device revoked — contact your administrator" message.

**RESEARCH REQUIRED** — see R-005 in doc 17: design offline revocation and membership lease model before Phase 3.

---

## Security test contract

Every change to the security model must:

1. Add or update a test in `tests/security/` (see doc 14)
2. Never remove an existing security test
3. Add a `### Security` entry to CHANGELOG.md for the release

If a security vulnerability is fixed, it must be logged as a security advisory in GitHub in addition to the changelog entry.

---

## Supply chain security

- All dependencies use pinned versions in lockfiles (`pnpm-lock.yaml`, `Cargo.lock`)
- GitHub Actions steps reference specific commit SHAs for third-party actions, not tags (tags are mutable)
- Dependabot or Renovate monitors dependency updates (see doc 15)
- `cargo deny` or `cargo audit` runs in CI to catch known CVEs in Rust dependencies
- `pnpm audit` runs in CI to catch known CVEs in npm dependencies
- Release artefacts include SHA256 checksums

**RESEARCH REQUIRED** — see R-015 in doc 17: finalise the supply chain security toolchain choice.
