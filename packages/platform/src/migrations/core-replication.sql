-- Migration 3: Durable outbox, inbox and tombstone tables for real replication (WP-010, WP-012, WP-013)

-- Durable outbound operation queue.
CREATE TABLE IF NOT EXISTS core_sync_outbox (
  id                TEXT PRIMARY KEY,
  created_at        TEXT NOT NULL,
  envelope_id       TEXT NOT NULL UNIQUE,
  organisation_id   TEXT NOT NULL,
  sync_group_id     TEXT NOT NULL REFERENCES core_sync_groups(id),
  feature_id        TEXT NOT NULL,
  entity_type       TEXT NOT NULL,
  entity_id         TEXT NOT NULL,
  operation         TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
  payload_json      TEXT NOT NULL,
  author_id         TEXT NOT NULL,
  device_id         TEXT NOT NULL,
  logical_timestamp TEXT NOT NULL,
  schema_version    INTEGER NOT NULL,
  protocol_version  INTEGER NOT NULL,
  signer_public_key TEXT NOT NULL,
  signature         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  last_attempt_at   TEXT,
  sent_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_status_created
  ON core_sync_outbox (status, created_at);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_org_group
  ON core_sync_outbox (organisation_id, sync_group_id, status);

-- Durable inbound operation queue.
CREATE TABLE IF NOT EXISTS core_sync_inbox (
  id                  TEXT PRIMARY KEY,
  created_at          TEXT NOT NULL,
  envelope_id         TEXT NOT NULL UNIQUE,
  organisation_id     TEXT NOT NULL,
  from_device_id      TEXT NOT NULL,
  sync_group_id       TEXT NOT NULL,
  feature_id          TEXT NOT NULL,
  entity_type         TEXT NOT NULL,
  entity_id           TEXT NOT NULL,
  operation           TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
  payload_json        TEXT NOT NULL,
  logical_timestamp   TEXT NOT NULL,
  schema_version      INTEGER NOT NULL,
  protocol_version    INTEGER NOT NULL,
  signer_public_key   TEXT NOT NULL,
  signature           TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
                           CHECK (verification_status IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')),
  apply_status        TEXT NOT NULL DEFAULT 'PENDING'
                           CHECK (apply_status IN ('PENDING', 'APPLIED', 'CONFLICT', 'FAILED')),
  applied_at          TEXT,
  conflict_id         TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_inbox_apply_status
  ON core_sync_inbox (apply_status, logical_timestamp);

CREATE INDEX IF NOT EXISTS idx_sync_inbox_org_entity
  ON core_sync_inbox (organisation_id, entity_type, entity_id);

-- Replication-safe deletion log.
CREATE TABLE IF NOT EXISTS core_sync_tombstones (
  id                  TEXT PRIMARY KEY,
  created_at          TEXT NOT NULL,
  organisation_id     TEXT NOT NULL,
  sync_group_id       TEXT NOT NULL,
  feature_id          TEXT NOT NULL,
  entity_type         TEXT NOT NULL,
  entity_id           TEXT NOT NULL,
  deleted_at          TEXT NOT NULL,
  deleted_by          TEXT NOT NULL,
  delete_operation_id TEXT NOT NULL UNIQUE,
  replicated_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_tombstones_entity
  ON core_sync_tombstones (organisation_id, entity_type, entity_id);
