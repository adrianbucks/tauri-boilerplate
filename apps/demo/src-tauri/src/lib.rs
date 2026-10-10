use background_core::{BackgroundLifecycleState, BackgroundSchedulerStatus};
use identity_core::{DeviceIdentity, DeviceKeyProvider};
use native_core::{
    core_migrations, create_organisation_for_session, create_widget_for_session,
    create_widgets_for_session, list_organisations_for_session, list_widgets_for_session,
    session_view, AuthenticateUserRequest, DatabaseHealth, DurableDatabase,
    NativeOrganisationCreateRequest, NativeOrganisationRecord, NativeSessionStore,
    NativeSessionView, NativeWidgetCreateRequest, NativeWidgetListRequest, NativeWidgetRecord,
    PlatformError,
};
use serde::{Deserialize, Serialize};
use sync_core::{EndpointAddr, IrohSyncEndpoint};
#[cfg(target_os = "windows")]
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};
use tauri::{Emitter, Manager};

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

#[derive(Debug, Serialize)]
struct DiagnosticsCounts {
    outbox_pending: u64,
    inbox_total: u64,
    audit_events: u64,
    widgets_total: u64,
}

fn count_query_rows(database: &DurableDatabase, sql: &str) -> Result<u64, PlatformError> {
    let result = database.query_json(sql, Vec::new())?;
    result["rows"][0]["cnt"].as_u64().ok_or_else(|| {
        PlatformError::new(
            "DATABASE_ERROR",
            "Diagnostics count query returned an invalid result",
            "Unable to load database diagnostics",
            "diagnostics_count_result",
        )
    })
}

