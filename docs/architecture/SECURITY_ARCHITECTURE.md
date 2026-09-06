# Security Architecture

## Threat model

Assume:

- frontend JavaScript may be compromised;
- a local database may be copied;
- a user may leave a shared device unlocked;
- peers may be malicious or stale;
- credentials may be guessed offline;
- network connectivity is hostile/unreliable;
- a previously authorised device may later be revoked;
- malformed files/protocol messages may be supplied;
- AI-generated code may accidentally weaken a boundary.

This is a client-side application platform; OS compromise and a fully compromised device are outside the guarantees of application-level controls and must be stated explicitly in product security documentation.

## Trust boundaries

```text
Untrusted UI input
      ↓
validated application request
      ↓
trusted native/session principal
      ↓
authorization + tenant scope
      ↓
platform service
      ↓
native gateway
      ├── SQLite
      ├── OS key store
      └── network transport
```

## Tauri security

Tauri's security model relies on capabilities/permissions to restrict which commands a webview can access. A capability is a boundary, not merely configuration decoration.

Rules:

- every native command has a clear security owner;
- capability files grant only required permissions;
- sensitive commands require explicit permission entries;
- commands validate inputs again in Rust/native code;
- arbitrary SQL/file paths/shell execution are never exposed to the frontend;
- multiple windows/webviews should receive separate capabilities when their authority differs;
- CSP allowances are minimised and justified.

The current `default.json` grants `core:default` only. Preserve this narrow posture as native functionality expands.

## Data protection

Classify data before selecting storage/replication policy:

- PUBLIC;
- INTERNAL;
- CONFIDENTIAL;
- RESTRICTED/SENSITIVE.

Private keys, credentials and authentication secrets are not ordinary application data and must use dedicated native protected storage.

Sensitive local data protection and key custody must be evaluated against current platform capabilities. OWASP's mobile storage guidance explicitly treats secure storage and preventing leakage as separate requirements.

## Authorization rules

Never:

```ts
if (user.role === "admin") { ... }
```

Never trust:

```ts
ctx = { userId: request.userId, organisationId: request.organisationId };
```

Prefer:

```text
principal = trustedSession.principal()
authorization.require(principal, permission, resourceScope)
```

Tenant scope must be mandatory for tenant-owned reads and writes.

## Audit vs logs

- **Audit events** record business/security actions and attribution.
- **Diagnostics** record operational state and performance.
- **Debug logs** assist development.

Do not use debug logs as the audit trail. Never log credentials, private keys, raw authentication tokens or unnecessary sensitive payloads.

## Security regression policy

Every security fix must add a negative test that would fail if the security check were removed.

High-risk changes require review before merge:

- cryptography/key custody;
- authentication/session issuance;
- authorization/tenant filtering;
- Tauri capabilities/native commands;
- sync admission/handshake;
- migrations affecting security state;
- release signing.
