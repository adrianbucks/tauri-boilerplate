import {
  sqliteTable,
  text,
  integer,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import { baseEntityColumns } from "./base.js";

// Applications registry
export const coreApplications = sqliteTable("core_applications", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  version: text("version").notNull(),
  protocolVersion: integer("protocol_version").notNull().default(1),
  installedAt: text("installed_at").notNull(),
});

// Organisations
export const coreOrganisations = sqliteTable("core_organisations", {
  ...baseEntityColumns,
  name: text("name").notNull(),
  domain: text("domain"),
  status: text("status").notNull().default("ACTIVE"),
  settingsJson: text("settings_json"),
});

// Users
export const coreUsers = sqliteTable("core_users", {
  ...baseEntityColumns,
  organisationId: text("organisation_id")
    .notNull()
    .references(() => coreOrganisations.id),
  displayName: text("display_name").notNull(),
  email: text("email"),
  status: text("status").notNull().default("ACTIVE"),
});

// Devices
export const coreDevices = sqliteTable("core_devices", {
  ...baseEntityColumns,
  userId: text("user_id").references(() => coreUsers.id),
  deviceId: text("device_id").notNull().unique(),
  publicKey: text("public_key").notNull(),
  platform: text("platform").notNull(),
  applicationId: text("application_id").notNull(),
  status: text("status").notNull().default("UNREGISTERED"),
  registeredAt: text("registered_at").notNull(),
  lastSeenAt: text("last_seen_at"),
});

// Memberships
export const coreMemberships = sqliteTable("core_memberships", {
  ...baseEntityColumns,
  userId: text("user_id")
    .notNull()
    .references(() => coreUsers.id),
  organisationId: text("organisation_id")
    .notNull()
    .references(() => coreOrganisations.id),
  role: text("role").notNull(),
  status: text("status").notNull().default("ACTIVE"),
});

// Roles
export const coreRoles = sqliteTable("core_roles", {
  ...baseEntityColumns,
  organisationId: text("organisation_id")
    .notNull()
    .references(() => coreOrganisations.id),
  name: text("name").notNull(),
  description: text("description"),
});

// Permissions
export const corePermissions = sqliteTable("core_permissions", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
});

// Role Permissions
export const coreRolePermissions = sqliteTable("core_role_permissions", {
  id: text("id").primaryKey(),
  roleId: text("role_id")
    .notNull()
    .references(() => coreRoles.id),
  permissionId: text("permission_id")
    .notNull()
    .references(() => corePermissions.id),
  scopeConstraintsJson: text("scope_constraints_json"),
});

// User Roles
export const coreUserRoles = sqliteTable("core_user_roles", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => coreUsers.id),
  roleId: text("role_id")
    .notNull()
    .references(() => coreRoles.id),
  organisationId: text("organisation_id")
    .notNull()
    .references(() => coreOrganisations.id),
  grantedBy: text("granted_by").references(() => coreUsers.id),
  grantedAt: text("granted_at").notNull(),
});

// Sync Groups
export const coreSyncGroups = sqliteTable("core_sync_groups", {
  ...baseEntityColumns,
  organisationId: text("organisation_id")
    .notNull()
    .references(() => coreOrganisations.id),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("ACTIVE"),
  policyJson: text("policy_json"),
});

// Sync Group Members
export const coreSyncGroupMembers = sqliteTable("core_sync_group_members", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => coreSyncGroups.id),
  deviceId: text("device_id").notNull(),
  userId: text("user_id").references(() => coreUsers.id),
  status: text("status").notNull().default("REQUESTED"),
  joinedAt: text("joined_at").notNull(),
  revokedAt: text("revoked_at"),
  revokedBy: text("revoked_by"),
  revocationReason: text("revocation_reason"),
});

