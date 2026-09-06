ALTER TABLE core_users ADD COLUMN credential_verifier TEXT;
ALTER TABLE core_users ADD COLUMN credential_algorithm_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE core_users ADD COLUMN failed_authentication_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE core_users ADD COLUMN locked_until TEXT;
ALTER TABLE core_users ADD COLUMN credential_updated_at TEXT;
