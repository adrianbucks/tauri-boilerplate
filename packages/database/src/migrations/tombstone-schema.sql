-- Replication-safe deletion log (tombstones).
-- Synchronisable entities MUST NOT be deleted with raw DELETE.
-- Instead, record a tombstone here and propagate to peers.
-- The application layer is responsible for filtering out tombstoned entities.

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

CREATE INDEX IF NOT EXISTS idx_sync_tombstones_pending_replication
  ON core_sync_tombstones (replicated_at) WHERE replicated_at IS NULL;
