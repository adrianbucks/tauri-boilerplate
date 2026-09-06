-- Migration 4: Durable background tasks (WP-015, ADR-024)

CREATE TABLE IF NOT EXISTS core_background_tasks (
  id                  TEXT PRIMARY KEY,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  task_type           TEXT NOT NULL,
  unique_key          TEXT,
  organisation_id     TEXT NOT NULL,
  user_id             TEXT,
  payload_json        TEXT NOT NULL,
  state               TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (state IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  max_attempts        INTEGER NOT NULL DEFAULT 3,
  retry_delay_ms      INTEGER NOT NULL DEFAULT 1000,
  backoff_multiplier  REAL NOT NULL DEFAULT 2.0,
  max_retry_delay_ms  INTEGER NOT NULL DEFAULT 60000,
  scheduled_at        TEXT NOT NULL,
  started_at          TEXT,
  completed_at        TEXT,
  failed_at           TEXT,
  last_error          TEXT,
  timeout_ms          INTEGER NOT NULL DEFAULT 30000,
  correlation_id      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bg_tasks_schedule_state
  ON core_background_tasks (state, scheduled_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bg_tasks_unique_key
  ON core_background_tasks (unique_key)
  WHERE unique_key IS NOT NULL AND state IN ('PENDING', 'RUNNING');

CREATE INDEX IF NOT EXISTS idx_bg_tasks_org
  ON core_background_tasks (organisation_id, created_at);
