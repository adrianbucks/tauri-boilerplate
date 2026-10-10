-- Replace the global SKU constraint with active, organisation-scoped uniqueness.
-- Rebuild preserves existing widget data while allowing different organisations
-- to use the same SKU and allowing an SKU to be reused after tombstoning.
CREATE TABLE widgets_v2 (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT,
  entity_id TEXT NOT NULL UNIQUE,
  organisation_id TEXT NOT NULL,
  sync_group_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  sync_version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  deleted_by TEXT,
  delete_operation_id TEXT,
  data_classification TEXT DEFAULT 'INTERNAL',
  name TEXT NOT NULL,
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  description TEXT
);

INSERT INTO widgets_v2 (
  id, created_at, updated_at, created_by, updated_by, entity_id,
  organisation_id, sync_group_id, schema_version, sync_version,
  deleted_at, deleted_by, delete_operation_id, data_classification,
  name, sku, quantity, description
)
SELECT
  id, created_at, updated_at, created_by, updated_by, entity_id,
  organisation_id, sync_group_id, schema_version, sync_version,
  deleted_at, deleted_by, delete_operation_id, data_classification,
  name, sku, quantity, description
FROM widgets;

DROP TABLE widgets;
ALTER TABLE widgets_v2 RENAME TO widgets;

CREATE INDEX idx_widgets_org ON widgets(organisation_id);
CREATE INDEX idx_widgets_sync_group ON widgets(sync_group_id);
CREATE UNIQUE INDEX idx_widgets_org_active_sku
  ON widgets(organisation_id, sku)
  WHERE deleted_at IS NULL;
