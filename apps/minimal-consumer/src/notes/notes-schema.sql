CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  organisation_id TEXT NOT NULL,
  sync_group_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author_id TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT,
  delete_operation_id TEXT
);

