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
import { IdentityAdminRepository } from "../repositories/identityAdminRepository.js";
import { IDENTITY_ADMIN_PERMISSIONS, type IdentityAdminPermission } from "../permissions.js";

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
  private readonly repository: IdentityAdminRepository;

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
    this.repository = new IdentityAdminRepository(db);
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

    await this.auth.requireForSubject(userId, organisationId, permission, undefined, tx);
  }

  async createUser(
    input: CreateUserInput,
    ctx: OperationContext | TrustedOperationContext,
  ): Promise<string> {
    if (typeof input.displayName !== "string" || input.displayName.trim().length === 0) {
      throw new ValidationError({
        message: "Display name is required",
        userMessage: "Please provide a user display name",
        correlationId: ctx.correlationId,
      });
    }
    if (input.email !== undefined && typeof input.email !== "string") {
      throw new ValidationError({
        message: "Email must be a string",
        userMessage: "Please provide a valid email address",
        correlationId: ctx.correlationId,
      });
    }
    if (
      input.roleId !== undefined &&
      (typeof input.roleId !== "string" || input.roleId.trim().length === 0)
    ) {
      throw new ValidationError({
        message: "Role ID must be a non-empty string when provided",
        userMessage: "Select a valid role",
        correlationId: ctx.correlationId,
      });
    }

    const { userId: creatorUserId, deviceId, organisationId } = extractContextSubject(ctx);
    const email = input.email?.trim().toLowerCase() || null;
    const roleId = input.roleId?.trim();

    if (input.organisationId !== organisationId) {
      throw new AuthorizationError({
        message: `Cross-tenant user creation forbidden: context organisation '${organisationId}' cannot create user in organisation '${input.organisationId}'`,
        userMessage: "Cannot create user for another organisation",
        correlationId: ctx.correlationId,
      });
    }

    return this.db.transaction(async (tx) => {
      await this.requirePermission(ctx, IDENTITY_ADMIN_PERMISSIONS.USERS_CREATE, tx);

      if (roleId) {
        await this.requirePermission(ctx, IDENTITY_ADMIN_PERMISSIONS.ROLES_MANAGE, tx);
        if (!(await this.repository.roleExistsWithinOrganisation(roleId, organisationId, tx))) {
          throw new ValidationError({
            message: `Role '${roleId}' does not exist in organisation '${organisationId}'`,
            userMessage: "The selected role is unavailable",
            correlationId: ctx.correlationId,
          });
        }
      }

      const userId = generateCorrelationId("usr");
      const now = getUtcIsoTimestamp();

      await this.repository.insertUser(
        {
          id: userId,
          createdAt: now,
          updatedAt: now,
          createdBy: creatorUserId,
          organisationId: input.organisationId,
          displayName: input.displayName.trim(),
          email,
        },
        tx,
      );

      // Assign Role if specified
      if (roleId) {
        const userRoleId = generateCorrelationId("ur");
        await this.repository.assignRole(
          {
            id: userRoleId,
            userId,
            roleId,
            organisationId: input.organisationId,
            grantedBy: creatorUserId,
            grantedAt: now,
          },
          tx,
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
      await this.requirePermission(ctx, IDENTITY_ADMIN_PERMISSIONS.DEVICES_APPROVE, tx);

      const deviceStatus = await this.repository.findDeviceStatus(deviceId, tx);
      if (!deviceStatus || !["PENDING_APPROVAL", "APPROVED", "ACTIVE"].includes(deviceStatus)) {
        throw new ValidationError({
          message: `Device '${deviceId}' is missing or ineligible for approval`,
          userMessage: "This device cannot be approved",
          correlationId: ctx.correlationId,
        });
      }

      // 1. Approve sync membership
      await this.syncGroups.approveMembership(requestId, ctx, undefined, tx, deviceId);

      // 2. Set device status to APPROVED
      const now = getUtcIsoTimestamp();
      await this.repository.setDeviceStatus(deviceId, "APPROVED", now, tx);

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
      await this.requirePermission(ctx, IDENTITY_ADMIN_PERMISSIONS.DEVICES_REVOKE, tx);

      if (!(await this.repository.findDeviceStatus(deviceId, tx))) {
        throw new ValidationError({
          message: `Device '${deviceId}' does not exist`,
          userMessage: "Device record not found",
          correlationId: ctx.correlationId,
        });
      }

      // 1. Revoke membership in group
      await this.syncGroups.revokeMembership(deviceId, groupId, ctx, reason, tx);

      // 2. Update device status to REVOKED
      const now = getUtcIsoTimestamp();
      await this.repository.setDeviceStatus(deviceId, "REVOKED", now, tx);

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
