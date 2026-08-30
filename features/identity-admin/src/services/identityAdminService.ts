import {
  getUtcIsoTimestamp,
  generateCorrelationId,
  ValidationError,
  type OperationContext,
} from "@platform/core";
import type { DatabaseConnection } from "@platform/database";
import { AuditService } from "@platform/audit";
import { SyncGroupService } from "@platform/authorization";

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

  constructor(db: DatabaseConnection) {
    this.db = db;
    this.audit = new AuditService(db);
    this.syncGroups = new SyncGroupService(db);
  }

  async createUser(
    input: CreateUserInput,
    ctx: OperationContext,
  ): Promise<string> {
    if (!input.displayName || input.displayName.trim().length === 0) {
      throw new ValidationError({
        message: "Display name is required",
        userMessage: "Please provide a user display name",
        correlationId: ctx.correlationId,
      });
    }

    return this.db.transaction(async (tx) => {
      const userId = generateCorrelationId("usr");
      const now = getUtcIsoTimestamp();

      // Insert User
      await tx.execute(
        "INSERT INTO core_users (id, created_at, updated_at, created_by, updated_by, organisation_id, display_name, email, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          userId,
          now,
          now,
          ctx.userId,
          ctx.userId,
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
            ctx.userId,
            now,
          ],
        );
      }

      // Record Audit Event
      await this.audit.emit(
        {
          eventType: "USER_CREATED",
          userId: ctx.userId,
          deviceId: ctx.deviceId,
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
    ctx: OperationContext,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      // 1. Approve sync membership
      await this.syncGroups.approveMembership(
        requestId,
        ctx.userId ?? "system",
        undefined,
        tx,
      );

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
          userId: ctx.userId,
          deviceId: ctx.deviceId,
          organisationId: ctx.organisationId,
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
    ctx: OperationContext,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      // 1. Revoke membership in group
      await this.syncGroups.revokeMembership(
        deviceId,
        groupId,
        ctx.userId ?? "system",
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
          userId: ctx.userId,
          deviceId: ctx.deviceId,
          organisationId: ctx.organisationId,
          correlationId: ctx.correlationId,
          metadata: { revokedDeviceId: deviceId, reason },
        },
        tx,
      );
    });
  }
}
