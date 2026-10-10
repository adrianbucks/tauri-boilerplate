-- Persist the per-task retry jitter accepted by TaskDefinition.retryPolicy.
ALTER TABLE core_background_tasks
  ADD COLUMN retry_jitter REAL NOT NULL DEFAULT 0.25
  CHECK (retry_jitter >= 0 AND retry_jitter <= 1);
