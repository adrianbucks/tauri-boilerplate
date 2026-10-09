# Native Boundary & Tauri IPC Architecture

## Current Implementation

**Status**: ✅ Contracted, typed Tauri IPC gateway with strictly scoped capabilities, SQL safety validation, and cryptographic key isolation in Rust memory.

The native boundary establishes the security and communication barrier between the untrusted webview (TypeScript/React) and the trusted host process (Rust/OS). Implemented in `crates/native-core`, `crates/identity-core`, `crates/sync-core`, and `apps/demo/src-tauri/src/lib.rs`.

---

## 1. Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│  Untrusted Webview (TypeScript / React)                 │
│  - No direct file system access                        │
│  - No shell or child process spawning                  │
│  - No private cryptographic keys                       │
│  - Typed calls via @platform/database & @platform/sync │
└───────────────────────────┬────────────────────────────┘
                            │ Tauri IPC Bridge
                            │ (invoke / event channels)
┌───────────────────────────▼────────────────────────────┐
│  Tauri Capability Firewall                             │
│  - Explicit window matching (["main"])                 │
│  - Granular permissions (core:event:allow-listen)      │
│  - Documented justifications (>20 chars)               │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│  Native Rust Core (Trusted Host)                       │
│  ├── SQL Safety Guard (validates PRAGMAs / ATTACH)     │
│  ├── NativeSessionStore (Argon2id + lockout cooldown)  │
│  ├── DeviceKeyProvider (Ed25519 in Rust heap memory)   │
│  ├── DurableDatabase (bundled SQLite WAL connection)   │
│  └── IrohSyncEndpoint (QUIC P2P transport)             │
└────────────────────────────────────────────────────────┘
```

---

## 2. Invariants & Security Rules

1. **Private Keys Never Cross IPC**: `get_device_identity` exposes only the device public key and device ID. Private signing keys are held exclusively within Rust memory custody (`DeviceKeyProvider`).
2. **Strict Capability Scoping**: No wildcard `["*"]` window targeting. No blanket permission bundles like `core:default`.
3. **No Arbitrary Host Execution**: Capabilities must never grant frontend access to `core:shell:*`, `core:process:*`, or unrestricted filesystem APIs.
4. **Input Validation at Rust Boundary**: Every IPC command deserializes into strongly typed Rust structs and validates bounds and safety invariants before execution.
5. **SQL Safety Enforcement**: All dynamic SQL queries passing through the database gateway must pass `validate_safe_sql` checks.

---

## 3. Native IPC Command Inventory

All commands registered in `apps/demo/src-tauri/src/lib.rs`:

| Command Name           | Category        | Input Payload                                                  | Return Type                     | Security Enforcement                                                                         |
| :--------------------- | :-------------- | :------------------------------------------------------------- | :------------------------------ | :------------------------------------------------------------------------------------------- |
| `get_device_identity`  | Identity        | None                                                           | `DeviceIdentity`                | Returns device ID and Ed25519 public key. Private key is never returned.                     |
| `get_database_health`  | Diagnostic      | None                                                           | `DatabaseHealth`                | Reports WAL status, foreign keys, and integrity check without exposing DB handles.           |
| `authenticate_user`    | Auth            | `AuthenticateUserInput`                                        | `NativeSessionView`             | Argon2id verification with 5-failure lockout cooldown. Issues session token bound to device. |
| `get_current_session`  | Session         | None                                                           | `Option<NativeSessionView>`     | Returns active principal view with derived role permissions.                                 |
| `logout_user`          | Session         | None                                                           | `()`                            | Clears active in-memory principal. Does not revoke device identity.                          |
| `list_widgets`         | Domain          | `NativeWidgetListRequest`                                      | `Vec<NativeWidgetRecord>`       | Enforces authenticated session; rejects queries across organisation boundaries.              |
| `create_widget`        | Domain          | `NativeWidgetCreateRequest`                                    | `NativeWidgetRecord`            | Validates input format; scopes entity to principal's organisation.                           |
| `create_widgets`       | Domain          | `NativeWidgetBulkCreateRequest`                                | `Vec<NativeWidgetRecord>`       | Atomic rollback on partial failure; enforces tenant boundary.                                |
| `list_organisations`   | Domain          | None                                                           | `Vec<NativeOrganisationRecord>` | Restricted to organisations authorized for the active session.                               |
| `create_organisation`  | Domain          | `NativeOrganisationCreateRequest`                              | `NativeOrganisationRecord`      | Enforces unique slug/domain; requires valid correlation ID.                                  |
| `db_query`             | DB Gateway      | `DbQueryRequest`                                               | `serde_json::Value`             | Validates SQL safety via `validate_safe_sql`. Rejects PRAGMAs, ATTACH, DETACH, VACUUM INTO.  |
| `db_execute`           | DB Gateway      | `DbQueryRequest`                                               | `serde_json::Value`             | Validates SQL safety via `validate_safe_sql`. Rejects dangerous administrative commands.     |
| `db_transaction`       | DB Gateway      | `DbTransactionRequest`                                         | `serde_json::Value`             | Validates every statement in the batch; rolls back atomically on failure.                    |
| `sign_message`         | Crypto          | `{ message: Vec<u8> }`                                         | `Vec<u8>`                       | Signs payload bytes using device private key. Key remains in Rust memory.                    |
| `verify_message`       | Crypto          | `{ message: Vec<u8>, signature: Vec<u8>, public_key: String }` | `bool`                          | Cryptographic Ed25519 verification against public key.                                       |
| `sync_start_endpoint`  | P2P Replication | None                                                           | `EndpointAddr`                  | Binds native iroh endpoint; exposes Node ID and relay address JSON.                          |
| `sync_connect_peer`    | P2P Replication | `{ peer_addr: EndpointAddr }`                                  | `()`                            | Connects to remote iroh peer using ALPN `tauri-boilerplate-sync/1.0`.                        |
| `sync_disconnect_peer` | P2P Replication | `{ node_id: String }`                                          | `()`                            | Closes active QUIC connection for specified peer.                                            |
| `sync_send_envelope`   | P2P Replication | `{ node_id: String, payload: String }`                         | `()`                            | Sends length-prefixed JSON envelope over bidirectional QUIC stream with 1-byte ACK.          |
| `sync_is_connected`    | P2P Replication | `{ node_id: String }`                                          | `bool`                          | Queries connection manager state without side-effects.                                       |

---

## 4. SQL Safety Guard

To prevent hostile database compromise via the TypeScript gateway, `crates/native-core/src/database.rs` inspects every incoming query:

```rust
// crates/native-core/src/database.rs
pub fn validate_safe_sql(sql: &str) -> Result<(), PlatformError> {
    let normalized = sql.trim().to_uppercase();
    let forbidden_patterns = [
        "ATTACH", "DETACH", "PRAGMA", "VACUUM INTO",
        "REINDEX", "ANALYZE", "SAVEPOINT", "RELEASE",
    ];

    for pattern in &forbidden_patterns {
        if normalized.starts_with(pattern) || normalized.contains(&format!(" {}", pattern)) {
            return Err(PlatformError::permission_denied(format!(
                "SQL execution denied: statement contains restricted keyword '{}'",
                pattern
            )));
        }
    }
    Ok(())
}
```

---

## 5. Event Bridges & Asynchronous Communication

Events emitted from Rust to TypeScript use targeted webview listeners:

```rust
// Rust: Emitting envelope arrival
app_handle.emit("sync://envelope-received", &envelope_json)?;
```

Frontend consumption follows a strict subscribe/unsubscribe pattern:

```typescript
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

let unlisten: UnlistenFn | null = null;

export async function startListening(onEnvelope: (env: CanonicalSyncEnvelope) => void) {
  unlisten = await listen<string>("sync://envelope-received", (event) => {
    const parsed = JSON.parse(event.payload);
    onEnvelope(parsed);
  });
}

export function stopListening() {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
}
```

Notice that `capabilities/default.json` grants `core:event:allow-listen` and `core:event:allow-unlisten`, but explicitly omits `core:event:allow-emit`. This prevents the webview from spoofing native internal events.

---

## 6. Content Security Policy (CSP)

The webview CSP configured in `tauri.conf.json` enforces:

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' asset: data: https:;
connect-src 'self' ipc:;
font-src 'self';
object-src 'none';
media-src 'self' asset:;
```

External network connections from the webview (`connect-src`) are restricted to `ipc:` calls back into Tauri. All outbound P2P networking is handled natively via Rust and iroh.
