export type OperationType = "create" | "update" | "delete";

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
  readonly signature?: string | undefined;
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
