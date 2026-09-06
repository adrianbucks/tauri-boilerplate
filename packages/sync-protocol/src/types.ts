export type OperationType = "create" | "update" | "delete";

export type DevicePlatform =
  | "windows"
  | "android"
  | "linux"
  | "darwin"
  | "web";

export interface SyncOperation {
  readonly operationId: string; // Globally unique ID (ULID/UUID)
  readonly applicationId: string;
  readonly organisationId: string;
  readonly syncGroupId: string;
  readonly featureId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly operation: OperationType;
  readonly payload: unknown;
  readonly authorId: string;
  readonly deviceId: string;
  readonly logicalTimestamp: string; // Hybrid Logical Clock timestamp string
  readonly schemaVersion: number;
  readonly protocolVersion: number;
}

/**
 * A signed, transport-level envelope wrapping a SyncOperation.
 *
 * Canonical bytes for signature generation:
 *   JSON.stringify(operation, sorted keys) → UTF-8 → Ed25519 sign.
 *
 * The `signature` is a 128-character lowercase hex string (64 raw bytes).
 * The `signerPublicKey` is the canonical `ed25519_pk_<hex>` string from the
 * native DeviceKeyProvider. Private key bytes are NEVER included in this type.
 */
export interface SyncEnvelope {
  readonly envelopeId: string; // Globally unique (same as operationId for idempotency)
  readonly signedAt: string; // ISO-8601 UTC timestamp of signing
  readonly signerPublicKey: string; // `ed25519_pk_<64-hex-chars>`
  readonly signature: string; // hex-encoded 64-byte Ed25519 signature
  readonly operation: SyncOperation;
}

export type ConflictStrategy =
  "lww" | "append-only" | "additive" | "manual" | "immutable" | "crdt";

export interface ConflictPolicy {
  readonly strategy: ConflictStrategy;
  readonly customResolverFn?: string | undefined;
}

export interface ConflictRecord {
  readonly entityId: string;
  readonly entityType: string;
  readonly field?: string | undefined;
  readonly localValue: unknown;
  readonly remoteValue: unknown;
  readonly localTimestamp: string;
  readonly remoteTimestamp: string;
  readonly strategy: ConflictStrategy;
  readonly resolvedValue?: unknown | undefined;
  readonly resolvedAt: string;
}
