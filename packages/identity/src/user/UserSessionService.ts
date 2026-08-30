import {
  getUtcIsoTimestamp,
  generateCorrelationId,
  AuthenticationError,
  AuthorizationError,
} from "@platform/core";
import type { DatabaseConnection, TransactionClient } from "@platform/database";
import { DeviceIdentityService } from "../device/DeviceIdentityService.js";
import type { Session, UserIdentity } from "../types.js";

export interface CreateSessionOptions {
  userId: string;
  organisationId: string;
  roles: string[];
  expiresAt?: string | null | undefined;
}

export class UserSessionService {
  private readonly db: DatabaseConnection;
  private readonly deviceService: DeviceIdentityService;
  private currentSession: Session | null = null;

  constructor(db: DatabaseConnection) {
    this.db = db;
    this.deviceService = new DeviceIdentityService(db);
  }

  getCurrentSession(): Session | null {
    return this.currentSession;
  }

  async createSession(
    options: CreateSessionOptions,
    tx?: TransactionClient,
  ): Promise<Session> {
    const executor = tx ?? this.db;
    const device = await this.deviceService.getLocalDevice(tx);

    if (!device) {
      throw new AuthenticationError({
        message: "No device registered on this system",
        userMessage: "Device identity missing",
        correlationId: "sess_nodev_err",
      });
    }

    if (device.status === "REVOKED") {
      throw new AuthorizationError({
        message: "Device has been revoked and cannot start a session",
        userMessage: "This device has been revoked",
        correlationId: "sess_dev_revoked",
      });
    }

    if (device.status === "SUSPENDED") {
      throw new AuthorizationError({
        message: "Device is suspended and cannot start a session",
        userMessage:
          "This device has been suspended. Contact your administrator.",
        correlationId: "sess_dev_suspended",
      });
    }

    // Verify User Status
    const userRows = await executor.query<{
      id: string;
      organisation_id: string;
      display_name: string;
      status: string;
    }>("SELECT * FROM core_users WHERE id = ? LIMIT 1", [options.userId]);

    const user = userRows[0];
    if (!user || user.status === "REVOKED") {
      throw new AuthenticationError({
        message: `User '${options.userId}' is inactive or revoked`,
        userMessage: "User account is inactive",
        correlationId: "sess_user_inactive",
      });
    }

    const sessionId = generateCorrelationId("sess");
    const now = getUtcIsoTimestamp();

    const session: Session = {
      sessionId,
      userId: options.userId,
      deviceId: device.deviceId,
      organisationId: options.organisationId,
      roles: Object.freeze([...options.roles]),
      establishedAt: now,
      expiresAt: options.expiresAt ?? null,
    };

    this.currentSession = session;
    return session;
  }

  async validateCurrentSession(tx?: TransactionClient): Promise<Session> {
    if (!this.currentSession) {
      throw new AuthenticationError({
        message: "No active session found",
        userMessage: "Please log in to continue",
        correlationId: "sess_none",
      });
    }

    const device = await this.deviceService.getLocalDevice(tx);
    if (
      !device ||
      device.status === "REVOKED" ||
      device.status === "SUSPENDED"
    ) {
      this.invalidateSession();
      throw new AuthorizationError({
        message: `Session invalid: device is in state '${device?.status ?? "UNKNOWN"}'`,
        userMessage: "Session terminated because the device status changed",
        correlationId: "sess_dev_invalid",
      });
    }

    if (this.currentSession.expiresAt) {
      const now = new Date();
      const expires = new Date(this.currentSession.expiresAt);
      if (now > expires) {
        this.invalidateSession();
        throw new AuthenticationError({
          message: "Session has expired",
          userMessage: "Your session has expired. Please log in again.",
          correlationId: "sess_expired",
        });
      }
    }

    return this.currentSession;
  }

  invalidateSession(): void {
    this.currentSession = null;
  }

  async getUser(
    userId: string,
    tx?: TransactionClient,
  ): Promise<UserIdentity | null> {
    const executor = tx ?? this.db;
    const rows = await executor.query<{
      id: string;
      organisation_id: string;
      display_name: string;
      email: string | null;
      status: "ACTIVE" | "SUSPENDED" | "REVOKED";
    }>("SELECT * FROM core_users WHERE id = ? LIMIT 1", [userId]);

    const row = rows[0];
    if (!row) return null;

    return {
      userId: row.id,
      organisationId: row.organisation_id,
      displayName: row.display_name,
      email: row.email,
      status: row.status,
    };
  }
}
