export type PermissionName = string;

export type ResourceScope = Readonly<Record<string, unknown>>;

export interface Subject {
  readonly userId: string;
  readonly organisationId: string;
  readonly roles: readonly string[];
}

export type AuthorizationDeniedCode =
  | "NO_MATCHING_ROLE"
  | "PERMISSION_NOT_GRANTED"
  | "SCOPE_MISMATCH"
  | "SUBJECT_REVOKED"
  | "ORGANISATION_MISMATCH";

export type AuthorizationDecision =
  | { readonly granted: true }
  | {
      readonly granted: false;
      readonly reason: string;
      readonly code: AuthorizationDeniedCode;
    };

export interface GrantedPermission {
  readonly permissionName: string;
  readonly scopeConstraints?: ResourceScope | undefined;
}

export interface EffectivePermissions {
  readonly permissions: readonly GrantedPermission[];
  readonly organisationId: string;
}
