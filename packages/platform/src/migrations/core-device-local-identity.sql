ALTER TABLE core_devices ADD COLUMN is_local INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX idx_core_devices_single_local
  ON core_devices(is_local) WHERE is_local = 1;
