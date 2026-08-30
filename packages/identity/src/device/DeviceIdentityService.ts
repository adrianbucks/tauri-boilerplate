import {
  getUtcIsoTimestamp,
  generateCorrelationId,
  ValidationError,
  AuthenticationError,
} from "@platform/core";
import type { DatabaseConnection, TransactionClient } from "@platform/database";
import type { DeviceIdentity, DevicePlatform, DeviceStatus } from "../types.js";

export interface RegisterDeviceOptions {
  publicKey: string;
  platform: DevicePlatform;
  applicationId: string;
  userId?: string | null | undefined;
  deviceId?: string | undefined;
}

export class DeviceIdentityService {
  private readonly db: DatabaseConnection;

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  async getLocalDevice(tx?: TransactionClient): Promise<DeviceIdentity | null> {
    const executor = tx ?? this.db;
    const rows = await executor.query<{
      id: string;
      device_id: string;
      public_key: string;
      platform: DevicePlatform;
      application_id: string;
      status: DeviceStatus;
      registered_at: string;
      last_seen_at: string | null;
    }>("SELECT * FROM core_devices LIMIT 1");

    const row = rows[0];
    if (!row) return null;

    return {
      deviceId: row.device_id,
      publicKey: row.public_key,
      platform: row.platform,
      applicationId: row.application_id,
      status: row.status,
      registeredAt: row.registered_at,
      lastSeenAt: row.last_seen_at,
    };
  }

  async registerDevice(
    options: RegisterDeviceOptions,
    tx?: TransactionClient,
  ): Promise<DeviceIdentity> {
    const executor = tx ?? this.db;
    const existing = await this.getLocalDevice(tx);
    if (existing) {
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
    const deviceId = options.deviceId ?? generateCorrelationId("dev");
    const now = getUtcIsoTimestamp();
    const status: DeviceStatus = "UNREGISTERED";

    const sql = `
      INSERT INTO core_devices (
        id, created_at, updated_at, user_id, device_id, public_key, platform, application_id, status, registered_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await executor.execute(sql, [
      id,
      now,
      now,
      options.userId ?? null,
      deviceId,
      options.publicKey,
      options.platform,
      options.applicationId,
      status,
      now,
      now,
    ]);

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
    const executor = tx ?? this.db;
    const now = getUtcIsoTimestamp();
    const sql =
      "UPDATE core_devices SET status = ?, updated_at = ?, last_seen_at = ? WHERE device_id = ?";
    const res = await executor.execute(sql, [newStatus, now, now, deviceId]);
    if (res.rowsAffected === 0) {
      throw new AuthenticationError({
        message: `Device '${deviceId}' not found`,
        userMessage: "Device record not found",
        correlationId: "dev_status_err",
      });
    }
  }
}
