export const IDENTITY_ADMIN_PERMISSIONS = {
  USERS_READ: "users.read",
  USERS_CREATE: "users.create",
  USERS_MANAGE: "users.manage",
  ROLES_MANAGE: "roles.manage",
  DEVICES_READ: "devices.read",
  DEVICES_APPROVE: "devices.approve",
  DEVICES_REVOKE: "devices.revoke",
  SYNC_MANAGE: "sync.manage",
} as const;

export type IdentityAdminPermission =
  (typeof IDENTITY_ADMIN_PERMISSIONS)[keyof typeof IDENTITY_ADMIN_PERMISSIONS];
