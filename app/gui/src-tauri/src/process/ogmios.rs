use crate::config::AppConfig;
use crate::process::manager::NodeManager;
use std::path::Path;

/// Build Ogmios command-line arguments
pub fn build_ogmios_args(app_config: &AppConfig, app_data_dir: &Path) -> Vec<String> {
    let socket = app_config.node_socket_path(app_data_dir);
    let config_json = app_config.config_dir(app_data_dir).join("config.json");

    vec![
        "--node-socket".to_string(),
        socket.to_string_lossy().into(),
        "--node-config".to_string(),
        config_json.to_string_lossy().into(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        app_config.ogmios_port.to_string(),
    ]
}

/// Start Ogmios via NodeManager
pub async fn start_ogmios(
    manager: &NodeManager,
    app_config: &AppConfig,
    app_data_dir: &Path,
) -> Result<(), String> {
    let args = build_ogmios_args(app_config, app_data_dir);
    manager.start("ogmios", "ogmios", args).await
}

/// Health check: GET http://127.0.0.1:{port}/health
/// Returns true if Ogmios responds with a 200 status.
pub async fn health_check(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{}/health", port);
    match reqwest::get(&url).await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

/// Query chain sync progress from the Ogmios health endpoint.
/// Returns the networkSynchronization value (0.0 to 1.0).
/// The /health response includes:
/// { "networkSynchronization": 0.9999, "currentEra": "Conway", ... }
pub async fn get_sync_progress(port: u16) -> Result<f64, String> {
    let url = format!("http://127.0.0.1:{}/health", port);
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("Ogmios health request failed: {e}"))?;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ogmios health response: {e}"))?;
    json["networkSynchronization"]
        .as_f64()
        .ok_or_else(|| "Missing networkSynchronization in Ogmios health response".to_string())
}

/// Get chain tip info from the Ogmios health endpoint.
/// Returns (slot, block_height) if available.
pub async fn get_tip_info(port: u16) -> Result<(u64, u64), String> {
    let url = format!("http://127.0.0.1:{}/health", port);
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("Ogmios health request failed: {e}"))?;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ogmios health response: {e}"))?;

    let tip = &json["lastKnownTip"];
    let slot = tip["slot"].as_u64().unwrap_or(0);
    let height = tip["height"].as_u64().unwrap_or(0);
    Ok((slot, height))
}
