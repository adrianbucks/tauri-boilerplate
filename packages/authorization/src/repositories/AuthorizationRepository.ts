import type { DatabaseConnection, TransactionClient } from "@platform/database";

export interface EffectivePermissionRow {
  permission_name: string;
  scope_constraints_json: string | null;
}

export class AuthorizationRepository {
  constructor(private readonly db: DatabaseConnection) {}

  async findRoleIds(
    userId: string,
    organisationId: string,
    tx?: TransactionClient,
  ): Promise<string[]> {
    const executor = tx ?? this.db;
    const rows = await executor.query<{ role_id: string }>(
      `SELECT ur.role_id
       FROM core_user_roles ur
       JOIN core_roles r
         ON r.id = ur.role_id
        AND r.organisation_id = ur.organisation_id
       WHERE ur.user_id = ? AND ur.organisation_id = ?`,
      [userId, organisationId],
    );
    return rows.map((row) => row.role_id);
  }

  async findEffectivePermissions(
    userId: string,
    organisationId: string,
    tx?: TransactionClient,
  ): Promise<EffectivePermissionRow[]> {
    const executor = tx ?? this.db;
    return executor.query<EffectivePermissionRow>(
      `SELECT p.name AS permission_name, rp.scope_constraints_json
       FROM core_user_roles ur
       JOIN core_roles r
         ON r.id = ur.role_id
        AND r.organisation_id = ur.organisation_id
       JOIN core_role_permissions rp ON rp.role_id = r.id
       JOIN core_permissions p ON rp.permission_id = p.id
       WHERE ur.user_id = ? AND ur.organisation_id = ?`,
      [userId, organisationId],
    );
  }
}
