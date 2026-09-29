use identity_core::{DeviceIdentity, DeviceKeyProvider};
use native_core::{
    core_migrations, DatabaseHealth, DbJsonOperation, DurableDatabase, NativeMigration,
    PlatformError,
};
use serde::Deserialize;
use tauri::Manager;

pub const APPLICATION_ID: &str = "com.tauri.boilerplate.minimal-consumer";

#[derive(Debug, Deserialize)]
struct DbQueryRequest {
    sql: String,
    params: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Deserialize)]
struct DbOperation {
    #[serde(rename = "type")]
    op_type: String,
    sql: String,
    params: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Deserialize)]
struct DbTransactionRequest {
    operations: Vec<DbOperation>,
}

#[derive(Debug, Deserialize)]
struct SignMessageRequest {
    message_hex: String,
}

#[derive(Debug, Deserialize)]
struct VerifyMessageRequest {
    public_key: String,
    message_hex: String,
    signature_hex: String,
}

pub fn notes_feature_migration() -> NativeMigration {
    NativeMigration {
        owner: "feature.notes".to_string(),
        version: 1,
        name: "create_notes_table".to_string(),
        checksum: "chk_notes_001".to_string(),
        sql: include_str!("../../src/notes/notes-schema.sql").to_string(),
    }
}

#[tauri::command]
fn get_device_identity(
    identity: tauri::State<'_, DeviceIdentity>,
) -> Result<DeviceIdentity, PlatformError> {
    Ok(identity.inner().clone())
}

#[tauri::command]
fn get_database_health(
    database: tauri::State<'_, DurableDatabase>,
) -> Result<DatabaseHealth, PlatformError> {
    database.health_check()
}

#[tauri::command]
fn db_query(
    request: DbQueryRequest,
    database: tauri::State<'_, DurableDatabase>,
) -> Result<serde_json::Value, PlatformError> {
    database.query_json(&request.sql, request.params.unwrap_or_default())
}

#[tauri::command]
fn db_execute(
    request: DbQueryRequest,
    database: tauri::State<'_, DurableDatabase>,
) -> Result<serde_json::Value, PlatformError> {
    database.execute_json(&request.sql, request.params.unwrap_or_default())
}

#[tauri::command]
fn db_transaction(
    request: DbTransactionRequest,
    database: tauri::State<'_, DurableDatabase>,
) -> Result<(), PlatformError> {
    let ops: Vec<DbJsonOperation> = request
        .operations
        .into_iter()
        .map(|op| DbJsonOperation {
            op_type: op.op_type,
            sql: op.sql,
            params: op.params.unwrap_or_default(),
        })
        .collect();
    database.transaction_json(ops)
}

#[tauri::command]
fn sign_message(
    request: SignMessageRequest,
    key_provider: tauri::State<'_, DeviceKeyProvider>,
) -> Result<String, PlatformError> {
    let message_bytes = hex::decode(&request.message_hex).map_err(|e| {
        PlatformError::new(
            "invalid_hex",
            format!("Failed to decode message hex: {e}"),
            "Invalid message encoding for signing",
            "sign_message_err",
        )
    })?;
    Ok(key_provider.sign_hex(&message_bytes))
}

#[tauri::command]
fn verify_message(request: VerifyMessageRequest) -> Result<bool, PlatformError> {
    let message_bytes = hex::decode(&request.message_hex).map_err(|e| {
        PlatformError::new(
            "invalid_hex",
            format!("Failed to decode message hex: {e}"),
            "Invalid message encoding for verification",
            "verify_message_err",
        )
    })?;
    DeviceKeyProvider::verify_hex(
        &request.public_key,
        &message_bytes,
        &request.signature_hex,
    )
    .map_err(|e| {
        PlatformError::new(
            "verification_error",
            e.to_string(),
            "Signature verification failed",
            "verify_message_err",
        )
    })
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            std::fs::create_dir_all(&app_data_dir)?;
            let db_path = app_data_dir.join("minimal_consumer.sqlite3");
            let database = DurableDatabase::open(db_path)
                .map_err(|error| std::io::Error::other(error.message))?;
            database
                .apply_migrations(
                    &[
                        core_migrations(),
                        vec![notes_feature_migration()],
                    ]
                    .concat(),
                )
                .map_err(|error| std::io::Error::other(error.message))?;
            let key_provider = database
                .load_or_create_device_key_provider(APPLICATION_ID, std::env::consts::OS)
                .map_err(|error| std::io::Error::other(error.message))?;
            let device_identity = key_provider.identity().clone();
            app.manage(database);
            app.manage(device_identity);
            app.manage(key_provider);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_device_identity,
            get_database_health,
            db_query,
            db_execute,
            db_transaction,
            sign_message,
            verify_message,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{notes_feature_migration, APPLICATION_ID};

    #[test]
    fn identity_namespace_is_application_owned() {
        assert_eq!(APPLICATION_ID, "com.tauri.boilerplate.minimal-consumer");
    }

    #[test]
    fn notes_feature_migration_keeps_feature_ownership() {
        let migration = notes_feature_migration();
        assert_eq!(migration.owner, "feature.notes");
        assert_eq!(migration.version, 1);
        assert_eq!(migration.checksum, "chk_notes_001");
        assert!(migration.sql.contains("CREATE TABLE IF NOT EXISTS notes"));
    }

    #[test]
    fn isolation_test_does_not_contain_demo_features() {
        let migration = notes_feature_migration();
        assert!(!migration.sql.contains("widgets"));
        assert!(!migration.owner.contains("example-feature"));
    }
}

