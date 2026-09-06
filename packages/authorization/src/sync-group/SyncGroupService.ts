import {
  getUtcIsoTimestamp,
  generateCorrelationId,
  ValidationError,
  AuthorizationError,
  extractContextSubject,
  type OperationContext,
  type TrustedOperationContext,
} from "@platform/core";
import type { DatabaseConnection, TransactionClient } from "@platform/database";
import { AuthorizationEngine } from "../engine/AuthorizationEngine.js";

export type MembershipStatus =
  | "REQUESTED"
  | "APPROVED"
  | "ACTIVE"
  | "SUSPENDED"
  | "EXPIRED"
  | "REVOKED"
  | "REJECTED";

export interface SyncGroup {
  readonly id: string;
  readonly organisationId: string;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly status: "ACTIVE" | "ARCHIVED";
}

export interface SyncGroupMember {
  readonly id: string;
  readonly groupId: string;
  readonly deviceId: string;
  readonly userId?: string | null | undefined;
  readonly status: MembershipStatus;
  readonly joinedAt: string;
  readonly revokedAt?: string | null | undefined;
}

export interface CreateSyncGroupInput {
  name: string;
  description?: string | undefined;
  organisationId: string;
}

export class SyncGroupService {
  private readonly db: DatabaseConnection;
  private readonly auth: AuthorizationEngine;

  constructor(db: DatabaseConnection, auth?: AuthorizationEngine) {
    this.db = db;
    this.auth = auth ?? new AuthorizationEngine(db);
  }

  private async requirePermission(
    ctx: OperationContext | TrustedOperationContext,
    permission: string,
    tx?: TransactionClient,
  ): Promise<void> {
    if ("principal" in ctx && ctx.principal) {
      await this.auth.requireTrusted(ctx, permission, undefined, tx);
      return;
    }

    const { userId, organisationId } = extractContextSubject(ctx);
    if (!userId) {
      throw new AuthorizationError({
        message: `Operation requires authenticated subject with permission '${permission}'`,
        userMessage: "You are not authorized to perform this operation",
        correlationId: ctx.correlationId,
      });
    }

    const executor = tx ?? this.db;
    const roleRows = await executor.query<{ role_id: string }>(
      `SELECT role_id FROM core_user_roles WHERE user_id = ? AND organisation_id = ?`,
      [userId, organisationId],
    );
    const roles = Object.freeze(roleRows.map((r) => r.role_id));

    await this.auth.require(
      { userId, organisationId, roles },
      permission,
      undefined,
      tx,
    );
  }

  async createGroup(
    input: CreateSyncGroupInput,
    ctx: OperationContext | TrustedOperationContext,
    tx?: TransactionClient,
  ): Promise<SyncGroup> {
    const executor = tx ?? this.db;

    if (!input.name || input.name.trim().length === 0) {
      throw new ValidationError({
        message: "Sync group name is required",
        userMessage: "Please provide a valid sync group name",
        correlationId: ctx.correlationId,
      });
    }

    const { userId, organisationId } = extractContextSubject(ctx);

    if (input.organisationId !== organisationId) {
      throw new AuthorizationError({
        message: `Cross-tenant sync group creation forbidden: context organisation '${organisationId}' cannot create group in organisation '${input.organisationId}'`,
        userMessage: "Cannot create sync group for another organisation",
        correlationId: ctx.correlationId,
      });
    }

    await this.requirePermission(ctx, "sync.manage", tx);

    const id = generateCorrelationId("grp");
    const now = getUtcIsoTimestamp();

    const sql = `
      INSERT INTO core_sync_groups (
        id, created_at, updated_at, created_by, updated_by, organisation_id, name, description, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `;

    await executor.execute(sql, [
      id,
      now,
      now,
      userId,
      userId,
      input.organisationId,
      input.name.trim(),
      input.description ?? null,
    ]);

    return {
      id,
      organisationId: input.organisationId,
      name: input.name.trim(),
      description: input.description ?? null,
      status: "ACTIVE",
    };
  }

  async requestMembership(
    groupId: string,
    deviceId: string,
    userId: string | null,
    tx?: TransactionClient,
  ): Promise<string> {
    const executor = tx ?? this.db;
    const now = getUtcIsoTimestamp();
    const requestId = generateCorrelationId("req_mbr");

    const sql = `
      INSERT INTO core_membership_requests (
        id, device_id, group_id, user_id, requested_at, status
      ) VALUES (?, ?, ?, ?, ?, 'PENDING')
    `;
    await executor.execute(sql, [requestId, deviceId, groupId, userId, now]);
    return requestId;
  }

