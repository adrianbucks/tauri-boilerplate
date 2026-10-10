import type { DatabaseConnection, TransactionClient } from "@platform/database";

export interface NewManagedUserRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  organisationId: string;
  displayName: string;
  email: string | null;
}

export interface NewUserRoleAssignment {
  id: string;
  userId: string;
  roleId: string;
  organisationId: string;
  grantedBy: string | null;
  grantedAt: string;
}

export class IdentityAdminRepository {
  constructor(private readonly db: DatabaseConnection) {}

  private executor(tx: TransactionClient) {
    return tx ?? this.db;
  }

  async roleExistsWithinOrganisation(
    roleId: string,
    organisationId: string,
    tx: TransactionClient,
  ): Promise<boolean> {
    const rows = await this.executor(tx).query<{ id: string }>(
      "SELECT id FROM core_roles WHERE id = ? AND organisation_id = ? LIMIT 1",
      [roleId, organisationId],
    );
    return rows.length > 0;
  }

  async findDeviceStatus(deviceId: string, tx: TransactionClient): Promise<string | undefined> {
    const rows = await this.executor(tx).query<{ status: string }>(
      "SELECT status FROM core_devices WHERE device_id = ? LIMIT 1",
      [deviceId],
    );
    return rows[0]?.status;
  }

  async insertUser(record: NewManagedUserRecord, tx: TransactionClient): Promise<void> {
    await this.executor(tx).execute(
      `INSERT INTO core_users (
        id, created_at, updated_at, created_by, updated_by, organisation_id,
        display_name, email, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [
        record.id,
        record.createdAt,
        record.updatedAt,
        record.createdBy,
        record.createdBy,
        record.organisationId,
        record.displayName,
        record.email,
      ],
    );
  }

  async assignRole(assignment: NewUserRoleAssignment, tx: TransactionClient): Promise<void> {
    await this.executor(tx).execute(
      `INSERT INTO core_user_roles (
        id, user_id, role_id, organisation_id, granted_by, granted_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        assignment.id,
        assignment.userId,
        assignment.roleId,
        assignment.organisationId,
        assignment.grantedBy,
        assignment.grantedAt,
      ],
    );
  }

  async setDeviceStatus(
    deviceId: string,
    status: "APPROVED" | "REVOKED",
    updatedAt: string,
    tx: TransactionClient,
  ): Promise<void> {
    await this.executor(tx).execute(
      "UPDATE core_devices SET status = ?, updated_at = ? WHERE device_id = ?",
      [status, updatedAt, deviceId],
    );
  }
}
