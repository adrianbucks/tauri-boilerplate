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
import { AuditService } from "@platform/audit";
import { AuthorizationEngine, SyncGroupService } from "@platform/authorization";
import {
  IDENTITY_ADMIN_PERMISSIONS,
  type IdentityAdminPermission,
} from "../permissions.js";

export interface CreateUserInput {
  organisationId: string;
  displayName: string;
  email?: string | undefined;
  roleId?: string | undefined;
}

export class IdentityAdminService {
  private readonly db: DatabaseConnection;
  private readonly audit: AuditService;
  private readonly syncGroups: SyncGroupService;
  private readonly auth: AuthorizationEngine;

  constructor(
    db: DatabaseConnection,
    audit?: AuditService,
    syncGroups?: SyncGroupService,
    auth?: AuthorizationEngine,
  ) {
    this.db = db;
    this.audit = audit ?? new AuditService(db);
    this.auth = auth ?? new AuthorizationEngine(db);
    this.syncGroups = syncGroups ?? new SyncGroupService(db, this.auth);
  }

  private async requirePermission(
    ctx: OperationContext | TrustedOperationContext,
    permission: IdentityAdminPermission,
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

  async createUser(
    input: CreateUserInput,
    ctx: OperationContext | TrustedOperationContext,
  ): Promise<string> {
    if (!input.displayName || input.displayName.trim().length === 0) {
      throw new ValidationError({
        message: "Display name is required",
        userMessage: "Please provide a user display name",
        correlationId: ctx.correlationId,
      });
    }

    const {
      userId: creatorUserId,
      deviceId,
      organisationId,
    } = extractContextSubject(ctx);

    if (input.organisationId !== organisationId) {
      throw new AuthorizationError({
        message: `Cross-tenant user creation forbidden: context organisation '${organisationId}' cannot create user in organisation '${input.organisationId}'`,
        userMessage: "Cannot create user for another organisation",
        correlationId: ctx.correlationId,
      });
    }

    return this.db.transaction(async (tx) => {
      await this.requirePermission(
        ctx,
        IDENTITY_ADMIN_PERMISSIONS.USERS_CREATE,
        tx,
      );

      const userId = generateCorrelationId("usr");
      const now = getUtcIsoTimestamp();

      // Insert User
      await tx.execute(
        "INSERT INTO core_users (id, created_at, updated_at, created_by, updated_by, organisation_id, display_name, email, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          userId,
          now,
          now,
          creatorUserId,
          creatorUserId,
          input.organisationId,
          input.displayName.trim(),
          input.email ? input.email.trim().toLowerCase() : null,
          "ACTIVE",
        ],
      );

      // Assign Role if specified
      if (input.roleId) {
        const userRoleId = generateCorrelationId("ur");
        await tx.execute(
          "INSERT INTO core_user_roles (id, user_id, role_id, organisation_id, granted_by, granted_at) VALUES (?, ?, ?, ?, ?, ?)",
          [
            userRoleId,
            userId,
            input.roleId,
            input.organisationId,
            creatorUserId,
            now,
          ],
        );
      }

      // Record Audit Event
      await this.audit.emit(
        {
          eventType: "USER_CREATED",
          userId: creatorUserId,
          deviceId,
          organisationId: input.organisationId,
          correlationId: ctx.correlationId,
          metadata: { createdUserId: userId, displayName: input.displayName },
        },
        tx,
      );

      return userId;
    });
  }

  async approveDevice(
    deviceId: string,
    requestId: string,
    ctx: OperationContext | TrustedOperationContext,
  ): Promise<void> {
    const {
      userId: actorUserId,
      deviceId: actorDeviceId,
      organisationId,
    } = extractContextSubject(ctx);

    await this.db.transaction(async (tx) => {
      await this.requirePermission(
        ctx,
        IDENTITY_ADMIN_PERMISSIONS.DEVICES_APPROVE,
        tx,
      );

      // 1. Approve sync membership
      await this.syncGroups.approveMembership(requestId, ctx, undefined, tx);

      // 2. Set device status to APPROVED
      const now = getUtcIsoTimestamp();
      await tx.execute(
        "UPDATE core_devices SET status = 'APPROVED', updated_at = ? WHERE device_id = ?",
        [now, deviceId],
      );

      // 3. Emit Audit Event
      await this.audit.emit(
        {
          eventType: "DEVICE_APPROVED",
          userId: actorUserId,
          deviceId: actorDeviceId,
          organisationId,
          correlationId: ctx.correlationId,
          metadata: { approvedDeviceId: deviceId, requestId },
        },
        tx,
      );
    });
  }

  async revokeDevice(
    deviceId: string,
    groupId: string,
    reason: string,
    ctx: OperationContext | TrustedOperationContext,
  ): Promise<void> {
    const {
      userId: actorUserId,
      deviceId: actorDeviceId,
      organisationId,
    } = extractContextSubject(ctx);

    await this.db.transaction(async (tx) => {
      await this.requirePermission(
        ctx,
        IDENTITY_ADMIN_PERMISSIONS.DEVICES_REVOKE,
        tx,
      );

      // 1. Revoke membership in group
      await this.syncGroups.revokeMembership(
        deviceId,
        groupId,
        ctx,
        reason,
        tx,
      );

      // 2. Update device status to REVOKED
      const now = getUtcIsoTimestamp();
      await tx.execute(
        "UPDATE core_devices SET status = 'REVOKED', updated_at = ? WHERE device_id = ?",
        [now, deviceId],
      );

      // 3. Emit Audit Event
      await this.audit.emit(
        {
          eventType: "DEVICE_REVOKED",
          userId: actorUserId,
          deviceId: actorDeviceId,
          organisationId,
          correlationId: ctx.correlationId,
          metadata: { revokedDeviceId: deviceId, reason },
        },
        tx,
      );
    });
  }
}
