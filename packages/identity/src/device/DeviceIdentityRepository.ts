import type { DatabaseConnection, TransactionClient } from "@platform/database";
import type { DeviceIdentity, DevicePlatform, DeviceStatus } from "../types.js";

export interface DeviceIdentityRecord extends DeviceIdentity {
  readonly userId: string | null;
  readonly isLocal: boolean;
}

interface DeviceRow {
  id: string;
  device_id: string;
  public_key: string;
  platform: DevicePlatform;
  application_id: string;
  status: DeviceStatus;
  registered_at: string;
  last_seen_at: string | null;
  user_id: string | null;
  is_local: number;
}

export interface NewDeviceIdentityRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  userId: string | null;
  deviceId: string;
  publicKey: string;
  platform: DevicePlatform;
  applicationId: string;
  status: DeviceStatus;
  registeredAt: string;
  lastSeenAt: string;
  isLocal: boolean;
}

export class DeviceIdentityRepository {
  constructor(private readonly db: DatabaseConnection) {}

  private executor(tx?: TransactionClient): DatabaseConnection | TransactionClient {
    return tx ?? this.db;
  }

  private toIdentity(row: DeviceRow): DeviceIdentityRecord {
    return {
      deviceId: row.device_id,
      publicKey: row.public_key,
      platform: row.platform,
      applicationId: row.application_id,
      status: row.status,
      registeredAt: row.registered_at,
      lastSeenAt: row.last_seen_at,
      userId: row.user_id,
      isLocal: row.is_local === 1,
    };
  }

  async findLocal(tx?: TransactionClient): Promise<DeviceIdentityRecord | null> {
    const rows = await this.executor(tx).query<DeviceRow>(
      "SELECT * FROM core_devices WHERE is_local = 1 LIMIT 1",
    );
    return rows[0] ? this.toIdentity(rows[0]) : null;
  }

  async findByDeviceId(
    deviceId: string,
    tx?: TransactionClient,
  ): Promise<DeviceIdentityRecord | null> {
    const rows = await this.executor(tx).query<DeviceRow>(
      "SELECT * FROM core_devices WHERE device_id = ? LIMIT 1",
      [deviceId],
    );
    return rows[0] ? this.toIdentity(rows[0]) : null;
  }

  async insert(record: NewDeviceIdentityRecord, tx?: TransactionClient): Promise<void> {
    await this.executor(tx).execute(
      `INSERT INTO core_devices (
        id, created_at, updated_at, user_id, device_id, public_key, platform,
        application_id, status, registered_at, last_seen_at, is_local
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.createdAt,
        record.updatedAt,
        record.userId,
        record.deviceId,
        record.publicKey,
        record.platform,
        record.applicationId,
        record.status,
        record.registeredAt,
        record.lastSeenAt,
        record.isLocal ? 1 : 0,
      ],
    );
  }

  async updateStatus(
    deviceId: string,
    status: DeviceStatus,
    updatedAt: string,
    tx?: TransactionClient,
  ): Promise<{ rowsAffected?: number }> {
    return this.executor(tx).execute(
      "UPDATE core_devices SET status = ?, updated_at = ?, last_seen_at = ? WHERE device_id = ?",
      [status, updatedAt, updatedAt, deviceId],
    );
  }
}
