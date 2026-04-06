use crate::config::AppConfig;
use crate::process::manager::NodeManager;
use std::path::Path;

/// Build Kupo command-line arguments.
///
/// Kupo connects through Ogmios (WebSocket) instead of directly to the node socket.
/// This avoids opening multiple concurrent chain-sync connections to cardano-node,
/// which can deadlock the node's mini-protocol multiplexer.
/// With this approach, only Ogmios holds a direct node socket connection.
pub fn build_kupo_args(
    app_config: &AppConfig,
    app_data_dir: &Path,
    match_patterns: &[String],
) -> Vec<String> {
    let kupo_dir = app_config.kupo_db_dir(app_data_dir);

    let mut args = vec![
        "--ogmios-host".to_string(),
        "127.0.0.1".to_string(),
        "--ogmios-port".to_string(),
        app_config.ogmios_port.to_string(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        app_config.kupo_port.to_string(),
        "--workdir".to_string(),
        kupo_dir.to_string_lossy().into(),
        "--since".to_string(),
        app_config
            .kupo_since
            .as_deref()
            .unwrap_or("origin")
            .to_string(),
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

    manager.ensure_port_available(app_config.kupo_port)?;

    let args = build_kupo_args(app_config, app_data_dir, &patterns);
    manager
        .start_sidecar("kupo", "kupo", args, None, true)
        .await
}

/// Health check: GET http://127.0.0.1:{port}/health
/// Returns true if Kupo responds (any 200-range status).
pub async fn health_check(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{}/health", port);
    match reqwest::get(&url).await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

/// Parsed Kupo metrics from the /metrics endpoint (Prometheus text format).
///
/// Kupo v2.11 /metrics always returns 200 OK and provides:
///   kupo_most_recent_checkpoint  115706396    (latest slot Kupo has indexed)
///   kupo_most_recent_node_tip  115706396      (node's current tip slot)
///   kupo_connection_status  1.0               (1.0 = connected to node, 0.0 = disconnected)
///   kupo_seconds_since_last_block  2.0        (time since Kupo last ingested a block)
///   kupo_network_synchronization  0.98619     (node chain sync progress; fallback for early startup)
#[derive(Debug, Clone)]
pub struct KupoMetrics {
    /// Kupo indexing progress: checkpoint / node_tip (0.0–1.0).
    pub sync_progress: f64,
    /// Whether Kupo is connected to the cardano-node (from kupo_connection_status).
    pub connected: bool,
    /// Seconds since Kupo last ingested a block. High values indicate a stall.
    pub seconds_since_last_block: f64,
}

/// Query Kupo metrics from its /metrics endpoint (Kupo v2.11+).
///
/// Returns `KupoMetrics` with indexing progress, connection status, and stall detection.
/// The /metrics endpoint always returns 200 OK, making it more reliable than /health.
///
/// We use checkpoint/node_tip as the primary sync progress metric (Kupo's actual
/// indexing progress). Falls back to kupo_network_synchronization during early startup
/// before checkpoint/node_tip appear in the metrics output.
pub async fn get_metrics(port: u16) -> Result<KupoMetrics, String> {
    let url = format!("http://127.0.0.1:{}/metrics", port);
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("Kupo metrics request failed: {e}"))?;

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read Kupo metrics response body: {e}"))?;

    parse_kupo_metrics(&body)
}

/// Parse Prometheus-format metrics text into KupoMetrics.
fn parse_kupo_metrics(body: &str) -> Result<KupoMetrics, String> {
    let mut checkpoint: Option<f64> = None;
    let mut node_tip: Option<f64> = None;
    let mut connection_status: Option<f64> = None;
    let mut seconds_since_last_block: Option<f64> = None;
    let mut network_sync: Option<f64> = None;

    for line in body.lines() {
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        // Prometheus format: "metric_name  value" (whitespace separated)
        if let Some(v) = line.strip_prefix("kupo_most_recent_checkpoint") {
            checkpoint = v.trim().parse().ok();
        } else if let Some(v) = line.strip_prefix("kupo_most_recent_node_tip") {
            node_tip = v.trim().parse().ok();
        } else if let Some(v) = line.strip_prefix("kupo_connection_status") {
            connection_status = v.trim().parse().ok();
        } else if let Some(v) = line.strip_prefix("kupo_seconds_since_last_block") {
            seconds_since_last_block = v.trim().parse().ok();
        } else if let Some(v) = line.strip_prefix("kupo_network_synchronization") {
            network_sync = v.trim().parse().ok();
        }
    }

    // Primary: checkpoint / node_tip (Kupo's actual indexing progress).
    // Fallback: kupo_network_synchronization (available during early startup before
    // checkpoint/node_tip appear in metrics — tracks node chain sync, not indexing).
    // Last resort: 0.0 (metrics not yet populated — don't return Err so we
    // preserve connection_status and seconds_since_last_block for the caller).
    let sync_progress = match (checkpoint, node_tip) {
        (Some(cp), Some(tip)) if tip > 0.0 => (cp / tip).min(1.0),
        _ => network_sync.map(|ns| ns.clamp(0.0, 1.0)).unwrap_or(0.0),
    };

    Ok(KupoMetrics {
        sync_progress,
        connected: connection_status.map(|v| v >= 1.0).unwrap_or(false),
        seconds_since_last_block: seconds_since_last_block.unwrap_or(0.0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_full_metrics() {
        let body = "\
# TYPE kupo_configuration_indexes gauge
kupo_configuration_indexes  1.0

# TYPE kupo_connection_status gauge
kupo_connection_status  1.0

# TYPE kupo_most_recent_checkpoint counter
kupo_most_recent_checkpoint  61264845

# TYPE kupo_most_recent_node_tip counter
kupo_most_recent_node_tip  82838775

# TYPE kupo_network_synchronization gauge
kupo_network_synchronization  0.73956

# TYPE kupo_seconds_since_last_block gauge
kupo_seconds_since_last_block  2.0
";
        let metrics = parse_kupo_metrics(body).unwrap();
        // Uses checkpoint/node_tip as primary source (not kupo_network_synchronization)
        assert!((metrics.sync_progress - 61264845.0 / 82838775.0).abs() < 0.0001);
        assert!(metrics.connected);
        assert!((metrics.seconds_since_last_block - 2.0).abs() < 0.001);
    }

    #[test]
    fn parse_disconnected() {
        let body = "\
kupo_connection_status  0.0
kupo_most_recent_checkpoint  1000
kupo_most_recent_node_tip  2000
kupo_network_synchronization  0.5
kupo_seconds_since_last_block  300.0
";
        let metrics = parse_kupo_metrics(body).unwrap();
        assert!(!metrics.connected);
        assert!((metrics.seconds_since_last_block - 300.0).abs() < 0.001);
        assert!((metrics.sync_progress - 0.5).abs() < 0.001);
    }

    #[test]
    fn parse_node_tip_zero() {
        let body = "\
kupo_connection_status  1.0
kupo_most_recent_checkpoint  0
kupo_most_recent_node_tip  0
kupo_network_synchronization  0.0
kupo_seconds_since_last_block  0.0
";
        let metrics = parse_kupo_metrics(body).unwrap();
        assert_eq!(metrics.sync_progress, 0.0);
    }

    #[test]
    fn parse_network_sync_only() {
        // Early startup: only network_synchronization is available,
        // checkpoint and node_tip not yet reported
        let body = "\
kupo_connection_status  0.0
kupo_network_synchronization  0.42
";
        let metrics = parse_kupo_metrics(body).unwrap();
        assert!((metrics.sync_progress - 0.42).abs() < 0.001);
        assert!(!metrics.connected);
    }

    #[test]
    fn parse_fallback_to_checkpoint_ratio() {
        // Pre-v2.11 Kupo or missing network_synchronization:
        // falls back to checkpoint / node_tip
        let body = "\
kupo_connection_status  1.0
kupo_most_recent_checkpoint  1000
kupo_most_recent_node_tip  2000
kupo_seconds_since_last_block  5.0
";
        let metrics = parse_kupo_metrics(body).unwrap();
        assert!((metrics.sync_progress - 0.5).abs() < 0.001);
    }

    #[test]
    fn parse_minimal_metrics() {
        // Very early startup: only connection_status present
        let body = "\
kupo_connection_status  1.0
";
        let metrics = parse_kupo_metrics(body).unwrap();
        assert_eq!(metrics.sync_progress, 0.0);
        assert!(metrics.connected);
    }

    #[test]
    fn parse_synced() {
        let body = "\
kupo_connection_status  1.0
kupo_most_recent_checkpoint  82838775
kupo_most_recent_node_tip  82838775
kupo_network_synchronization  1.0
kupo_seconds_since_last_block  1.0
";
        let metrics = parse_kupo_metrics(body).unwrap();
        assert!((metrics.sync_progress - 1.0).abs() < 0.001);
    }
}
