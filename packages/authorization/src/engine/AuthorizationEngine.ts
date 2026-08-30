import { AuthorizationError } from "@platform/core";
import type { DatabaseConnection, TransactionClient } from "@platform/database";
import { ScopeEvaluator } from "./ScopeEvaluator.js";
import type {
  Subject,
  PermissionName,
  ResourceScope,
  AuthorizationDecision,
  EffectivePermissions,
  GrantedPermission,
} from "../types.js";

export class AuthorizationEngine {
  private readonly db: DatabaseConnection;

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  async getEffectivePermissions(
    subject: Subject,
    tx?: TransactionClient,
  ): Promise<EffectivePermissions> {
    const executor = tx ?? this.db;

    if (subject.roles.length === 0) {
      return { permissions: [], organisationId: subject.organisationId };
    }

    const placeholders = subject.roles.map(() => "?").join(", ");
    const sql = `
      SELECT p.name AS permission_name, rp.scope_constraints_json
      FROM core_role_permissions rp
      JOIN core_permissions p ON rp.permission_id = p.id
      WHERE rp.role_id IN (${placeholders})
    `;

    const rows = await executor.query<{
      permission_name: string;
      scope_constraints_json: string | null;
    }>(sql, [...subject.roles]);

    const permissions: GrantedPermission[] = rows.map((r) => {
      let scopeConstraints: ResourceScope | undefined = undefined;
      if (r.scope_constraints_json) {
        try {
          scopeConstraints = JSON.parse(r.scope_constraints_json);
        } catch {
          // Ignore parse errors
        }
      }
      return {
        permissionName: r.permission_name,
        scopeConstraints,
      };
    });

    return {
      permissions,
      organisationId: subject.organisationId,
    };
  }

  async can(
    subject: Subject,
    permission: PermissionName,
    resource?: ResourceScope,
    tx?: TransactionClient,
  ): Promise<AuthorizationDecision> {
    if (subject.roles.length === 0) {
      return {
        granted: false,
        reason: "Subject has no assigned roles",
        code: "NO_MATCHING_ROLE",
      };
    }

    const effective = await this.getEffectivePermissions(subject, tx);
    const matchingGrants = effective.permissions.filter(
      (p) => p.permissionName === permission || p.permissionName === "*",
    );

    if (matchingGrants.length === 0) {
      return {
        granted: false,
        reason: `Subject does not hold permission '${permission}'`,
        code: "PERMISSION_NOT_GRANTED",
      };
    }

    // Check if any matching grant satisfies the resource scope
    const satisfied = matchingGrants.some((grant) =>
      ScopeEvaluator.matches(grant.scopeConstraints, resource),
    );

    if (!satisfied) {
      return {
        granted: false,
        reason: `Permission '${permission}' is not granted for the requested resource scope`,
        code: "SCOPE_MISMATCH",
      };
    }

    return { granted: true };
  }

  async require(
    subject: Subject,
    permission: PermissionName,
    resource?: ResourceScope,
    tx?: TransactionClient,
  ): Promise<void> {
    const decision = await this.can(subject, permission, resource, tx);
    if (!decision.granted) {
      throw new AuthorizationError({
        message: `Authorization failed: ${decision.reason} (${decision.code})`,
        userMessage: "You are not authorized to perform this operation",
        correlationId: `auth_denied_${permission}`,
        technicalDetails: `Subject: ${subject.userId}, Perm: ${permission}, Code: ${decision.code}`,
      });
    }
  }
}
