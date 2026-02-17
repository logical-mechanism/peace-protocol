use crate::config::{AppConfig, Network};
use tauri::Manager;

/// Get the currently configured network name
#[tauri::command]
pub fn get_network(app_handle: tauri::AppHandle) -> Result<String, String> {
    let config = app_handle.state::<AppConfig>();
    Ok(config.network.to_string())
}

/// Set the network (requires app restart to take effect)
#[tauri::command]
pub fn set_network(app_handle: tauri::AppHandle, network: String) -> Result<(), String> {
    let new_network = match network.to_lowercase().as_str() {
        "preprod" => Network::Preprod,
        "mainnet" => Network::Mainnet,
        _ => return Err(format!("Unknown network: {network}. Must be 'preprod' or 'mainnet'.")),
    };

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let mut config = AppConfig::load(&app_data_dir);
    config.network = new_network;
    config.save(&app_data_dir)?;

    Ok(())
}

/// Get the app data directory path
#[tauri::command]
pub fn get_data_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    Ok(dir.to_string_lossy().into())
}

/// Get the full app configuration
#[tauri::command]
pub fn get_app_config(app_handle: tauri::AppHandle) -> Result<AppConfig, String> {
    let config = app_handle.state::<AppConfig>();
    Ok(config.inner().clone())
}
