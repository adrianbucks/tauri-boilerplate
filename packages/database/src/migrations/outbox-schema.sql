-- Durable outbound operation queue.
-- Operations are inserted atomically alongside the business mutation (same transaction).
-- A transport layer picks up PENDING rows and marks them SENT or FAILED.

CREATE TABLE IF NOT EXISTS core_sync_outbox (
  id                TEXT PRIMARY KEY,
  created_at        TEXT NOT NULL,
  envelope_id       TEXT NOT NULL UNIQUE,
  organisation_id   TEXT NOT NULL,
  sync_group_id     TEXT NOT NULL,
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
