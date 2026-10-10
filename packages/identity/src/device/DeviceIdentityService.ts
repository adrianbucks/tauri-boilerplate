import {
  getUtcIsoTimestamp,
  generateCorrelationId,
  ValidationError,
  AuthenticationError,
} from "@platform/core";
import type { DatabaseConnection, TransactionClient } from "@platform/database";
import type { DeviceIdentity, DevicePlatform, DeviceStatus } from "../types.js";
import { DeviceIdentityRepository } from "./DeviceIdentityRepository.js";

export interface RegisterDeviceOptions {
  publicKey: string;
  platform: DevicePlatform;
  applicationId: string;
  userId?: string | null | undefined;
  deviceId?: string | undefined;
}

export class DeviceIdentityService {
  private readonly repository: DeviceIdentityRepository;

  constructor(db: DatabaseConnection) {
    this.repository = new DeviceIdentityRepository(db);
  }

  async getLocalDevice(tx?: TransactionClient): Promise<DeviceIdentity | null> {
    return this.repository.findLocal(tx);
  }

  async getDeviceById(deviceId: string, tx?: TransactionClient): Promise<DeviceIdentity | null> {
    return this.repository.findByDeviceId(deviceId, tx);
  }

  async registerDevice(
    options: RegisterDeviceOptions,
    tx?: TransactionClient,
  ): Promise<DeviceIdentity> {
    const requestedDeviceId = options.deviceId;
    const existing = requestedDeviceId
      ? await this.repository.findByDeviceId(requestedDeviceId, tx)
      : await this.repository.findLocal(tx);
    if (existing) {
      if (existing.publicKey !== options.publicKey) {
        throw new AuthenticationError({
          message: `Device '${existing.deviceId}' is already registered with a different public key`,
          userMessage: "This device identity conflicts with an existing registration",
          correlationId: "dev_identity_conflict",
        });
      }
      if (options.userId && existing.userId && options.userId !== existing.userId) {
        throw new AuthenticationError({
          message: `Device '${existing.deviceId}' is already bound to another user`,
          userMessage: "This device is registered to a different user",
          correlationId: "dev_user_conflict",
        });
      }
      return existing;
    }

    if (!options.publicKey || options.publicKey.trim().length === 0) {
      throw new ValidationError({
        message: "Public key is required to register device",
        userMessage: "Device public key missing",
        correlationId: "dev_reg_err",
      });
    }

    const id = generateCorrelationId("dev_rec");
    const deviceId = requestedDeviceId ?? generateCorrelationId("dev");
    const now = getUtcIsoTimestamp();
    const status: DeviceStatus = "UNREGISTERED";

    await this.repository.insert(
      {
        id,
        createdAt: now,
        updatedAt: now,
        userId: options.userId ?? null,
        deviceId,
        publicKey: options.publicKey,
        platform: options.platform,
        applicationId: options.applicationId,
        status,
        registeredAt: now,
        lastSeenAt: now,
        isLocal: requestedDeviceId === undefined,
      },
      tx,
    );

    return {
      deviceId,
      publicKey: options.publicKey,
      platform: options.platform,
      applicationId: options.applicationId,
      status,
      registeredAt: now,
      lastSeenAt: now,
    };
  }

  async updateDeviceStatus(
    deviceId: string,
    newStatus: DeviceStatus,
    tx?: TransactionClient,
  ): Promise<void> {
    const now = getUtcIsoTimestamp();
    const res = await this.repository.updateStatus(deviceId, newStatus, now, tx);
    if (res.rowsAffected === 0) {
      throw new AuthenticationError({
        message: `Device '${deviceId}' not found`,
        userMessage: "Device record not found",
        correlationId: "dev_status_err",
      });
    }
  }
}
