import { ValidationError, type OperationContext } from "@platform/core";
import type { DatabaseConnection } from "@platform/database";
import { DeviceIdentityService } from "@platform/identity";
import { SyncGroupService } from "@platform/authorization";
import { AuditService } from "@platform/audit";
import {
  HandshakeValidator,
  type HandshakeMessage,
  type HandshakeValidationOptions,
} from "@platform/sync-protocol";

export interface PairingRequestInput {
  handshake: HandshakeMessage;
  syncGroupId: string;
  userId?: string | undefined;
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
   */
  async requestPairing(
    input: PairingRequestInput,
    validationOptions: HandshakeValidationOptions,
    ctx: OperationContext,
  ): Promise<{ requestId: string; status: "PENDING" }> {
    // 1. Handshake Layer Verification
    HandshakeValidator.requireValid(
      input.handshake,
      validationOptions,
      ctx.correlationId,
    );

    return this.db.transaction(async (tx) => {
      // 2. Ensure peer device record is registered in local store
      await this.identity.registerDevice(
        {
          deviceId: input.handshake.deviceId,
          publicKey: `ed25519_pk_${input.handshake.deviceId}`,
          platform: "windows",
          applicationId: input.handshake.applicationId,
          userId: input.userId ?? null,
        },
        tx,
      );

      // 3. Create membership request in target sync group
      const requestId = await this.syncGroups.requestMembership(
        input.syncGroupId,
        input.handshake.deviceId,
        input.userId ?? null,
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
  async approvePairing(
    requestId: string,
    ctx: OperationContext,
  ): Promise<PairingDecisionResult> {
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

      await this.syncGroups.approveMembership(
        requestId,
        ctx.userId ?? "system",
        undefined,
        tx,
      );

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
   * Evaluates whether a peer device is fully authorized to exchange data in a sync group.
   * Enforces all 7 pre-sync authorization layers.
   */
  async canSync(deviceId: string, syncGroupId: string): Promise<boolean> {
    // 1. Device must exist and not be REVOKED or UNREGISTERED
    const device = await this.db.query<{ status: string }>(
      "SELECT status FROM core_devices WHERE device_id = ? LIMIT 1",
      [deviceId],
    );
    if (
      !device[0] ||
      device[0].status === "REVOKED" ||
      device[0].status === "UNREGISTERED"
    ) {
      return false;
    }

    // 2. Device must have ACTIVE/APPROVED membership in the sync group
    return this.syncGroups.canSync(deviceId, syncGroupId);
  }
}
