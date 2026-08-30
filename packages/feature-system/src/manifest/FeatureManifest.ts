export type ConflictStrategy =
  "lww" | "append-only" | "additive" | "manual" | "immutable" | "crdt";

export interface ConflictPolicy {
  strategy: ConflictStrategy;
  customResolverFn?: string | undefined;
}

export interface PermissionDefinition {
  name: string;
  description: string;
}

export interface MigrationDefinition {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export interface SyncPolicyDefinition {
  entityType: string;
  namespacePattern: string;
  conflictPolicy: ConflictPolicy;
  syncable: boolean;
}

export interface NavigationItem {
  id: string;
  label: string;
  path: string;
  icon?: string | undefined;
  requiredPermission?: string | undefined;
  order?: number | undefined;
}

export interface FeatureManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string | undefined;
  readonly dependencies: readonly string[];
  readonly optionalDependencies?: readonly string[] | undefined;
  readonly permissions: readonly PermissionDefinition[];
  readonly migrations: readonly MigrationDefinition[];
  readonly syncPolicies?: readonly SyncPolicyDefinition[] | undefined;
  readonly navigation?: readonly NavigationItem[] | undefined;
}
