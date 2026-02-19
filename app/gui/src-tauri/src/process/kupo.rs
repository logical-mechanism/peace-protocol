use crate::config::AppConfig;
use crate::process::manager::NodeManager;
use std::path::Path;

/// Build Kupo command-line arguments
pub fn build_kupo_args(
    app_config: &AppConfig,
    app_data_dir: &Path,
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

/// Build match patterns from contract addresses + wallet address.
/// Falls back to wildcard "*" only if no addresses are configured.
pub fn build_match_patterns(config: &AppConfig, wallet_address: &str) -> Vec<String> {
    let mut patterns = Vec::new();

    // Add contract addresses from config
    if let Some(ref contracts) = config.contracts {
        if !contracts.encryption_address.is_empty() {
            patterns.push(contracts.encryption_address.clone());
        }
        if !contracts.bidding_address.is_empty() {
            patterns.push(contracts.bidding_address.clone());
        }
        if !contracts.reference_address.is_empty() {
            patterns.push(contracts.reference_address.clone());
        }
        if !contracts.script_reference_address.is_empty() {
            patterns.push(contracts.script_reference_address.clone());
        }
    }

    // Add wallet address
    if !wallet_address.is_empty() {
        patterns.push(wallet_address.to_string());
    }

    // Fallback: if nothing configured, use wildcard (development mode)
    if patterns.is_empty() {
        patterns.push("*".to_string());
    }

    patterns
}

/// Start Kupo via NodeManager with specific match patterns for
/// contract addresses + the user's wallet address.
/// If the match patterns changed since the last run (e.g. different wallet),
/// the Kupo DB is wiped so it re-indexes from origin with the new patterns.
pub async fn start_kupo(
    manager: &NodeManager,
    app_config: &AppConfig,
    app_data_dir: &Path,
    wallet_address: &str,
) -> Result<(), String> {
    let kupo_dir = app_config.kupo_db_dir(app_data_dir);
    let patterns = build_match_patterns(app_config, wallet_address);

    // Check if patterns changed — wipe Kupo DB if so.
    // Kupo v2.11+ refuses to start if CLI patterns differ from what's in its DB.
    // We nuke the entire workdir and recreate it to guarantee a clean state.
    let patterns_file = kupo_dir.join("match-patterns.json");
    let patterns_match = match std::fs::read_to_string(&patterns_file) {
        Ok(contents) => {
            let prev: Vec<String> = serde_json::from_str(&contents).unwrap_or_default();
            prev == patterns
        }
        Err(_) => false, // No tracking file = unknown previous state, wipe to be safe
    };

    if !patterns_match && kupo_dir.exists() {
        eprintln!(
            "Kupo match patterns changed (or first tracked run), wiping entire workdir for re-sync"
        );
        let _ = std::fs::remove_dir_all(&kupo_dir);
    }

    std::fs::create_dir_all(&kupo_dir).map_err(|e| format!("Failed to create kupo db dir: {e}"))?;

    // Save current patterns — written before start so we track what we attempted.
    // If Kupo fails for other reasons, patterns_file will match next run and skip the wipe.
    let patterns_json = serde_json::to_string(&patterns).unwrap_or_default();
    let _ = std::fs::write(&patterns_file, patterns_json);

    let args = build_kupo_args(app_config, app_data_dir, &patterns);
    manager.start("kupo", "kupo", args).await
}

/// Query Kupo sync progress from its /health endpoint.
/// Returns a value from 0.0 to 1.0 representing how far Kupo has indexed
/// relative to the node's current tip.
///
/// Kupo v2.11 returns Prometheus metrics text:
///   kupo_most_recent_checkpoint  115706396
///   kupo_most_recent_node_tip  115706396
///   kupo_network_synchronization  0.98619  (overall chain sync, NOT indexing progress)
///
/// We use checkpoint/node_tip because that tells us Kupo's indexing progress.
/// kupo_network_synchronization just mirrors the node's chain sync percentage.
pub async fn get_sync_progress(port: u16) -> Result<f64, String> {
    let url = format!("http://127.0.0.1:{}/health", port);
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("Kupo health request failed: {e}"))?;

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read Kupo health response body: {e}"))?;

    // Parse Prometheus metrics: "metric_name  value"
    let mut checkpoint: Option<f64> = None;
    let mut node_tip: Option<f64> = None;

    for line in body.lines() {
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        if let Some(v) = line.strip_prefix("kupo_most_recent_checkpoint") {
            checkpoint = v.trim().parse().ok();
        } else if let Some(v) = line.strip_prefix("kupo_most_recent_node_tip") {
            node_tip = v.trim().parse().ok();
        }
    }

    match (checkpoint, node_tip) {
        (Some(cp), Some(tip)) if tip > 0.0 => Ok((cp / tip).min(1.0)),
        (Some(_), Some(_)) => Ok(0.0), // tip is 0, node hasn't synced yet
        _ => Err("kupo_most_recent_checkpoint or kupo_most_recent_node_tip not found in Kupo health response".to_string()),
    }
}
