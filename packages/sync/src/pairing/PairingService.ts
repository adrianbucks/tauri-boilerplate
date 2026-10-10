import { AuthorizationError, ValidationError, type OperationContext } from "@platform/core";
import type { DatabaseConnection } from "@platform/database";
import { DeviceIdentityService } from "@platform/identity";
import { SyncGroupService } from "@platform/authorization";
import { AuditService } from "@platform/audit";
import {
  HandshakeValidator,
  type HandshakeMessage,
  type HandshakeValidationOptions,
  type HandshakeVerifyFn,
} from "@platform/sync-protocol";

export interface PairingRequestInput {
  handshake: HandshakeMessage;
  syncGroupId: string;
  /** Optional cryptographic verify callback. Must be provided in production. */
  verifyFn?: HandshakeVerifyFn | undefined;
}

export interface PairingDecisionResult {
  requestId: string;
  deviceId: string;
  syncGroupId: string;
  status: "APPROVED" | "REJECTED";
}

export class PairingService {
  private readonly db: DatabaseConnection;
  private readonly identity: DeviceIdentityService;
  private readonly syncGroups: SyncGroupService;
  private readonly audit: AuditService;

  constructor(db: DatabaseConnection) {
    this.db = db;
    this.identity = new DeviceIdentityService(db);
    this.syncGroups = new SyncGroupService(db);
    this.audit = new AuditService(db);
  }

  /**
   * Processes an incoming peer pairing request, validating the handshake and registering
   * a pending membership request.
   *
   * The peer's public key and platform are taken directly from the authenticated
   * handshake message — no fabrication or inference from deviceId.
   */
  async requestPairing(
    input: PairingRequestInput,
    validationOptions: HandshakeValidationOptions,
    ctx: OperationContext,
  ): Promise<{ requestId: string; status: "PENDING" }> {
    // 1. Handshake Layer Verification (sync checks + async signature verify)
    await HandshakeValidator.requireValid(
      input.handshake,
      {
        ...validationOptions,
        verifyFn: input.verifyFn ?? validationOptions.verifyFn,
      },
      ctx.correlationId,
    );

    if (ctx.organisationId !== input.handshake.organisationId) {
      throw new AuthorizationError({
        message: "Pairing handshake organisation does not match the local operation context",
        userMessage: "This device cannot pair across organisations",
        correlationId: ctx.correlationId,
      });
    }

    const groups = await this.db.query<{ organisation_id: string; status: string }>(
      "SELECT organisation_id, status FROM core_sync_groups WHERE id = ? LIMIT 1",
      [input.syncGroupId],
    );
    const group = groups[0];
    if (!group || group.status !== "ACTIVE") {
      throw new ValidationError({
        message: `Sync group '${input.syncGroupId}' is missing or inactive`,
        userMessage: "The selected sync group is unavailable",
        correlationId: ctx.correlationId,
      });
    }
    if (group.organisation_id !== input.handshake.organisationId) {
      throw new AuthorizationError({
        message: `Pairing group '${input.syncGroupId}' belongs to a different organisation`,
        userMessage: "This device cannot pair across organisations",
        correlationId: ctx.correlationId,
      });
    }

    return this.db.transaction(async (tx) => {
      // 2. Ensure peer device record is registered using real handshake identity.
      //    signerPublicKey is the peer's authentic ed25519_pk_<hex> string.
      //    platform is the peer's self-reported OS (validated via handshake).
      await this.identity.registerDevice(
        {
          deviceId: input.handshake.deviceId,
          publicKey: input.handshake.signerPublicKey,
          platform: input.handshake.platform,
          applicationId: input.handshake.applicationId,
          // Bind the membership to the authenticated local principal. A peer-supplied
          // user ID is not covered by the signed handshake and must never be trusted.
          userId: ctx.userId ?? null,
        },
        tx,
      );

      // 3. Create membership request in target sync group
      const requestId = await this.syncGroups.requestMembership(
        input.syncGroupId,
        input.handshake.deviceId,
        ctx.userId ?? null,
        tx,
      );

      // 4. Emit Audit event
      await this.audit.emit(
        {
          eventType: "MEMBERSHIP_REQUESTED",
          userId: ctx.userId,
          deviceId: input.handshake.deviceId,
          organisationId: input.handshake.organisationId,
          correlationId: ctx.correlationId,
          metadata: {
            requestId,
            syncGroupId: input.syncGroupId,
            applicationVersion: input.handshake.applicationVersion,
            signerPublicKey: input.handshake.signerPublicKey,
            platform: input.handshake.platform,
          },
        },
        tx,
      );

      return { requestId, status: "PENDING" };
    });
  }

  /**
   * Approves a pending pairing request and promotes the device membership to ACTIVE.
   */
  async approvePairing(requestId: string, ctx: OperationContext): Promise<PairingDecisionResult> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.query<{ device_id: string; group_id: string }>(
        "SELECT device_id, group_id FROM core_membership_requests WHERE id = ? LIMIT 1",
        [requestId],
      );
      const req = rows[0];
      if (!req) {
        throw new ValidationError({
          message: `Pairing request '${requestId}' not found`,
          userMessage: "Pairing request not found",
          correlationId: ctx.correlationId,
        });
      }

      await this.syncGroups.approveMembership(requestId, ctx, undefined, tx);

      // Mark device as APPROVED
      await this.identity.updateDeviceStatus(req.device_id, "APPROVED", tx);

      // Emit Audit event
      await this.audit.emit(
        {
          eventType: "MEMBERSHIP_APPROVED",
          userId: ctx.userId,
          deviceId: req.device_id,
          organisationId: ctx.organisationId,
          correlationId: ctx.correlationId,
          metadata: {
            requestId,
            syncGroupId: req.group_id,
          },
        },
        tx,
      );

      return {
        requestId,
        deviceId: req.device_id,
        syncGroupId: req.group_id,
        status: "APPROVED",
      };
    });
  }

  /**
   * Checks the persisted device and group-membership eligibility needed for sync.
   * This is one admission check, not the complete seven-layer transport authorization.
   */
  async canSync(deviceId: string, syncGroupId: string): Promise<boolean> {
    const device = await this.identity.getDeviceById(deviceId);
    if (!device || (device.status !== "APPROVED" && device.status !== "ACTIVE")) {
      return false;
    }

    // A valid device status alone is insufficient; it must also belong to the group.
    return this.syncGroups.canSync(deviceId, syncGroupId);
  }
}
