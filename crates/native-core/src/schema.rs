use crate::NativeMigration;

pub fn core_migration() -> NativeMigration {
    NativeMigration {
        owner: "platform".to_string(),
        version: 1,
        name: "create_platform_core_schema".to_string(),
        checksum: "chk_platform_core_001".to_string(),
        sql: include_str!("../../../packages/platform/src/migrations/core-schema.sql").to_string(),
    }
}

pub fn core_migrations() -> Vec<NativeMigration> {
    vec![
        core_migration(),
        NativeMigration {
            owner: "platform".to_string(),
            version: 2,
            name: "add_local_authentication_state".to_string(),
            checksum: "chk_platform_core_002".to_string(),
            sql: include_str!("../../../packages/platform/src/migrations/core-authentication.sql")
                .to_string(),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DurableDatabase;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn embedded_core_schema_applies_representative_platform_tables() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("tauri-core-schema-{suffix}.db"));
        let database = DurableDatabase::open(&path).expect("database should open");

        assert_eq!(database.apply_migrations(&core_migrations()).unwrap(), 2);
        for table in ["core_organisations", "core_users", "core_audit_events"] {
            assert!(database.table_exists(table).unwrap(), "expected {table} to exist");
        }
        for column in [
            "credential_verifier",
            "failed_authentication_attempts",
            "locked_until",
        ] {
            assert!(
                database.column_exists("core_users", column).unwrap(),
                "expected core_users.{column} to exist"
            );
        }
        drop(database);
        remove_database_files(&path);
    }

    fn remove_database_files(path: &PathBuf) {
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }
}