  async approveMembership(
    requestId: string,
    approver: string | OperationContext | TrustedOperationContext,
    signature?: string,
    tx?: TransactionClient,
  ): Promise<void> {
    const executor = tx ?? this.db;
    let approverUserId: string;

    if (typeof approver === "object" && approver !== null) {
      await this.requirePermission(approver, "sync.manage", tx);
      approverUserId =
        "principal" in approver
          ? approver.principal.userId
          : (approver.userId ?? "system");
    } else {
      approverUserId = approver;
    }

    const reqRows = await executor.query<{
      id: string;
      device_id: string;
      group_id: string;
      user_id: string | null;
      status: string;
    }>("SELECT * FROM core_membership_requests WHERE id = ? LIMIT 1", [
      requestId,
    ]);

    const req = reqRows[0];
    if (!req) {
      throw new ValidationError({
        message: `Membership request '${requestId}' not found`,
        userMessage: "Request not found",
        correlationId: "mbr_appr_err",
      });
    }

    const now = getUtcIsoTimestamp();
    const decisionId = generateCorrelationId("dec");
    const memberId = generateCorrelationId("mbr");

    // Record decision
    await executor.execute(
      "INSERT INTO core_membership_decisions (id, request_id, decided_by, decision, decided_at, signature) VALUES (?, ?, ?, ?, ?, ?)",
      [
        decisionId,
        requestId,
        approverUserId,
        "APPROVED",
        now,
        signature ?? null,
      ],
    );

    // Update request status
    await executor.execute(
      "UPDATE core_membership_requests SET status = 'APPROVED' WHERE id = ?",
      [requestId],
    );

    // Insert or update member record
    await executor.execute(
      "INSERT INTO core_sync_group_members (id, group_id, device_id, user_id, status, joined_at) VALUES (?, ?, ?, ?, ?, ?)",
      [memberId, req.group_id, req.device_id, req.user_id, "APPROVED", now],
    );
  }

  async revokeMembership(
    deviceId: string,
    groupId: string,
    revokedBy: string | OperationContext | TrustedOperationContext,
    reason: string,
    tx?: TransactionClient,
  ): Promise<void> {
    const executor = tx ?? this.db;
    let revokedByUserId: string;

    if (typeof revokedBy === "object" && revokedBy !== null) {
      await this.requirePermission(revokedBy, "sync.manage", tx);
      revokedByUserId =
        "principal" in revokedBy
          ? revokedBy.principal.userId
          : (revokedBy.userId ?? "system");
    } else {
      revokedByUserId = revokedBy;
    }

    const now = getUtcIsoTimestamp();
    const revId = generateCorrelationId("rev");

    // Update membership status
    await executor.execute(
      "UPDATE core_sync_group_members SET status = 'REVOKED', revoked_at = ?, revoked_by = ?, revocation_reason = ? WHERE device_id = ? AND group_id = ?",
      [now, revokedByUserId, reason, deviceId, groupId],
    );

    // Insert into core_revocations
    await executor.execute(
      "INSERT INTO core_revocations (id, device_id, group_id, revoked_by, revoked_at, reason) VALUES (?, ?, ?, ?, ?, ?)",
      [revId, deviceId, groupId, revokedByUserId, now, reason],
    );
  }

  async rejectMembership(
    requestId: string,
    rejector: string | OperationContext | TrustedOperationContext,
    reason: string,
    tx?: TransactionClient,
  ): Promise<void> {
    const executor = tx ?? this.db;
    let rejectorUserId: string;

    if (typeof rejector === "object" && rejector !== null) {
      await this.requirePermission(rejector, "sync.manage", tx);
      rejectorUserId =
        "principal" in rejector
          ? rejector.principal.userId
          : (rejector.userId ?? "system");
    } else {
      rejectorUserId = rejector;
    }

    const now = getUtcIsoTimestamp();
    const decisionId = generateCorrelationId("dec");

    // Record the REJECTED decision
    await executor.execute(
      "INSERT INTO core_membership_decisions (id, request_id, decided_by, decision, decided_at, signature) VALUES (?, ?, ?, ?, ?, ?)",
      [decisionId, requestId, rejectorUserId, "REJECTED", now, null],
    );

    // Mark request as REJECTED
    await executor.execute(
      "UPDATE core_membership_requests SET status = 'REJECTED' WHERE id = ?",
      [requestId],
    );
  }

  async canSync(
    deviceId: string,
    groupId: string,
    tx?: TransactionClient,
  ): Promise<boolean> {
    const executor = tx ?? this.db;
    const rows = await executor.query<{ status: MembershipStatus }>(
      "SELECT status FROM core_sync_group_members WHERE device_id = ? AND group_id = ? LIMIT 1",
      [deviceId, groupId],
    );

    const member = rows[0];
    if (!member) return false;
    return member.status === "APPROVED" || member.status === "ACTIVE";
  }
}
