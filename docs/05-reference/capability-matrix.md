# Tauri Capability Matrix & IPC Governance

This reference defines the active Tauri capability manifests, granted permissions, and security justifications, enforcing **Acceptance Gate G-05 (Native Boundary)** and **Invariant #8 (Do not grant broad Tauri capabilities)**.

---

## 1. Governance Invariants

1. **Target Window Explicit**: Capabilities must name specific windows (`["main"]`). Wildcard `["*"]` is strictly prohibited.
2. **Mandatory Security Justification**: Every capability declaration must include a detailed justification string documenting its necessity and threat profile.
3. **No Blanket Plugin Grants**: Broad permissions like `core:default` or `core:event:default` are forbidden. Use granular permissions (e.g. `core:event:allow-listen`).
4. **No Dangerous Host Subsystems**: Direct access to shell commands, arbitrary filesystem access, or child processes is prohibited from the webview.

---

## 2. Active Capabilities Inventory

| Capability File             | Identifier    | Target Windows | Granted Permissions                                      | Security Justification                                                                                                                                       |
| :-------------------------- | :------------ | :------------- | :------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capabilities/default.json` | `main-window` | `["main"]`     | `core:event:allow-listen`<br>`core:event:allow-unlisten` | Enables the main window to listen for asynchronous replication events (`sync://envelope-received`). Excludes `allow-emit` to prevent webview event spoofing. |

---

## 3. Native IPC Command Authority Matrix

All native commands implemented in `apps/demo/src-tauri/src/lib.rs`:

| Command Name           | Category        | Authority Level     | Security Enforcement                                                                                   |
| :--------------------- | :-------------- | :------------------ | :----------------------------------------------------------------------------------------------------- |
| `get_device_identity`  | Identity        | Read-only           | Exposes public ID and Ed25519 public key. Private key is never serialized or returned.                 |
| `get_database_health`  | Diagnostic      | Read-only           | Reports SQLite integrity and WAL mode without exposing database handles.                               |
| `authenticate_user`    | Auth            | Mutation / Session  | Argon2id verification with 5-failure lockout cooldown. Issues session token bound to device.           |
| `get_current_session`  | Session         | Read-only           | Returns active principal view with derived permissions.                                                |
| `logout_user`          | Session         | Mutation / Session  | Clears active in-memory principal. Device identity remains registered.                                 |
| `list_widgets`         | Domain          | Tenant-Scoped Read  | Enforces authenticated session; rejects queries across organisation boundaries.                        |
| `create_widget`        | Domain          | Tenant-Scoped Write | Validates input format; scopes entity to principal's organisation.                                     |
| `create_widgets`       | Domain          | Tenant-Scoped Batch | Atomic rollback on partial failure; enforces tenant boundary.                                          |
| `list_organisations`   | Domain          | Tenant-Scoped Read  | Restricted to organisations authorized for the active session.                                         |
| `create_organisation`  | Domain          | Tenant Creation     | Enforces unique slug/domain; requires valid correlation ID.                                            |
| `db_query`             | DB Gateway      | Guarded Read        | Validates SQL safety via `validate_safe_sql`. Rejects PRAGMAs, ATTACH, DETACH, VACUUM INTO.            |
| `db_execute`           | DB Gateway      | Guarded Write       | Validates SQL safety via `validate_safe_sql`. Rejects dangerous administrative commands.               |
| `db_transaction`       | DB Gateway      | Guarded Transaction | Validates every statement in the batch; rolls back atomically on failure.                              |
| `sign_message`         | Crypto          | Native Signing      | Signs arbitrary payload bytes using protected device key. Private key is never serialized or returned. |
| `verify_message`       | Crypto          | Crypto Verification | Cryptographic Ed25519 verification against public key.                                                 |
| `sync_start_endpoint`  | P2P Replication | Node Lifecycle      | Binds native iroh endpoint; exposes public Node ID and `EndpointAddr` JSON.                            |
| `sync_connect_peer`    | P2P Replication | Node Lifecycle      | Connects to remote iroh peer using ALPN `tauri-boilerplate-sync/1.0`.                                  |
| `sync_disconnect_peer` | P2P Replication | Node Lifecycle      | Closes active QUIC connection for specified peer.                                                      |
| `sync_send_envelope`   | P2P Replication | Stream Transport    | Sends length-prefixed JSON envelope over bidirectional QUIC stream with 1-byte ACK.                    |
| `sync_is_connected`    | P2P Replication | Transport Status    | Queries connection manager state without side-effects.                                                 |

---

## 4. Verification

Capability compliance is continuously enforced by:

- Unit test in `crates/native-core/src/database.rs` testing SQL safety against malicious PRAGMAs.
- Security regression test in `tests/security/tauri-capability-governance.test.ts` scanning `capabilities/*.json` and `tauri.conf.json`.
