use crate::config::{AppConfig, Network};
use tauri::Manager;

/// Get the currently configured network name
#[tauri::command]
pub fn get_network(app_handle: tauri::AppHandle) -> Result<String, String> {
    let config = app_handle.state::<AppConfig>();
    Ok(config.network.to_string())
}

/// Set the network (requires app restart to take effect).
/// Saves back to the bundled config.json in dev, or app data dir in prod.
#[tauri::command]
pub fn set_network(app_handle: tauri::AppHandle, network: String) -> Result<(), String> {
    let new_network = match network.to_lowercase().as_str() {
        "preprod" => Network::Preprod,
        "mainnet" => Network::Mainnet,
        _ => return Err(format!("Unknown network: {network}. Must be 'preprod' or 'mainnet'.")),
    };

    // Read current config, update network, and save
    let config = app_handle.state::<AppConfig>();
    let mut updated = config.inner().clone();
    updated.network = new_network;

    // Save to the dev resource file (in dev) or app data dir (in prod)
    let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/config.json");
    if dev_path.exists() {
        updated.save_to(&dev_path)?;
    } else {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
        updated.save_to(&app_data_dir.join("config.json"))?;
    }

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
