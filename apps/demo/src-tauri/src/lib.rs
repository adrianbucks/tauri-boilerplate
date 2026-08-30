use identity_core::{DeviceIdentity, KeyManager};
use native_core::PlatformError;

#[tauri::command]
fn get_device_identity(app_id: String) -> Result<DeviceIdentity, PlatformError> {
    KeyManager::get_or_create_device_identity(&app_id, std::env::consts::OS).map_err(|e| {
        PlatformError::new(
            "AUTHENTICATION_ERROR",
            format!("Failed to retrieve device identity: {e}"),
            "Unable to access device identity",
            "cmd_identity_err",
        )
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_device_identity])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
