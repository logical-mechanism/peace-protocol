use crate::config::{AppConfig, Network};
use crate::process::manager::NodeManager;
use std::path::PathBuf;

/// Build Kupo command-line arguments
pub fn build_kupo_args(
    app_config: &AppConfig,
    app_data_dir: &PathBuf,
    match_patterns: &[String],
) -> Vec<String> {
    let socket = app_config.node_socket_path(app_data_dir);
    let config_json = app_config.config_dir(app_data_dir).join("config.json");
    let kupo_dir = app_config.kupo_db_dir(app_data_dir);

    let mut args = vec![
        "--node-socket".to_string(),
        socket.to_string_lossy().into(),
        "--node-config".to_string(),
        config_json.to_string_lossy().into(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        app_config.kupo_port.to_string(),
        "--workdir".to_string(),
        kupo_dir.to_string_lossy().into(),
        "--since".to_string(),
        "origin".to_string(),
    ];

    for pattern in match_patterns {
        args.push("--match".to_string());
        args.push(pattern.clone());
    }

    args
}

/// Get the default match patterns for the PEACE Protocol contracts.
/// These are the contract/script addresses that Kupo should index.
/// The wildcard "*" pattern indexes everything (useful for development).
pub fn default_match_patterns(network: &Network) -> Vec<String> {
    match network {
        Network::Preprod => {
            // For now, use wildcard to index all addresses.
            // In production, narrow this to specific contract addresses + user wallet.
            vec!["*".to_string()]
        }
        Network::Mainnet => {
            vec!["*".to_string()]
        }
    }
}

/// Start Kupo via NodeManager
pub async fn start_kupo(
    manager: &NodeManager,
    app_config: &AppConfig,
    app_data_dir: &PathBuf,
    extra_patterns: &[String],
) -> Result<(), String> {
    let kupo_dir = app_config.kupo_db_dir(app_data_dir);
    std::fs::create_dir_all(&kupo_dir)
        .map_err(|e| format!("Failed to create kupo db dir: {e}"))?;

    let mut patterns = default_match_patterns(&app_config.network);
    patterns.extend(extra_patterns.iter().cloned());

    let args = build_kupo_args(app_config, app_data_dir, &patterns);
    manager.start("kupo", "kupo", args).await
}

/// Health check: GET http://127.0.0.1:{port}/health
pub async fn health_check(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{}/health", port);
    match reqwest::get(&url).await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}
