CREATE TABLE IF NOT EXISTS widgets (
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
  sku TEXT NOT NULL UNIQUE,
  quantity INTEGER NOT NULL DEFAULT 0,
  description TEXT
);
CREATE INDEX IF NOT EXISTS idx_widgets_org ON widgets(organisation_id);
CREATE INDEX IF NOT EXISTS idx_widgets_sync_group ON widgets(sync_group_id);
