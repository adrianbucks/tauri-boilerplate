use identity_core::DeviceIdentity;
use native_core::{
    core_migrations, create_organisation_for_session, create_widget_for_session,
    create_widgets_for_session,
    list_organisations_for_session, list_widgets_for_session, session_view, AuthenticateUserRequest,
    DatabaseHealth, DurableDatabase, NativeOrganisationCreateRequest, NativeOrganisationRecord,
    NativeSessionStore, NativeSessionView, NativeWidgetCreateRequest, NativeWidgetListRequest,
    NativeWidgetRecord, PlatformError,
};
use tauri::Manager;
use serde::Deserialize;

const APPLICATION_ID: &str = "com.tauri.boilerplate.demo";

#[derive(Debug, Deserialize)]
struct AuthenticateUserInput {
    user_id: String,
    password: String,
}

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

fn example_feature_migration() -> native_core::NativeMigration {
    native_core::NativeMigration {
        owner: "feature.example-feature".to_string(),
        version: 1,
        name: "create_widgets_table".to_string(),
        checksum: "chk_widgets_001".to_string(),
        sql: include_str!("../../../../features/example-feature/src/migrations/widgets-schema.sql")
            .to_string(),
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
fn authenticate_user(
    request: AuthenticateUserInput,
    identity: tauri::State<'_, DeviceIdentity>,
    database: tauri::State<'_, DurableDatabase>,
    sessions: tauri::State<'_, NativeSessionStore>,
) -> Result<NativeSessionView, PlatformError> {
    sessions.authenticate(
        &database,
        AuthenticateUserRequest {
            user_id: request.user_id,
            device_id: identity.device_id.clone(),
            password: request.password,
        },
    )
}

#[tauri::command]
fn get_current_session(
    sessions: tauri::State<'_, NativeSessionStore>,
) -> Result<Option<NativeSessionView>, PlatformError> {
    match sessions.current_principal() {
        Ok(principal) => Ok(Some(session_view(&principal))),
        Err(err) if err.code == "session_missing" => Ok(None),
        Err(err) => Err(err),
    }
}

#[tauri::command]
fn logout_user(sessions: tauri::State<'_, NativeSessionStore>) -> Result<(), PlatformError> {
    sessions.logout()
}

#[tauri::command]
fn list_widgets(
    request: NativeWidgetListRequest,
    database: tauri::State<'_, DurableDatabase>,
    sessions: tauri::State<'_, NativeSessionStore>,
) -> Result<Vec<NativeWidgetRecord>, PlatformError> {
    list_widgets_for_session(&database, &sessions, &request.organisation_id)
}

#[tauri::command]
fn create_widget(
    request: NativeWidgetCreateRequest,
    database: tauri::State<'_, DurableDatabase>,
    sessions: tauri::State<'_, NativeSessionStore>,
) -> Result<NativeWidgetRecord, PlatformError> {
    create_widget_for_session(&database, &sessions, request)
}

#[tauri::command]
fn create_widgets(
    request: native_core::NativeWidgetBulkCreateRequest,
    database: tauri::State<'_, DurableDatabase>,
    sessions: tauri::State<'_, NativeSessionStore>,
) -> Result<Vec<NativeWidgetRecord>, PlatformError> {
    create_widgets_for_session(&database, &sessions, request)
}

#[tauri::command]
fn list_organisations(
    database: tauri::State<'_, DurableDatabase>,
    sessions: tauri::State<'_, NativeSessionStore>,
) -> Result<Vec<NativeOrganisationRecord>, PlatformError> {
    list_organisations_for_session(&database, &sessions)
}

#[tauri::command]
fn create_organisation(
    request: NativeOrganisationCreateRequest,
    database: tauri::State<'_, DurableDatabase>,
    sessions: tauri::State<'_, NativeSessionStore>,
) -> Result<NativeOrganisationRecord, PlatformError> {
    create_organisation_for_session(&database, &sessions, request)
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
    let ops: Vec<native_core::DbJsonOperation> = request
        .operations
        .into_iter()
        .map(|op| native_core::DbJsonOperation {
            op_type: op.op_type,
            sql: op.sql,
            params: op.params.unwrap_or_default(),
        })
        .collect();
    database.transaction_json(ops)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let database_path = app
                .path()
                .app_data_dir()
                .map_err(|error| std::io::Error::other(error.to_string()))?
                .join("platform.sqlite3");
            let database = DurableDatabase::open(database_path)
                .map_err(|error| std::io::Error::other(error.message))?;
            database
                .apply_migrations(
                    &[
                        core_migrations(),
                        vec![example_feature_migration()],
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
            app.manage(NativeSessionStore::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_device_identity,
            get_database_health,
            authenticate_user,
            get_current_session,
            logout_user,
            list_widgets,
            create_widget,
            create_widgets,
            list_organisations,
            create_organisation,
            db_query,
            db_execute,
            db_transaction
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{example_feature_migration, APPLICATION_ID};

    #[test]
    fn identity_namespace_is_application_owned() {
        assert_eq!(APPLICATION_ID, "com.tauri.boilerplate.demo");
    }

    #[test]
    fn example_feature_migration_keeps_feature_ownership() {
        let migration = example_feature_migration();
        assert_eq!(migration.owner, "feature.example-feature");
        assert_eq!(migration.version, 1);
        assert_eq!(migration.checksum, "chk_widgets_001");
        assert!(migration.sql.contains("CREATE TABLE IF NOT EXISTS widgets"));
    }
}
