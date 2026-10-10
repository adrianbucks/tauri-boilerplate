import type { DatabaseConnection, TransactionClient } from "@platform/database";
import type { MembershipStatus } from "../sync-group/SyncGroupService.js";

export interface SyncGroupRecord {
  id: string;
  organisation_id: string;
  status: string;
}

export interface MembershipRequestRecord {
  id: string;
  device_id: string;
  group_id: string;
  user_id: string | null;
  status: string;
}

export interface MembershipEligibilityRecord {
  device_status: string;
  membership_status: MembershipStatus | null;
}

export class SyncGroupRepository {
  constructor(private readonly db: DatabaseConnection) {}

  private executor(tx?: TransactionClient) {
    return tx ?? this.db;
  }

  async findGroup(groupId: string, tx?: TransactionClient): Promise<SyncGroupRecord | undefined> {
    const rows = await this.executor(tx).query<SyncGroupRecord>(
      "SELECT id, organisation_id, status FROM core_sync_groups WHERE id = ? LIMIT 1",
      [groupId],
    );
    return rows[0];
  }

  async insertGroup(values: unknown[], tx?: TransactionClient): Promise<void> {
    await this.executor(tx).execute(
      `INSERT INTO core_sync_groups
      (id, created_at, updated_at, created_by, updated_by, organisation_id, name, description, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      values,
    );
  }

  async insertMembershipRequest(values: unknown[], tx?: TransactionClient): Promise<void> {
    await this.executor(tx).execute(
      `INSERT INTO core_membership_requests
      (id, device_id, group_id, user_id, requested_at, status) VALUES (?, ?, ?, ?, ?, 'PENDING')`,
      values,
    );
  }

  async findMembershipRequest(
    requestId: string,
    tx?: TransactionClient,
  ): Promise<MembershipRequestRecord | undefined> {
    const rows = await this.executor(tx).query<MembershipRequestRecord>(
      "SELECT id, device_id, group_id, user_id, status FROM core_membership_requests WHERE id = ? LIMIT 1",
      [requestId],
    );
    return rows[0];
  }

  async insertDecision(values: unknown[], tx?: TransactionClient): Promise<void> {
    await this.executor(tx).execute(
      `INSERT INTO core_membership_decisions
      (id, request_id, decided_by, decision, decided_at, signature) VALUES (?, ?, ?, ?, ?, ?)`,
      values,
    );
  }

  async setRequestStatus(
    requestId: string,
    status: "APPROVED" | "REJECTED",
    tx?: TransactionClient,
  ): Promise<void> {
    await this.executor(tx).execute("UPDATE core_membership_requests SET status = ? WHERE id = ?", [
      status,
      requestId,
    ]);
  }

  async insertMember(values: unknown[], tx?: TransactionClient): Promise<void> {
    await this.executor(tx).execute(
      `INSERT INTO core_sync_group_members
      (id, group_id, device_id, user_id, status, joined_at) VALUES (?, ?, ?, ?, ?, ?)`,
      values,
    );
  }

  async revokeMember(
    values: unknown[],
    deviceId: string,
    groupId: string,
    tx?: TransactionClient,
  ): Promise<void> {
    await this.executor(tx).execute(
      `UPDATE core_sync_group_members
      SET status = 'REVOKED', revoked_at = ?, revoked_by = ?, revocation_reason = ?
      WHERE device_id = ? AND group_id = ?`,
      [...values, deviceId, groupId],
    );
  }

  async insertRevocation(values: unknown[], tx?: TransactionClient): Promise<void> {
    await this.executor(tx).execute(
      `INSERT INTO core_revocations
      (id, device_id, group_id, revoked_by, revoked_at, reason) VALUES (?, ?, ?, ?, ?, ?)`,
      values,
    );
  }

  async findMembershipStatus(
    deviceId: string,
    groupId: string,
    tx?: TransactionClient,
  ): Promise<MembershipStatus | undefined> {
    const rows = await this.executor(tx).query<{ status: MembershipStatus }>(
      "SELECT status FROM core_sync_group_members WHERE device_id = ? AND group_id = ? LIMIT 1",
      [deviceId, groupId],
    );
    return rows[0]?.status;
  }

  async findDeviceStatus(deviceId: string, tx?: TransactionClient): Promise<string | undefined> {
    const rows = await this.executor(tx).query<{ status: string }>(
      "SELECT status FROM core_devices WHERE device_id = ? LIMIT 1",
      [deviceId],
    );
    return rows[0]?.status;
  }

  async findMembershipEligibility(
    groupId: string,
    deviceId: string,
    userId: string | null,
    tx?: TransactionClient,
  ): Promise<MembershipEligibilityRecord | undefined> {
    const rows = await this.executor(tx).query<MembershipEligibilityRecord>(
      `SELECT d.status AS device_status, m.status AS membership_status
      FROM core_devices d
      LEFT JOIN core_sync_group_members m
        ON m.device_id = d.device_id
        AND m.group_id = ?
        AND m.status IN ('APPROVED', 'ACTIVE')
        AND (m.user_id IS NULL OR m.user_id = ?)
      WHERE d.device_id = ?
      LIMIT 1`,
      [groupId, userId, deviceId],
    );
    return rows[0];
  }
}