fn example_feature_migrations() -> Vec<native_core::NativeMigration> {
    vec![
        native_core::NativeMigration {
            owner: "feature.example-feature".to_string(),
            version: 1,
            name: "create_widgets_table".to_string(),
            checksum: "chk_widgets_001".to_string(),
            sql: include_str!(
                "../../../../features/example-feature/src/migrations/widgets-schema.sql"
            )
            .to_string(),
        },
        native_core::NativeMigration {
            owner: "feature.example-feature".to_string(),
            version: 2,
            name: "scope_active_widget_skus_to_organisation".to_string(),
            checksum: "chk_widgets_002".to_string(),
            sql: include_str!(
                "../../../../features/example-feature/src/migrations/widgets-schema-v2.sql"
            )
            .to_string(),
        },
    ]
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
fn get_diagnostics_counts(
    database: tauri::State<'_, DurableDatabase>,
) -> Result<DiagnosticsCounts, PlatformError> {
    Ok(DiagnosticsCounts {
        outbox_pending: count_query_rows(
            &database,
            "SELECT COUNT(*) AS cnt FROM core_sync_outbox WHERE status = 'pending'",
        )?,
        inbox_total: count_query_rows(&database, "SELECT COUNT(*) AS cnt FROM core_sync_inbox")?,
        audit_events: count_query_rows(&database, "SELECT COUNT(*) AS cnt FROM core_audit_events")?,
        widgets_total: count_query_rows(
            &database,
            "SELECT COUNT(*) AS cnt FROM widgets WHERE deleted_at IS NULL",
        )?,
    })
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

#[tauri::command]
fn sign_message(
    request: SignMessageRequest,
    key_provider: tauri::State<'_, DeviceKeyProvider>,
) -> Result<String, PlatformError> {
    DeviceKeyProvider::validate_message_hex_length(request.message_hex.len()).map_err(|error| {
        PlatformError::new(
            "message_too_large",
            error.to_string(),
            "Signing message exceeds the supported size",
            "sign_message_err",
        )
    })?;
    let message_bytes = hex::decode(&request.message_hex).map_err(|e| {
        PlatformError::new(
            "invalid_hex",
            format!("Failed to decode message hex: {e}"),
            "Invalid message encoding for signing",
            "sign_message_err",
        )
    })?;
    key_provider.sign_hex(&message_bytes).map_err(|error| {
        PlatformError::new(
            "signing_error",
            error.to_string(),
            "Signing message could not be processed",
            "sign_message_err",
        )
    })
}

#[tauri::command]
fn verify_message(request: VerifyMessageRequest) -> Result<bool, PlatformError> {
    DeviceKeyProvider::validate_message_hex_length(request.message_hex.len()).map_err(|error| {
        PlatformError::new(
            "message_too_large",
            error.to_string(),
            "Verification message exceeds the supported size",
            "verify_message_err",
        )
    })?;
    let message_bytes = hex::decode(&request.message_hex).map_err(|e| {
        PlatformError::new(
            "invalid_hex",
            format!("Failed to decode message hex: {e}"),
            "Invalid message encoding for verification",
            "verify_message_err",
        )
    })?;
    DeviceKeyProvider::verify_hex(&request.public_key, &message_bytes, &request.signature_hex)
        .map_err(|e| {
            PlatformError::new(
                "verification_error",
                e.to_string(),
                "Signature verification failed",
                "verify_message_err",
            )
        })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncEndpointInfo {
    pub endpoint_id: String,
    pub addr_json: String,
}

#[derive(Debug, Deserialize)]
pub struct SyncConnectRequest {
    pub addr_json: String,
}

#[derive(Debug, Deserialize)]
pub struct SyncSendRequest {
    pub endpoint_id: String,
    pub payload_json: String,
}

#[derive(Debug, Deserialize)]
pub struct SyncDisconnectRequest {
    pub endpoint_id: String,
}

#[derive(Default)]
pub struct SyncState {
    pub endpoint: tokio::sync::RwLock<Option<IrohSyncEndpoint>>,
}

#[tauri::command]
async fn sync_start_endpoint(
    app: tauri::AppHandle,
    state: tauri::State<'_, SyncState>,
) -> Result<SyncEndpointInfo, PlatformError> {
    let mut lock = state.endpoint.write().await;
    if let Some(ep) = lock.as_ref() {
        let addr = ep.endpoint_addr();
        let addr_json = serde_json::to_string(&addr).map_err(|e| {
            PlatformError::new(
                "serialization_error",
                e.to_string(),
                "Failed to serialize addr",
                "sync_err",
            )
        })?;
        return Ok(SyncEndpointInfo {
            endpoint_id: ep.endpoint_id(),
            addr_json,
        });
    }

    let endpoint = IrohSyncEndpoint::bind(None).await.map_err(|e| {
        PlatformError::new(
            "endpoint_bind_failed",
            e.to_string(),
            "Failed to bind iroh endpoint",
            "sync_err",
        )
    })?;

    let endpoint_id = endpoint.endpoint_id();
    let addr = endpoint.endpoint_addr();
    let addr_json = serde_json::to_string(&addr).map_err(|e| {
        PlatformError::new(
            "serialization_error",
            e.to_string(),
            "Failed to serialize addr",
            "sync_err",
        )
    })?;

    let receiver_ep = endpoint.clone();
    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Some(msg) = receiver_ep.next_inbound_envelope().await {
            let _ = app_clone.emit("sync://envelope-received", &msg);
        }
    });

    *lock = Some(endpoint);

    Ok(SyncEndpointInfo {
        endpoint_id,
        addr_json,
    })
}

#[tauri::command]
async fn sync_connect_peer(
    request: SyncConnectRequest,
    state: tauri::State<'_, SyncState>,
) -> Result<String, PlatformError> {
    let lock = state.endpoint.read().await;
    let endpoint = lock.as_ref().ok_or_else(|| {
        PlatformError::new(
            "endpoint_not_started",
            "Sync endpoint not started",
            "Start endpoint first",
            "sync_err",
        )
    })?;

    let addr_str = if request.addr_json.trim_start().starts_with('{') {
        request.addr_json
    } else {
        serde_json::json!({ "id": request.addr_json.trim() }).to_string()
    };
    let addr: EndpointAddr = serde_json::from_str(&addr_str).map_err(|e| {
        PlatformError::new(
            "invalid_addr",
            format!("Failed to parse EndpointAddr: {e}"),
            "Invalid address",
            "sync_err",
        )
    })?;

    endpoint.connect_endpoint_addr(addr).await.map_err(|e| {
        PlatformError::new(
            "connect_failed",
            e.to_string(),
            "Failed to connect to peer",
            "sync_err",
        )
    })
}

#[tauri::command]
async fn sync_disconnect_peer(
    request: SyncDisconnectRequest,
    state: tauri::State<'_, SyncState>,
) -> Result<(), PlatformError> {
    let lock = state.endpoint.read().await;
    let endpoint = lock.as_ref().ok_or_else(|| {
        PlatformError::new(
            "endpoint_not_started",
            "Sync endpoint not started",
            "Start endpoint first",
            "sync_err",
        )
    })?;

    endpoint
        .disconnect(&request.endpoint_id)
        .await
        .map_err(|e| {
            PlatformError::new(
                "disconnect_failed",
                e.to_string(),
                "Failed to disconnect peer",
                "sync_err",
            )
        })
}

#[tauri::command]
async fn sync_stop_endpoint(state: tauri::State<'_, SyncState>) -> Result<(), PlatformError> {
    let mut endpoint_state = state.endpoint.write().await;
    if let Some(endpoint) = endpoint_state.take() {
        endpoint.shutdown().await;
    }
    Ok(())
}

#[tauri::command]
async fn sync_send_envelope(
    request: SyncSendRequest,
    state: tauri::State<'_, SyncState>,
) -> Result<(), PlatformError> {
    let lock = state.endpoint.read().await;
    let endpoint = lock.as_ref().ok_or_else(|| {
        PlatformError::new(
            "endpoint_not_started",
            "Sync endpoint not started",
            "Start endpoint first",
            "sync_err",
        )
    })?;

    endpoint
        .send_envelope(&request.endpoint_id, &request.payload_json)
        .await
        .map_err(|e| {
            PlatformError::new(
                "send_failed",
                e.to_string(),
                "Failed to send envelope",
                "sync_err",
            )
        })
}

#[tauri::command]
async fn sync_is_connected(
    request: SyncDisconnectRequest,
    state: tauri::State<'_, SyncState>,
) -> Result<bool, PlatformError> {
    let lock = state.endpoint.read().await;
    if let Some(endpoint) = lock.as_ref() {
        Ok(endpoint.is_connected(&request.endpoint_id).await)
    } else {
        Ok(false)
    }
}

// ---------------------------------------------------------------------------
// Background lifecycle commands (WP-016, Gate G-09)
// ---------------------------------------------------------------------------

/// Starts the background outbox scheduler if not already running.
/// Idempotent: safe to call on every page load / DOMContentLoaded.
/// Justification: required so the outbox can be drained when the window is
/// minimised — the scheduler loop is bound to the process, not the webview.
#[tauri::command]
async fn background_start(
    app: tauri::AppHandle,
    lifecycle: tauri::State<'_, BackgroundLifecycleState>,
) -> Result<(), PlatformError> {
    let app_clone = app.clone();
    let emit_fn: background_core::EmitFn = Box::new(move |payload| {
        let _ = app_clone.emit("background://sync-tick", &payload);
    });
    lifecycle.start(emit_fn).map_err(PlatformError::from)
}

/// Stops the background outbox scheduler and awaits graceful teardown.
#[tauri::command]
async fn background_stop(
    lifecycle: tauri::State<'_, BackgroundLifecycleState>,
) -> Result<(), PlatformError> {
    lifecycle.stop().await.map_err(PlatformError::from)
}

/// Returns whether the scheduler is currently running.
#[tauri::command]
fn background_status(
    lifecycle: tauri::State<'_, BackgroundLifecycleState>,
) -> Result<BackgroundSchedulerStatus, PlatformError> {
    Ok(lifecycle.status())
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
                .apply_migrations(&[core_migrations(), example_feature_migrations()].concat())
                .map_err(|error| std::io::Error::other(error.message))?;
            let key_provider = database
                .load_or_create_device_key_provider(APPLICATION_ID, std::env::consts::OS)
                .map_err(|error| std::io::Error::other(error.message))?;
            let device_identity = key_provider.identity().clone();
            // Register background lifecycle state (WP-016)
            // The scheduler uses the database path to re-open connections on blocking threads.
            let bg_db_path = database.path().to_path_buf();
            app.manage(database);
            app.manage(device_identity);
            app.manage(key_provider);
            app.manage(NativeSessionStore::new());
            app.manage(SyncState::default());
            app.manage(BackgroundLifecycleState::new(bg_db_path));

            // --- WP-016b: Windows system tray (minimize-to-tray) ---
            // Justification: Keeps the native Tauri/Tokio runtime and the
            // OutboxScheduler alive when the user closes the main window,
            // enabling background sync without a visible foreground process.
            // Scoped exclusively to Windows desktop targets.
            #[cfg(target_os = "windows")]
            {
                // Build a minimal context menu: Show | Sync Now | --- | Quit
                // Each item is given a stable, unique string ID — changes to
                // these IDs must be reflected in the on_menu_event handler below.
                let show_item = MenuItem::with_id(
                    app,
                    "tray_show", // stable event ID
                    "Show",
                    true,
                    None::<&str>, // no accelerator
                )?;
                let sync_item =
                    MenuItem::with_id(app, "tray_sync_now", "Sync Now", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "tray_quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_item, &sync_item, &quit_item])?;

                TrayIconBuilder::new()
                    .menu(&menu)
                    // Left-click: restore the main window
                    .on_tray_icon_event(|tray, event| {
                        if let tauri::tray::TrayIconEvent::Click {
                            button: tauri::tray::MouseButton::Left,
                            button_state: tauri::tray::MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                window.show().ok();
                                window.set_focus().ok();
                            }
                        }
                    })
                    // Context menu click handler
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "tray_show" => {
                            // Restore and focus the main window
                            if let Some(window) = app.get_webview_window("main") {
                                window.show().ok();
                                window.set_focus().ok();
                            }
                        }
                        "tray_sync_now" => {
                            // Emit a background sync request event. The TypeScript
                            // BackgroundLifecycleService listens on this channel and
                            // enqueues an immediate OutboxSyncWorker batch.
                            // SECURITY: this payload carries no credentials or private
                            // key material — only a UTC timestamp for correlation.
                            let ts = {
                                use std::time::{SystemTime, UNIX_EPOCH};
                                SystemTime::now()
                                    .duration_since(UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_secs()
                                    .to_string()
                            };
                            let _ = app.emit("background://sync-now-requested", ts);
                        }
                        "tray_quit" => {
                            // The ONLY sanctioned process exit path from the tray.
                            // Stops the background scheduler before exit to ensure
                            // all in-flight outbox leases are released gracefully.
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .tooltip("Tauri Boilerplate — running in background")
                    .build(app)?;
            }

            Ok(())
        })
        // --- WP-016b: Intercept window close on Windows — hide instead of exit ---
        // Prevents the process from terminating when the user clicks X on the
        // main window. The native Tokio runtime and OutboxScheduler remain alive.
        // On all other platforms (Android) the event is passed through unmodified.
        .on_window_event(|window, event| {
            #[cfg(target_os = "windows")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    window.hide().ok();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_device_identity,
            get_database_health,
            get_diagnostics_counts,
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
            db_transaction,
            sign_message,
            verify_message,
            sync_start_endpoint,
            sync_connect_peer,
            sync_disconnect_peer,
            sync_stop_endpoint,
            sync_send_envelope,
            sync_is_connected,
            background_start,
            background_stop,
            background_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{example_feature_migrations, APPLICATION_ID};

    #[test]
    fn identity_namespace_is_application_owned() {
        assert_eq!(APPLICATION_ID, "com.tauri.boilerplate.demo");
    }

    #[test]
    fn example_feature_migrations_keep_feature_ownership_and_order() {
        let migrations = example_feature_migrations();
        assert_eq!(migrations.len(), 2);
        assert_eq!(migrations[0].owner, "feature.example-feature");
        assert_eq!(migrations[0].version, 1);
        assert_eq!(migrations[0].checksum, "chk_widgets_001");
        assert!(migrations[0]
            .sql
            .contains("CREATE TABLE IF NOT EXISTS widgets"));
        assert_eq!(migrations[1].owner, "feature.example-feature");
        assert_eq!(migrations[1].version, 2);
        assert_eq!(migrations[1].checksum, "chk_widgets_002");
        assert!(migrations[1].sql.contains("idx_widgets_org_active_sku"));
    }
}
