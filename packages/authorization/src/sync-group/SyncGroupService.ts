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
import { SyncGroupRepository } from "../repositories/SyncGroupRepository.js";

export type MembershipStatus =
  "REQUESTED" | "APPROVED" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "REVOKED" | "REJECTED";

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
  private readonly repository: SyncGroupRepository;

  constructor(db: DatabaseConnection, auth?: AuthorizationEngine) {
    this.db = db;
    this.auth = auth ?? new AuthorizationEngine(db);
    this.repository = new SyncGroupRepository(db);
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

    await this.auth.requireForSubject(userId, organisationId, permission, undefined, tx);
  }

  private async requireGroupOrganisation(
    groupId: string,
    ctx: OperationContext | TrustedOperationContext,
    tx?: TransactionClient,
  ): Promise<void> {
    const { organisationId } = extractContextSubject(ctx);
    const group = await this.repository.findGroup(groupId, tx);
    if (!group) {
      throw new ValidationError({
        message: `Sync group '${groupId}' does not exist`,
        userMessage: "Sync group not found",
        correlationId: ctx.correlationId,
      });
    }
    if (group.organisation_id !== organisationId) {
      throw new AuthorizationError({
        message: `Cannot manage sync group '${groupId}' outside organisation '${organisationId}'`,
        userMessage: "You are not authorized to manage this sync group",
        correlationId: ctx.correlationId,
      });
    }
  }

  async createGroup(
    input: CreateSyncGroupInput,
    ctx: OperationContext | TrustedOperationContext,
    tx?: TransactionClient,
  ): Promise<SyncGroup> {
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

    await this.repository.insertGroup(
      [
        id,
        now,
        now,
        userId,
        userId,
        input.organisationId,
        input.name.trim(),
        input.description ?? null,
      ],
      tx,
    );

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
    const now = getUtcIsoTimestamp();
    const requestId = generateCorrelationId("req_mbr");

    await this.repository.insertMembershipRequest([requestId, deviceId, groupId, userId, now], tx);
    return requestId;
  }

  async approveMembership(
    requestId: string,
    approver: OperationContext | TrustedOperationContext,
    signature?: string,
    tx?: TransactionClient,
    expectedDeviceId?: string,
  ): Promise<void> {
    if (!tx) {
      return this.db.transaction((transaction) =>
        this.approveMembership(requestId, approver, signature, transaction, expectedDeviceId),
      );
    }
    await this.requirePermission(approver, "sync.manage", tx);
    const approverUserId =
      "principal" in approver ? approver.principal.userId : (approver.userId ?? "system");

    const req = await this.repository.findMembershipRequest(requestId, tx);
    if (!req) {
      throw new ValidationError({
        message: `Membership request '${requestId}' not found`,
        userMessage: "Request not found",
        correlationId: "mbr_appr_err",
      });
    }
    await this.requireGroupOrganisation(req.group_id, approver, tx);
    if (req.status !== "PENDING") {
      throw new ValidationError({
        message: `Membership request '${requestId}' is not pending`,
        userMessage: "This membership request has already been decided",
        correlationId: approver.correlationId,
      });
    }
    if (expectedDeviceId !== undefined && req.device_id !== expectedDeviceId) {
      throw new AuthorizationError({
        message: `Membership request '${requestId}' is for a different device`,
        userMessage: "The device does not match this membership request",
        correlationId: approver.correlationId,
      });
    }

    const now = getUtcIsoTimestamp();
    const decisionId = generateCorrelationId("dec");
    const memberId = generateCorrelationId("mbr");

    // Record decision
    await this.repository.insertDecision(
      [decisionId, requestId, approverUserId, "APPROVED", now, signature ?? null],
      tx,
    );

    // Update request status
    await this.repository.setRequestStatus(requestId, "APPROVED", tx);

    // Insert or update member record
    await this.repository.insertMember(
      [memberId, req.group_id, req.device_id, req.user_id, "APPROVED", now],
      tx,
    );
  }

  async revokeMembership(
    deviceId: string,
    groupId: string,
    revokedBy: OperationContext | TrustedOperationContext,
    reason: string,
    tx?: TransactionClient,
  ): Promise<void> {
    if (!tx) {
      return this.db.transaction((transaction) =>
        this.revokeMembership(deviceId, groupId, revokedBy, reason, transaction),
      );
    }
    await this.requirePermission(revokedBy, "sync.manage", tx);
    await this.requireGroupOrganisation(groupId, revokedBy, tx);
    if (!reason.trim()) {
      throw new ValidationError({
        message: "Membership revocation reason is required",
        userMessage: "Provide a reason for revoking this device",
        correlationId: revokedBy.correlationId,
      });
    }
    const membershipStatus = await this.repository.findMembershipStatus(deviceId, groupId, tx);
    if (membershipStatus !== "APPROVED" && membershipStatus !== "ACTIVE") {
      throw new ValidationError({
        message: `Device '${deviceId}' is not an active member of sync group '${groupId}'`,
        userMessage: "This device is not an active member of the selected sync group",
        correlationId: revokedBy.correlationId,
      });
    }
    const revokedByUserId =
      "principal" in revokedBy ? revokedBy.principal.userId : (revokedBy.userId ?? "system");

    const now = getUtcIsoTimestamp();
    const revId = generateCorrelationId("rev");

    // Update membership status
    await this.repository.revokeMember([now, revokedByUserId, reason], deviceId, groupId, tx);

    // Insert into core_revocations
    await this.repository.insertRevocation(
      [revId, deviceId, groupId, revokedByUserId, now, reason],
      tx,
    );
  }

  async rejectMembership(
    requestId: string,
    rejector: OperationContext | TrustedOperationContext,
    reason: string,
    tx?: TransactionClient,
  ): Promise<void> {
    if (!tx) {
      return this.db.transaction((transaction) =>
        this.rejectMembership(requestId, rejector, reason, transaction),
      );
    }
    await this.requirePermission(rejector, "sync.manage", tx);
    const rejectorUserId =
      "principal" in rejector ? rejector.principal.userId : (rejector.userId ?? "system");

    const request = await this.repository.findMembershipRequest(requestId, tx);
    if (!request) {
      throw new ValidationError({
        message: `Membership request '${requestId}' not found`,
        userMessage: "Request not found",
        correlationId: rejector.correlationId,
      });
    }
    await this.requireGroupOrganisation(request.group_id, rejector, tx);
    if (request.status !== "PENDING") {
      throw new ValidationError({
        message: `Membership request '${requestId}' is not pending`,
        userMessage: "This membership request has already been decided",
        correlationId: rejector.correlationId,
      });
    }

    const now = getUtcIsoTimestamp();
    const decisionId = generateCorrelationId("dec");

    // Record the REJECTED decision
    await this.repository.insertDecision(
      [decisionId, requestId, rejectorUserId, "REJECTED", now, null],
      tx,
    );

    // Mark request as REJECTED
    await this.repository.setRequestStatus(requestId, "REJECTED", tx);
  }

  async canSync(deviceId: string, groupId: string, tx?: TransactionClient): Promise<boolean> {
    const deviceStatus = await this.repository.findDeviceStatus(deviceId, tx);
    if (deviceStatus !== "APPROVED" && deviceStatus !== "ACTIVE") return false;
    const status = await this.repository.findMembershipStatus(deviceId, groupId, tx);
    return status === "APPROVED" || status === "ACTIVE";
  }

  async requireActiveMembership(
    ctx: OperationContext | TrustedOperationContext,
    groupId: string,
    tx?: TransactionClient,
  ): Promise<void> {
    const subject = extractContextSubject(ctx);
    const group = await this.repository.findGroup(groupId, tx);

    if (!group) {
      throw new ValidationError({
        message: `Sync group '${groupId}' does not exist`,
        userMessage: "Sync group not found",
        correlationId: ctx.correlationId,
      });
    }
    if (group.organisation_id !== subject.organisationId) {
      throw new AuthorizationError({
        message: `Cannot write to sync group '${groupId}' outside organisation '${subject.organisationId}'`,
        userMessage: "You are not authorized to use this sync group",
        correlationId: ctx.correlationId,
      });
    }
    if (group.status !== "ACTIVE") {
      throw new AuthorizationError({
        message: `Cannot write to inactive sync group '${groupId}'`,
        userMessage: "This sync group is not active",
        correlationId: ctx.correlationId,
      });
    }

    const eligibility = await this.repository.findMembershipEligibility(
      groupId,
      subject.deviceId,
      subject.userId,
      tx,
    );
    if (!eligibility || !["APPROVED", "ACTIVE"].includes(eligibility.device_status)) {
      throw new AuthorizationError({
        message: `Device '${subject.deviceId}' is not active or approved for sync`,
        userMessage: "This device is not approved for sync",
        correlationId: ctx.correlationId,
      });
    }
    if (!eligibility.membership_status) {
      throw new AuthorizationError({
        message: `Device '${subject.deviceId}' is not an approved member of sync group '${groupId}'`,
        userMessage: "This device is not approved for the selected sync group",
        correlationId: ctx.correlationId,
      });
    }
  }
}
