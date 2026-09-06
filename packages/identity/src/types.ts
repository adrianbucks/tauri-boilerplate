export type DevicePlatform = "windows" | "android" | "linux" | "darwin" | "web";

export type DeviceStatus =
  | "UNREGISTERED"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "ACTIVE"
  | "SUSPENDED"
  | "REVOKED";

export type UserStatus = "ACTIVE" | "SUSPENDED" | "REVOKED";

export interface DeviceIdentity {
  readonly deviceId: string;
  readonly publicKey: string;
  readonly platform: DevicePlatform;
  readonly applicationId: string;
  readonly status: DeviceStatus;
  readonly registeredAt: string;
  readonly lastSeenAt?: string | null | undefined;
}

export interface UserIdentity {
  readonly userId: string;
  readonly organisationId: string;
  readonly displayName: string;
  readonly email?: string | null | undefined;
  readonly status: UserStatus;
}

export interface Session {
  readonly sessionId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly organisationId: string;
  readonly roles: readonly string[];
  readonly establishedAt: string;
  readonly expiresAt: string | null;
}

