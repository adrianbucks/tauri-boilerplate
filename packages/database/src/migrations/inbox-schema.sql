-- Durable inbound operation queue.
-- Received envelopes are recorded with verification status before apply.
-- Apply is idempotent: ON CONFLICT (envelope_id) DO NOTHING.

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
