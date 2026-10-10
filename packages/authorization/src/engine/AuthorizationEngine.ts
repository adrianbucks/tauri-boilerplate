import { AuthorizationError, type TrustedOperationContext } from "@platform/core";
import type { DatabaseConnection, TransactionClient } from "@platform/database";
import { AuthorizationRepository } from "../repositories/AuthorizationRepository.js";
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
  private readonly repository: AuthorizationRepository;

  constructor(db: DatabaseConnection) {
    this.repository = new AuthorizationRepository(db);
  }

  async getEffectivePermissions(
    subject: Subject,
    tx?: TransactionClient,
  ): Promise<EffectivePermissions> {
    const rows = await this.repository.findEffectivePermissions(
      subject.userId,
      subject.organisationId,
      tx,
    );

    const permissions: GrantedPermission[] = [];
    for (const row of rows) {
      let scopeConstraints: ResourceScope | undefined;
      if (row.scope_constraints_json !== null) {
        try {
          const parsed: unknown = JSON.parse(row.scope_constraints_json);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            continue;
          }
          scopeConstraints = parsed as ResourceScope;
        } catch {
          // Malformed persisted constraints must not turn into a broad grant.
          continue;
        }
      }
      permissions.push({
        permissionName: row.permission_name,
        scopeConstraints,
      });
    }

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

  async requireForSubject(
    userId: string,
    organisationId: string,
    permission: PermissionName,
    resource?: ResourceScope,
    tx?: TransactionClient,
  ): Promise<void> {
    const roles = await this.repository.findRoleIds(userId, organisationId, tx);
    await this.require({ userId, organisationId, roles }, permission, resource, tx);
  }

  async requireTrusted(
    context: TrustedOperationContext,
    permission: PermissionName,
    resource?: ResourceScope,
    tx?: TransactionClient,
  ): Promise<void> {
    await this.require(
      {
        userId: context.principal.userId,
        organisationId: context.principal.organisationId,
        roles: context.principal.roles,
      },
      permission,
      resource,
      tx,
    );
  }
}
