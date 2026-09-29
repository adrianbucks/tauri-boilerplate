# Tauri Capability and IPC Governance Matrix

This document defines the capability, permission, and command governance rules for the Tauri desktop and mobile runtime layer. It enforces **Acceptance Gate G-05 (Native Boundary)** and **Invariant #8 (Do not grant broad Tauri capabilities)**.

---

## 1. Capability Scoping Principles

1. **Explicit Window Targeting**: Every capability in `capabilities/*.json` must specify exact target windows (e.g., `["main"]`). Wildcard `["*"]` bindings are strictly prohibited.
2. **Mandatory Security Justification**: Every capability must include a `description` field of at least 20 characters documenting its functional necessity and threat justification.
3. **No Blanket Plugin Sets**: Blanket permissions such as `core:default` or `core:event:default` are prohibited. Permissions must use granular action scopes (e.g., `core:event:allow-listen`, `core:event:allow-unlisten`).
4. **No Dangerous Host Subsystems**: No capability may grant frontend webview access to:
   - File system plugins (`core:fs:*`)
   - Shell / child process execution (`core:shell:*`, `core:process:*`)
   - Native OS dialogs or raw OS primitives unless explicitly sandboxed.

---

## 2. Active Capabilities

| Capability File | Identifier | Target Windows | Granted Permissions | Justification |
| :--- | :--- | :--- | :--- | :--- |
| `capabilities/default.json` | `main-window` | `["main"]` | `core:event:allow-listen`<br>`core:event:allow-unlisten` | Enables the main window to listen for asynchronous replication events (`sync://envelope-received`). Excludes `allow-emit` to prevent webview event spoofing. |

---

## 3. Native IPC Command Inventory and Authority

All native commands registered in `apps/demo/src-tauri/src/lib.rs` are typed, validated, and scoped as follows:

| Command Name | Category | Authority / Validation | Security Boundary Enforcement |
| :--- | :--- | :--- | :--- |
| `get_device_identity` | Identity | Read-only device identity | Returns public device ID and Ed25519 public key. Private keys never leave Rust memory custody. |
| `get_database_health` | Diagnostic | Read-only database health | Returns WAL mode, foreign keys status, and integrity check without exposing raw database handles. |
| `authenticate_user` | Authentication | Credential verification | Argon2id verification with 5-failure lockout cooldown. Issues session token bound to device. |
| `get_current_session` | Session | Read-only session inspection | Returns active `NativeSessionView` with derived permissions. |
| `logout_user` | Session | Session invalidation | Clears active in-memory principal. Does not revoke device identity. |
| `list_widgets` | Domain | Tenant-scoped read | Enforces authenticated session; rejects queries across organisation boundaries. |
| `create_widget` | Domain | Tenant-scoped mutation | Validates input format; scopes entity to principal's organisation. |
| `create_widgets` | Domain | Tenant-scoped batch | Atomic rollback on partial failure; enforces tenant boundary. |
| `list_organisations` | Domain | Tenant-scoped read | Restricted to authorised organisations. |
| `create_organisation` | Domain | Tenant creation | Enforces unique slug/domain; requires valid correlation ID. |
| `db_query` | Database Bridge | Validated prepared query | Validates SQL safety via `validate_safe_sql`. Rejects PRAGMAs, ATTACH, DETACH, VACUUM INTO. |
| `db_execute` | Database Bridge | Validated prepared DML | Validates SQL safety via `validate_safe_sql`. Rejects PRAGMAs, ATTACH, DETACH, VACUUM INTO. |
| `db_transaction` | Database Bridge | Validated transaction | Validates every statement in the batch; rolls back atomically on failure. |
| `sign_message` | Crypto | Native signing | Signs arbitrary payload bytes using protected device key. Private key is never serialized or returned. |
| `verify_message` | Crypto | Signature verification | Cryptographic Ed25519 verification against public key. |
| `sync_start_endpoint` | P2P Replication | Node lifecycle | Binds native iroh endpoint; exposes public Node ID and `EndpointAddr` JSON. |
| `sync_connect_peer` | P2P Replication | Connection lifecycle | Connects to remote iroh peer using ALPN `tauri-boilerplate-sync/1.0`. |
| `sync_disconnect_peer`| P2P Replication | Connection lifecycle | Closes active QUIC connection for specified peer. |
| `sync_send_envelope` | P2P Replication | Stream transport | Sends length-prefixed JSON envelope over bidirectional QUIC stream with 1-byte ACK. |
| `sync_is_connected` | P2P Replication | Transport status | Queries connection manager state without side-effects. |

---

## 4. Verification and Security CI

Capability governance is verified continuously by:
- **Unit Testing**: `crates/native-core` test `database::tests::sql_safety_guard_blocks_hostile_pragmas_and_attachments`.
- **Security Regression**: `tests/security/tauri-capability-governance.test.ts` scanning `capabilities/*.json` and `tauri.conf.json`.
