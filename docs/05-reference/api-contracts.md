# API Contracts & IPC Interface Reference

This document provides the reference contracts for native Rust Tauri IPC commands, TypeScript platform APIs, and data transfer objects.

---

## 1. Native Tauri IPC Commands

All native commands are registered in `apps/demo/src-tauri/src/lib.rs` and implemented via `crates/native-core`, `crates/identity-core`, and `crates/sync-core`.

### `get_device_identity`

- **Description**: Returns the public identity of the host device.
- **Parameters**: None
- **Return Type**:
  ```typescript
  interface DeviceIdentity {
    deviceId: string; // Unique UUID v4
    publicKey: string; // Hex-encoded Ed25519 public key (32 bytes)
    deviceLabel: string; // Human-readable host/OS label
    registeredAt: string; // ISO-8601 UTC
  }
  ```
- **Security**: Private key never leaves native Rust memory custody.

### `get_database_health`

- **Description**: Inspects database integrity, WAL journal mode, and foreign key settings.
- **Parameters**: None
- **Return Type**:
  ```typescript
  interface DatabaseHealth {
    walEnabled: boolean;
    foreignKeysEnabled: boolean;
    integrityOk: boolean;
    busyTimeoutMs: number;
  }
  ```

### `authenticate_user`

- **Description**: Verifies user credentials using Argon2id with lockout cooldown.
- **Parameters**:
  ```typescript
  interface AuthenticateUserInput {
    userId: string;
    password: string;
  }
  ```
- **Return Type**:
  ```typescript
  interface NativeSessionView {
    sessionId: string;
    userId: string;
    deviceId: string;
    organisationId: string;
    roles: string[];
    permissions: string[];
    expiresAt: string; // ISO-8601 UTC
  }
  ```
- **Errors**: `AUTH_FAILED`, `ACCOUNT_LOCKED` (after 5 failed attempts, 15-minute cooldown).

### `db_query` & `db_execute`

- **Description**: Executes parameterized SQL statements through the SQL safety firewall.
- **Parameters**:
  ```typescript
  interface DbQueryRequest {
    sql: string;
    params?: unknown[];
  }
  ```
- **Return Type**: Array of row objects or `{ rowsAffected: number, lastInsertRowId?: number }`.
- **Enforcement**: Rejects queries containing `ATTACH`, `DETACH`, `PRAGMA`, or `VACUUM INTO`.

### `db_transaction`

- **Description**: Executes multiple atomic operations inside a native SQLite transaction.
- **Parameters**:
  ```typescript
  interface DbTransactionRequest {
    operations: {
      type: "query" | "execute";
      sql: string;
      params?: unknown[];
    }[];
  }
  ```
- **Rollback**: Complete atomic rollback if any statement within the batch fails.

### `sync_start_endpoint`

- **Description**: Binds native iroh QUIC endpoint.
- **Parameters**: None
- **Return Type**:
  ```typescript
  interface EndpointAddr {
    nodeId: string; // iroh Node ID (Ed25519 public key in z-base32)
    relayUrl?: string; // DERP relay server URL
    directAddresses: string[]; // List of socket addrs (IP:port)
  }
  ```

### `sync_send_envelope`

- **Description**: Transmits a canonical sync envelope to a connected iroh peer.
- **Parameters**:
  ```typescript
  interface SyncSendEnvelopeRequest {
    nodeId: string;
    payload: string; // Serialized CanonicalSyncEnvelope JSON
  }
  ```

---

## 2. Core TypeScript Platform Interfaces

### `DatabaseConnection` (`@platform/database`)

```typescript
export interface DatabaseConnection {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
  transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
```

### `AuthorizationEngine` (`@platform/authorization`)

```typescript
export interface AuthorizationEngine {
  can(
    ctx: TrustedOperationContext,
    permission: string,
    resource?: unknown,
  ): AuthorizationDecision;
  requireTrusted(
    ctx: TrustedOperationContext,
    permission: string,
    resource?: unknown,
  ): Promise<void>;
  effectivePermissions(ctx: TrustedOperationContext): EffectivePermissions;
}
```

### `SyncTransport` (`@platform/sync`)

```typescript
export interface SyncTransport {
  readonly isConnected: boolean;
  start(): Promise<EndpointAddr>;
  connectPeer(peerAddr: EndpointAddr): Promise<void>;
  disconnectPeer(nodeId: string): Promise<void>;
  sendEnvelope(
    peerNodeId: string,
    envelope: CanonicalSyncEnvelope,
  ): Promise<void>;
  onEnvelope(listener: (envelope: CanonicalSyncEnvelope) => void): () => void;
  stop(): Promise<void>;
}
```
