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
    } catch {
      this.invalidateSession();
      throw new AuthenticationError({
        message: "Native authentication failed",
        userMessage: "Invalid credentials or account locked",
        correlationId: "auth_native_failed",
      });
    }

    return this.establishFromNativeSession(nativeView, tx);
  }

  /**
   * Restores the TypeScript session from the native session store after app startup.
   */
  async restoreNativeSession(
    gateway: NativeAuthenticator,
    tx?: TransactionClient,
  ): Promise<Session | null> {
    if (!gateway.getCurrentSession) {
      throw new AuthenticationError({
        message: "Native session restoration is not supported by this gateway",
        userMessage: "Unable to restore your sign-in session",
        correlationId: "sess_restore_unsupported",
      });
    }

    const nativeView = await gateway.getCurrentSession();
    if (!nativeView) {
      this.invalidateSession();
      return null;
    }

    return this.establishFromNativeSession(nativeView, tx);
  }

  private async establishFromNativeSession(
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
    }>("SELECT id, organisation_id, display_name, status FROM core_users WHERE id = ? LIMIT 1", [
      nativeView.user_id,
    ]);

    const user = userRows[0];
    if (!user || user.status !== "ACTIVE") {
      this.invalidateSession();
      throw new AuthenticationError({
        message: `User '${nativeView.user_id}' is inactive or not found`,
        userMessage: "User account is inactive",
        correlationId: "sess_user_inactive",
      });
    }

    if (user.organisation_id !== nativeView.organisation_id) {
      this.invalidateSession();
      throw new AuthorizationError({
        message: `Native session organisation does not match user '${nativeView.user_id}'`,
        userMessage: "Your sign-in session does not match this account",
        correlationId: "sess_org_mismatch",
      });
    }

    const deviceRows = await executor.query<{
      device_id: string;
      user_id: string | null;
      status: string;
    }>("SELECT device_id, user_id, status FROM core_devices WHERE device_id = ? LIMIT 1", [
      nativeView.device_id,
    ]);
    const device = deviceRows[0];
    if (
      !device ||
      (device.user_id !== null && device.user_id !== nativeView.user_id) ||
      (device.status !== "APPROVED" && device.status !== "ACTIVE")
    ) {
      this.invalidateSession();
      throw new AuthorizationError({
        message: `Native session device '${nativeView.device_id}' is missing, unbound, or inactive`,
        userMessage: "This device is not approved for sign-in",
        correlationId: "sess_device_invalid",
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

    const session: Session = Object.freeze({
      sessionId,
      userId: nativeView.user_id,
      deviceId: nativeView.device_id,
      organisationId: nativeView.organisation_id,
      roles: Object.freeze(roleRows.map((row) => row.role_id)),
      establishedAt: now,
      expiresAt: null,
    });

    this.currentSession = session;
    return session;
  }

  async validateCurrentSession(tx?: TransactionClient): Promise<Session> {
    const session = this.currentSession;
    if (!session) {
      throw new AuthenticationError({
        message: "No active session found",
        userMessage: "Please log in to continue",
        correlationId: "sess_none",
      });
    }

    const device = await this.deviceService.getDeviceById(session.deviceId, tx);
    if (this.currentSession !== session) {
      throw new AuthenticationError({
        message: "Session changed during validation",
        userMessage: "Your session changed. Please try again.",
        correlationId: "sess_changed",
      });
    }

    if (!device || device.status === "REVOKED" || device.status === "SUSPENDED") {
      this.invalidateSession();
      throw new AuthorizationError({
        message: `Session invalid: device is in state '${device?.status ?? "UNKNOWN"}'`,
        userMessage: "Session terminated because the device status changed",
        correlationId: "sess_dev_invalid",
      });
    }

    if (session.expiresAt) {
      const now = new Date();
      const expires = new Date(session.expiresAt);
      if (now > expires) {
        this.invalidateSession();
        throw new AuthenticationError({
          message: "Session has expired",
          userMessage: "Your session has expired. Please log in again.",
          correlationId: "sess_expired",
        });
      }
    }

    return session;
  }

  async getTrustedOperationContext(tx?: TransactionClient): Promise<TrustedOperationContext> {
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

  async getUser(userId: string, tx?: TransactionClient): Promise<UserIdentity | null> {
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
