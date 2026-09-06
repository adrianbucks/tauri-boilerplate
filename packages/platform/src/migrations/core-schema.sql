CREATE TABLE IF NOT EXISTS core_applications (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  protocol_version INTEGER NOT NULL DEFAULT 1,
  installed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS core_organisations (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT,
  name TEXT NOT NULL,
  domain TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  settings_json TEXT
);
CREATE TABLE IF NOT EXISTS core_users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT,
  organisation_id TEXT NOT NULL REFERENCES core_organisations(id),
  display_name TEXT NOT NULL,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
);
CREATE TABLE IF NOT EXISTS core_devices (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT,
  user_id TEXT REFERENCES core_users(id),
  device_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  application_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'UNREGISTERED',
  registered_at TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE TABLE IF NOT EXISTS core_memberships (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT,
  user_id TEXT NOT NULL REFERENCES core_users(id),
  organisation_id TEXT NOT NULL REFERENCES core_organisations(id),
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
);
CREATE TABLE IF NOT EXISTS core_roles (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT,
  organisation_id TEXT NOT NULL REFERENCES core_organisations(id),
  name TEXT NOT NULL,
  description TEXT
);
CREATE TABLE IF NOT EXISTS core_permissions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT
);
CREATE TABLE IF NOT EXISTS core_role_permissions (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL REFERENCES core_roles(id),
  permission_id TEXT NOT NULL REFERENCES core_permissions(id),
  scope_constraints_json TEXT
);
CREATE TABLE IF NOT EXISTS core_user_roles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES core_users(id),
  role_id TEXT NOT NULL REFERENCES core_roles(id),
  organisation_id TEXT NOT NULL REFERENCES core_organisations(id),
  granted_by TEXT REFERENCES core_users(id),
  granted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS core_sync_groups (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT,
  organisation_id TEXT NOT NULL REFERENCES core_organisations(id),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  policy_json TEXT
);
CREATE TABLE IF NOT EXISTS core_sync_group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES core_sync_groups(id),
  device_id TEXT NOT NULL,
  user_id TEXT REFERENCES core_users(id),
  status TEXT NOT NULL DEFAULT 'REQUESTED',
  joined_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT,
  revocation_reason TEXT
);
CREATE TABLE IF NOT EXISTS core_sync_group_policies (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES core_sync_groups(id),
  namespace_pattern TEXT NOT NULL,
  read_allowed INTEGER NOT NULL DEFAULT 1,
  write_allowed INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS core_membership_requests (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES core_sync_groups(id),
  user_id TEXT REFERENCES core_users(id),
  requested_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
);
CREATE TABLE IF NOT EXISTS core_membership_decisions (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES core_membership_requests(id),
  decided_by TEXT NOT NULL REFERENCES core_users(id),
  decision TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  signature TEXT
);
CREATE TABLE IF NOT EXISTS core_revocations (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  group_id TEXT REFERENCES core_sync_groups(id),
  revoked_by TEXT NOT NULL REFERENCES core_users(id),
  revoked_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  propagated INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS core_audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id TEXT,
  device_id TEXT NOT NULL,
  organisation_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  metadata_json TEXT
);
CREATE TABLE IF NOT EXISTS core_sync_peers (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL UNIQUE,
  node_id TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  connection_mode TEXT NOT NULL DEFAULT 'direct',
  relay_used TEXT,
  status TEXT NOT NULL DEFAULT 'DISCONNECTED'
);
CREATE TABLE IF NOT EXISTS core_sync_sessions (
  id TEXT PRIMARY KEY,
  peer_device_id TEXT NOT NULL,
  operation_id TEXT UNIQUE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  state TEXT NOT NULL DEFAULT 'IDLE',
  bytes_exchanged INTEGER DEFAULT 0,
  correlation_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS core_sync_cursors (
  id TEXT PRIMARY KEY,
  peer_device_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  last_applied_hlc TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS core_sync_conflicts (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  strategy_used TEXT NOT NULL,
  resolution_status TEXT NOT NULL DEFAULT 'RESOLVED',
  resolved_at TEXT,
  details_json TEXT
);
CREATE TABLE IF NOT EXISTS core_feature_migrations (
  id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  checksum TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_core_users_organisation ON core_users(organisation_id);
CREATE INDEX IF NOT EXISTS idx_core_audit_events_organisation ON core_audit_events(organisation_id);
CREATE INDEX IF NOT EXISTS idx_core_audit_events_timestamp ON core_audit_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_core_sync_groups_organisation ON core_sync_groups(organisation_id);
