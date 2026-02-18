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

/// Disk usage info for the app data directory
#[derive(serde::Serialize)]
pub struct DiskUsage {
    pub chain_data_bytes: u64,
    pub snark_data_bytes: u64,
    pub wallet_bytes: u64,
    pub total_bytes: u64,
    pub data_dir: String,
}

/// Get disk usage for chain data, SNARK files, and wallet
#[tauri::command]
pub fn get_disk_usage(app_handle: tauri::AppHandle) -> Result<DiskUsage, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let config = app_handle.state::<AppConfig>();
    let chain_dir = app_data_dir.join(config.network.to_string());
    let snark_dir = app_data_dir.join("snark");
    let wallet_path = app_data_dir.join("wallet.json");

    let chain_data_bytes = dir_size(&chain_dir);
    let snark_data_bytes = dir_size(&snark_dir);
    let wallet_bytes = wallet_path.metadata().map(|m| m.len()).unwrap_or(0);
    let total_bytes = chain_data_bytes + snark_data_bytes + wallet_bytes;

    Ok(DiskUsage {
        chain_data_bytes,
        snark_data_bytes,
        wallet_bytes,
        total_bytes,
        data_dir: app_data_dir.to_string_lossy().into(),
    })
}

/// Recursively compute directory size in bytes
fn dir_size(path: &std::path::Path) -> u64 {
    if !path.exists() {
        return 0;
    }
    std::fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter_map(|e| {
                    let meta = e
                        .metadata()
                        .or_else(|_| std::fs::metadata(e.path()))
                        .ok()?;
                    Some(if meta.is_dir() {
                        dir_size(&e.path())
                    } else {
                        meta.len()
                    })
                })
                .sum()
        })
        .unwrap_or(0)
}
