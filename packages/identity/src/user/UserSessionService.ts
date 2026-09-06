import {
  getUtcIsoTimestamp,
  generateCorrelationId,
  AuthenticationError,
  AuthorizationError,
  type TrustedOperationContext,
} from "@platform/core";
import type { DatabaseConnection, TransactionClient } from "@platform/database";
import { DeviceIdentityService } from "../device/DeviceIdentityService.js";
import type { Session, UserIdentity } from "../types.js";

export interface NativeAuthenticator {
  authenticateUser(request: { user_id: string; password: string }): Promise<{
    user_id: string;
    device_id: string;
    organisation_id: string;
    permissions: string[];
  }>;
  logoutUser?(): Promise<void>;
  getCurrentSession?(): Promise<{
    user_id: string;
    device_id: string;
    organisation_id: string;
    permissions: string[];
  } | null>;
}

export interface AuthenticateUserRequest {
  userId: string;
  password: string;
}

export interface CreateSessionOptions {
  userId: string;
  organisationId: string;
  /** Retained for source compatibility; persisted role bindings are authoritative. */
  roles?: readonly string[] | undefined;
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

  /**
   * Authenticates credentials through the native platform security boundary (Argon2id + device binding).
   * On success, establishes an in-memory session with the verified native device identity and roles.
   */
  async authenticate(
    request: AuthenticateUserRequest,
    gateway: NativeAuthenticator,
    tx?: TransactionClient,
  ): Promise<Session> {
    if (!request.userId || !request.password) {
      throw new AuthenticationError({
        message: "User ID and password are required",
        userMessage: "Please provide both user ID and password",
        correlationId: "auth_missing_fields",
      });
    }

    let nativeView: {
      user_id: string;
      device_id: string;
      organisation_id: string;
      permissions: string[];
    };

    try {
      nativeView = await gateway.authenticateUser({
        user_id: request.userId,
        password: request.password,
      });
    } catch (cause) {
      this.invalidateSession();
      throw new AuthenticationError({
        message:
          cause instanceof Error
            ? cause.message
            : "Native authentication failed",
        userMessage: "Invalid credentials or account locked",
        correlationId: "auth_native_failed",
      });
    }

    return this.establishFromNativeSession(nativeView, tx);
  }

  /**
   * Establishes a TypeScript session from an already verified native session view.
   */
  async establishFromNativeSession(
    nativeView: {
      user_id: string;
      device_id: string;
      organisation_id: string;
      permissions: string[];
    },
    tx?: TransactionClient,
  ): Promise<Session> {
    const executor = tx ?? this.db;

    // Verify user exists and is active locally
    const userRows = await executor.query<{
      id: string;
      organisation_id: string;
      display_name: string;
      status: string;
    }>(
      "SELECT id, organisation_id, display_name, status FROM core_users WHERE id = ? LIMIT 1",
      [nativeView.user_id],
    );

    const user = userRows[0];
    if (!user || user.status !== "ACTIVE") {
      this.invalidateSession();
      throw new AuthenticationError({
        message: `User '${nativeView.user_id}' is inactive or not found`,
        userMessage: "User account is inactive",
        correlationId: "sess_user_inactive",
      });
    }

    const roleRows = await executor.query<{ role_id: string }>(
      `SELECT role_id
       FROM core_user_roles
       WHERE user_id = ? AND organisation_id = ?
       ORDER BY role_id ASC`,
      [nativeView.user_id, nativeView.organisation_id],
    );

    const sessionId = generateCorrelationId("sess");
    const now = getUtcIsoTimestamp();

    const session: Session = {
      sessionId,
      userId: nativeView.user_id,
      deviceId: nativeView.device_id,
      organisationId: nativeView.organisation_id,
      roles: Object.freeze(roleRows.map((row) => row.role_id)),
      establishedAt: now,
      expiresAt: null,
    };

    this.currentSession = session;
    return session;
  }

  /**
   * @deprecated Identifier-only session creation bypasses credential verification (CS-003).
   * Prefer `authenticate(request, gateway)` or `establishFromNativeSession(nativeView)`.
   */
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

    if (device.status !== "APPROVED" && device.status !== "ACTIVE") {
      throw new AuthorizationError({
        message: `Device is not approved for sessions (state '${device.status}')`,
        userMessage: "This device has not been approved for sign-in.",
        correlationId: "sess_dev_unapproved",
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
    if (!user || user.status === "REVOKED" || user.status === "SUSPENDED") {
      throw new AuthenticationError({
        message: `User '${options.userId}' is inactive or revoked`,
        userMessage: "User account is inactive",
        correlationId: "sess_user_inactive",
      });
    }

    if (user.organisation_id !== options.organisationId) {
      throw new AuthorizationError({
        message: `User '${options.userId}' does not belong to organisation '${options.organisationId}'`,
        userMessage: "You are not a member of the selected organisation.",
        correlationId: "sess_org_mismatch",
      });
    }

    const roleRows = await executor.query<{ role_id: string }>(
      `SELECT role_id
       FROM core_user_roles
       WHERE user_id = ? AND organisation_id = ?
       ORDER BY role_id ASC`,
      [user.id, user.organisation_id],
    );

    const sessionId = generateCorrelationId("sess");
    const now = getUtcIsoTimestamp();

    const session: Session = {
      sessionId,
      userId: options.userId,
      deviceId: device.deviceId,
      organisationId: user.organisation_id,
      roles: Object.freeze(roleRows.map((row) => row.role_id)),
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

  async getTrustedOperationContext(
    tx?: TransactionClient,
  ): Promise<TrustedOperationContext> {
    const session = await this.validateCurrentSession(tx);
    return Object.freeze({
      correlationId: generateCorrelationId("op"),
      principal: Object.freeze({
        sessionId: session.sessionId,
        userId: session.userId,
        deviceId: session.deviceId,
        organisationId: session.organisationId,
        roles: session.roles,
        authStrength: "offline-session" as const,
      }),
    });
  }

  invalidateSession(): void {
    this.currentSession = null;
  }

  async logout(gateway?: NativeAuthenticator): Promise<void> {
    if (gateway?.logoutUser) {
      await gateway.logoutUser();
    }
    this.invalidateSession();
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