// Sync Group Policies
export const coreSyncGroupPolicies = sqliteTable("core_sync_group_policies", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => coreSyncGroups.id),
  namespacePattern: text("namespace_pattern").notNull(),
  readAllowed: integer("read_allowed", { mode: "boolean" })
    .notNull()
    .default(true),
  writeAllowed: integer("write_allowed", { mode: "boolean" })
    .notNull()
    .default(true),
});

// Membership Requests
export const coreMembershipRequests = sqliteTable("core_membership_requests", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  groupId: text("group_id")
    .notNull()
    .references(() => coreSyncGroups.id),
  userId: text("user_id").references(() => coreUsers.id),
  requestedAt: text("requested_at").notNull(),
  status: text("status").notNull().default("PENDING"),
});

// Membership Decisions
export const coreMembershipDecisions = sqliteTable(
  "core_membership_decisions",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => coreMembershipRequests.id),
    decidedBy: text("decided_by")
      .notNull()
      .references(() => coreUsers.id),
    decision: text("decision").notNull(), // APPROVED | REJECTED
    decidedAt: text("decided_at").notNull(),
    signature: text("signature"),
  },
);

// Revocations
export const coreRevocations = sqliteTable("core_revocations", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  groupId: text("group_id").references(() => coreSyncGroups.id),
  revokedBy: text("revoked_by")
    .notNull()
    .references(() => coreUsers.id),
  revokedAt: text("revoked_at").notNull(),
  reason: text("reason").notNull(),
  propagated: integer("propagated", { mode: "boolean" })
    .notNull()
    .default(false),
});

// Audit Events (Append-only)
export const coreAuditEvents = sqliteTable("core_audit_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  userId: text("user_id"),
  deviceId: text("device_id").notNull(),
  organisationId: text("organisation_id").notNull(),
  correlationId: text("correlation_id").notNull(),
  timestamp: text("timestamp").notNull(),
  metadataJson: text("metadata_json"),
});

// Sync Peers
export const coreSyncPeers = sqliteTable("core_sync_peers", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull().unique(),
  nodeId: text("node_id").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  connectionMode: text("connection_mode").notNull().default("direct"),
  relayUsed: text("relay_used"),
  status: text("status").notNull().default("DISCONNECTED"),
});

// Sync Sessions
export const coreSyncSessions = sqliteTable("core_sync_sessions", {
  id: text("id").primaryKey(),
  peerDeviceId: text("peer_device_id").notNull(),
  operationId: text("operation_id").unique(),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  state: text("state").notNull().default("IDLE"),
  bytesExchanged: integer("bytes_exchanged").default(0),
  correlationId: text("correlation_id").notNull(),
});

// Sync Cursors
export const coreSyncCursors = sqliteTable("core_sync_cursors", {
  id: text("id").primaryKey(),
  peerDeviceId: text("peer_device_id").notNull(),
  namespace: text("namespace").notNull(),
  lastAppliedHlc: text("last_applied_hlc").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Sync Conflicts
export const coreSyncConflicts = sqliteTable("core_sync_conflicts", {
  id: text("id").primaryKey(),
  entityId: text("entity_id").notNull(),
  namespace: text("namespace").notNull(),
  detectedAt: text("detected_at").notNull(),
  strategyUsed: text("strategy_used").notNull(),
  resolutionStatus: text("resolution_status").notNull().default("RESOLVED"),
  resolvedAt: text("resolved_at"),
  detailsJson: text("details_json"),
});

// Platform Migrations
export const coreMigrations = sqliteTable(
  "core_migrations",
  {
    owner: text("owner").notNull(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    appliedAt: text("applied_at").notNull(),
    checksum: text("checksum").notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.owner, table.version] }),
  }),
);

// Feature Migrations
export const coreFeatureMigrations = sqliteTable("core_feature_migrations", {
  id: text("id").primaryKey(),
  featureId: text("feature_id").notNull(),
  version: integer("version").notNull(),
  name: text("name").notNull(),
  appliedAt: text("applied_at").notNull(),
  checksum: text("checksum").notNull(),
});
