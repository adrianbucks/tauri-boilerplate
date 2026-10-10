-- Preserve the complete signed envelope for transport dispatch.
-- Existing rows remain nullable and are rejected by OutboxService until repaired.
ALTER TABLE core_sync_outbox
  ADD COLUMN envelope_json TEXT;
