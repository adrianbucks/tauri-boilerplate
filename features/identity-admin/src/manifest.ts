import { IDENTITY_ADMIN_PERMISSIONS } from "./permissions.js";
import type { FeatureManifest } from "@platform/feature-system";

export const identityAdminManifest: FeatureManifest = {
  id: "identity-admin",
  name: "Identity & Access Administration",
  version: "1.0.0",
  description:
    "Administrator panel for managing users, roles, devices, and sync group memberships.",
  dependencies: ["organisations"],
  optionalDependencies: [],
  permissions: [
    {
      name: IDENTITY_ADMIN_PERMISSIONS.USERS_READ,
      description: "View user accounts",
    },
    {
      name: IDENTITY_ADMIN_PERMISSIONS.USERS_CREATE,
      description: "Create user accounts",
    },
    {
      name: IDENTITY_ADMIN_PERMISSIONS.USERS_MANAGE,
      description: "Suspend or activate user accounts",
    },
    {
      name: IDENTITY_ADMIN_PERMISSIONS.ROLES_MANAGE,
      description: "Assign or revoke roles",
    },
    {
      name: IDENTITY_ADMIN_PERMISSIONS.DEVICES_READ,
      description: "View registered devices",
    },
    {
      name: IDENTITY_ADMIN_PERMISSIONS.DEVICES_APPROVE,
      description: "Approve new device pairings",
    },
    {
      name: IDENTITY_ADMIN_PERMISSIONS.DEVICES_REVOKE,
      description: "Revoke compromised or retired devices",
    },
    {
      name: IDENTITY_ADMIN_PERMISSIONS.SYNC_MANAGE,
      description: "Manage sync groups and membership policies",
    },
  ],
  migrations: [], // Tables are part of core platform schema
  navigation: [
    {
      id: "nav-admin-users",
      label: "Users",
      path: "/admin/users",
      icon: "users",
      requiredPermission: IDENTITY_ADMIN_PERMISSIONS.USERS_READ,
      order: 90,
    },
    {
      id: "nav-admin-devices",
      label: "Devices",
      path: "/admin/devices",
      icon: "laptop",
      requiredPermission: IDENTITY_ADMIN_PERMISSIONS.DEVICES_READ,
      order: 91,
    },
    {
      id: "nav-admin-sync",
      label: "Sync Groups",
      path: "/admin/sync-groups",
      icon: "refresh-cw",
      requiredPermission: IDENTITY_ADMIN_PERMISSIONS.SYNC_MANAGE,
      order: 92,
    },
  ],
};
