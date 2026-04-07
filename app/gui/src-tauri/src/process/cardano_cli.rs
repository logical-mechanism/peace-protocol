use crate::config::{AppConfig, Network};
use crate::MaxCores;
use serde::Deserialize;
use std::path::Path;
use tauri::Manager;

/// Parsed response from `cardano-cli conway query tip --output-json`.
#[derive(Debug, Clone, Deserialize)]
pub struct CardanoCliTip {
    pub block: u64,
    pub epoch: u64,
    pub era: String,
    #[allow(dead_code)]
    pub hash: String,
    pub slot: u64,
    #[serde(rename = "slotInEpoch")]
    pub slot_in_epoch: u64,
    #[serde(rename = "slotsToEpochEnd")]
    pub slots_to_epoch_end: u64,
    /// Sync progress as a percentage string, e.g. "99.30".
    #[serde(rename = "syncProgress")]
    pub sync_progress: String,
}

impl CardanoCliTip {
    /// Parse the syncProgress string ("99.30") into a 0.0–1.0 float.
    pub fn sync_progress_f64(&self) -> f64 {
        self.sync_progress
            .parse::<f64>()
            .map(|v| (v / 100.0).clamp(0.0, 1.0))
            .unwrap_or(0.0)
    }
}

/// Build CLI args for `cardano-cli conway query tip`.
fn build_query_tip_args(app_config: &AppConfig, app_data_dir: &Path) -> Vec<String> {
    let socket = app_config.node_socket_path(app_data_dir);
    let mut args = vec![
        "conway".to_string(),
        "query".to_string(),
        "tip".to_string(),
        "--socket-path".to_string(),
        socket.to_string_lossy().to_string(),
        "--output-json".to_string(),
    ];

    match app_config.network {
        Network::Preprod => {
            args.push("--testnet-magic".to_string());
            args.push("1".to_string());
        }
        Network::Mainnet => {
            args.push("--mainnet".to_string());
        }
    }

    args
}

/// Query the local cardano-node tip via the cardano-cli sidecar.
///
/// Returns `Ok(CardanoCliTip)` with block, epoch, era, slot, and sync progress.
/// Returns `Err` if the socket doesn't exist, the query times out (10s), or parsing fails.
///
/// IMPORTANT: On timeout, the child process is explicitly killed to prevent
/// zombie cardano-cli processes from accumulating and exhausting the node socket
/// connection backlog.
pub async fn query_tip(
    app_handle: &tauri::AppHandle,
    app_config: &AppConfig,
    app_data_dir: &Path,
) -> Result<CardanoCliTip, String> {
    // Fail fast if socket doesn't exist
    let socket_path = app_config.node_socket_path(app_data_dir);
    if !socket_path.exists() {
        return Err("Node socket does not exist yet".to_string());
    }

    let args = build_query_tip_args(app_config, app_data_dir);
    let max_cores = app_handle.state::<MaxCores>().0;

    // Spawn sidecar — get a Command, then spawn to get a Child handle we can kill on timeout.
    use crate::process::manager::spawn_clean_sidecar;
    let mut cmd = spawn_clean_sidecar("binaries/cardano-cli", &args, max_cores)
        .map_err(|e| format!("Failed to create cardano-cli command: {e}"))?;

    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn cardano-cli: {e}"))?;

    // Wait for output with 10s timeout.
    // If the timeout fires, we MUST kill the child process — otherwise it stays alive
    // holding a socket connection to cardano-node. With 5s polling, these accumulate
    // and exhaust the node socket backlog (~60 connections), blocking all new connections.
    //
    // We grab the PID before wait_with_output (which consumes child) so we can
    // kill the process by PID if the timeout fires.
    let child_pid = child.id();

    match tokio::time::timeout(std::time::Duration::from_secs(10), child.wait_with_output()).await {
        Ok(Ok(output)) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!(
                    "cardano-cli exited with code {:?}: {}",
                    output.status.code(),
                    stderr.trim()
                ));
            }
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            serde_json::from_str::<CardanoCliTip>(&stdout)
                .map_err(|e| format!("Failed to parse cardano-cli tip JSON: {e}"))
        }
        Ok(Err(e)) => Err(format!("Failed to run cardano-cli: {e}")),
        Err(_) => {
            // Timeout — kill the child process by PID to free the socket connection.
            if let Some(pid) = child_pid {
                unsafe {
                    libc::kill(pid as i32, libc::SIGKILL);
                }
            }
            Err("cardano-cli query tip timed out after 10s".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_tip_json() {
        let json = r#"{
            "block": 4433699,
            "epoch": 271,
            "era": "Conway",
            "hash": "e8c327072ecda6e028aa80ffa36df125c4c9dfc1bfcce6fbb56b5daa4c728451",
            "slot": 115719059,
            "slotInEpoch": 288659,
            "slotsToEpochEnd": 143341,
            "syncProgress": "99.30"
        }"#;
        let tip: CardanoCliTip = serde_json::from_str(json).unwrap();
        assert_eq!(tip.block, 4433699);
        assert_eq!(tip.epoch, 271);
        assert_eq!(tip.era, "Conway");
        assert_eq!(tip.slot, 115719059);
        assert_eq!(tip.slot_in_epoch, 288659);
        assert_eq!(tip.slots_to_epoch_end, 143341);
        assert!((tip.sync_progress_f64() - 0.993).abs() < 0.001);
    }

    #[test]
    fn sync_progress_100() {
        let json = r#"{
            "block": 5000000, "epoch": 300, "era": "Conway",
            "hash": "abc", "slot": 120000000, "slotInEpoch": 0,
            "slotsToEpochEnd": 432000, "syncProgress": "100.00"
        }"#;
        let tip: CardanoCliTip = serde_json::from_str(json).unwrap();
        assert!((tip.sync_progress_f64() - 1.0).abs() < 0.001);
    }

    #[test]
    fn sync_progress_zero() {
        let json = r#"{
            "block": 0, "epoch": 0, "era": "Byron",
            "hash": "abc", "slot": 0, "slotInEpoch": 0,
            "slotsToEpochEnd": 0, "syncProgress": "0.00"
        }"#;
        let tip: CardanoCliTip = serde_json::from_str(json).unwrap();
        assert_eq!(tip.sync_progress_f64(), 0.0);
    }

    #[test]
    fn sync_progress_invalid_string() {
        let json = r#"{
            "block": 0, "epoch": 0, "era": "",
            "hash": "", "slot": 0, "slotInEpoch": 0,
            "slotsToEpochEnd": 0, "syncProgress": "not_a_number"
        }"#;
        let tip: CardanoCliTip = serde_json::from_str(json).unwrap();
        assert_eq!(tip.sync_progress_f64(), 0.0);
    }

    #[test]
    fn build_args_preprod() {
        let config = AppConfig::default();
        let args = build_query_tip_args(&config, Path::new("/tmp/test"));
        assert!(args.contains(&"conway".to_string()));
        assert!(args.contains(&"query".to_string()));
        assert!(args.contains(&"tip".to_string()));
        assert!(args.contains(&"--testnet-magic".to_string()));
        assert!(args.contains(&"1".to_string()));
        assert!(args.contains(&"--output-json".to_string()));
        assert!(args.contains(&"--socket-path".to_string()));
    }

    #[test]
    fn build_args_mainnet() {
        let mut config = AppConfig::default();
        config.network = Network::Mainnet;
        let args = build_query_tip_args(&config, Path::new("/tmp/test"));
        assert!(args.contains(&"--mainnet".to_string()));
        assert!(!args.contains(&"--testnet-magic".to_string()));
    }
}
