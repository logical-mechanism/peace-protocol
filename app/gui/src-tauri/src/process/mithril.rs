use crate::config::AppConfig;
use crate::process::manager::NodeManager;
use serde::Serialize;
use std::path::Path;
use tauri::Emitter;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// Progress of a Mithril bootstrap operation
#[derive(Clone, Serialize)]
pub struct MithrilProgress {
    pub stage: MithrilStage,
    pub progress_percent: f64,
    pub bytes_downloaded: u64,
    pub total_bytes: u64,
    pub message: String,
}

/// Stages of the Mithril bootstrap process
#[derive(Clone, Serialize, PartialEq)]
#[allow(dead_code)] // Converting is set by frontend via NodeContext; Rust only serializes it
pub enum MithrilStage {
    FetchingSnapshot,
    Downloading,
    Verifying,
    Extracting,
    Converting,
    Complete,
}

/// Fetch the latest CardanoDatabase snapshot hash from the Mithril aggregator API.
/// The v2 /artifact/cardano-database endpoint returns an array with a "hash" field.
async fn fetch_latest_digest(aggregator_url: &str) -> Result<String, String> {
    let url = format!("{}/artifact/cardano-database", aggregator_url);
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("Failed to query Mithril aggregator: {e}"))?;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Mithril snapshot list: {e}"))?;
    let digest = json
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|snap| snap.get("hash"))
        .and_then(|d| d.as_str())
        .ok_or_else(|| "No snapshots available from Mithril aggregator".to_string())?;
    Ok(digest.to_string())
}

/// Start a Mithril bootstrap download.
/// Fetches the latest snapshot digest, then spawns mithril-client to download it.
/// Uses v2 backend (default) with --include-ancillary to download the ledger state
/// snapshot, avoiding a slow replay when the node starts.
pub async fn start_mithril_bootstrap(
    manager: &NodeManager,
    app_config: &AppConfig,
    app_data_dir: &Path,
) -> Result<(), String> {
    let db_dir = app_config.node_db_dir(app_data_dir);
    std::fs::create_dir_all(&db_dir).map_err(|e| format!("Failed to create node db dir: {e}"))?;

    let digest = fetch_latest_digest(app_config.mithril_aggregator_url()).await?;

    let args = vec![
        "cardano-db".to_string(),
        "download".to_string(),
        digest,
        "--include-ancillary".to_string(),
        "--ancillary-verification-key".to_string(),
        app_config.mithril_ancillary_vkey().to_string(),
        "--aggregator-endpoint".to_string(),
        app_config.mithril_aggregator_url().to_string(),
        "--genesis-verification-key".to_string(),
        app_config.mithril_genesis_vkey().to_string(),
        "--download-dir".to_string(),
        db_dir.to_string_lossy().into(),
        "--json".to_string(),
    ];

    manager
        .start("mithril-client", "mithril-client", args)
        .await
}

/// Convert the downloaded InMemory ledger snapshot to LMDB format.
/// Mithril only distributes snapshots in InMemory format; this post-download
/// conversion enables disk-backed ledger storage (much lower RAM usage).
///
/// Unlike `start_mithril_bootstrap` (fire-and-forget via NodeManager), this
/// spawns the sidecar directly and blocks until the process exits.  This
/// ensures the frontend `invoke('convert_ledger_to_lmdb')` promise only
/// resolves once conversion is truly finished.
pub async fn convert_to_lmdb(
    app_handle: &tauri::AppHandle,
    app_config: &AppConfig,
    app_data_dir: &Path,
) -> Result<(), String> {
    let db_dir = app_config.node_db_dir(app_data_dir);
    let network = app_config.network.to_string();

    let args = vec![
        "tools".to_string(),
        "utxo-hd".to_string(),
        "snapshot-converter".to_string(),
        "--db-directory".to_string(),
        db_dir.to_string_lossy().into(),
        "--cardano-node-version".to_string(),
        "latest".to_string(),
        "--cardano-network".to_string(),
        network,
        "--utxo-hd-flavor".to_string(),
        "LMDB".to_string(),
        "--commit".to_string(),
        "--json".to_string(),
    ];

    let shell = app_handle.shell();
    let command = shell
        .sidecar("mithril-client")
        .map_err(|e| format!("Failed to create mithril-client sidecar: {e}"))?;
    let command = command.args(args);

    let (mut rx, _child) = command
        .spawn()
        .map_err(|e| format!("Failed to spawn mithril-client converter: {e}"))?;

    let mut stderr_lines = Vec::new();

    // Read events until the process terminates (blocks the async fn).
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(data) => {
                let line = String::from_utf8_lossy(&data).trim().to_string();
                if !line.is_empty() {
                    // Try to parse JSON progress and emit to frontend
                    if let Some(progress) = parse_mithril_output(&line) {
                        let _ = app_handle.emit("mithril-progress", &progress);
                    }
                }
            }
            CommandEvent::Stderr(data) => {
                let line = String::from_utf8_lossy(&data).trim().to_string();
                if !line.is_empty() {
                    eprintln!("[mithril-converter] {line}");
                    stderr_lines.push(line);
                }
            }
            CommandEvent::Error(err) => {
                return Err(format!("mithril-client converter error: {err}"));
            }
            CommandEvent::Terminated(payload) => {
                if payload.code != Some(0) {
                    let stderr = stderr_lines.join("\n");
                    return Err(format!(
                        "mithril-client converter exited with code {:?}: {}",
                        payload.code, stderr
                    ));
                }
                break;
            }
            _ => {}
        }
    }

    Ok(())
}

/// Parse JSON progress output from mithril-client v2.
///
/// mithril-client v2 outputs three kinds of JSON lines:
///
/// 1. **Download progress** (stderr):
///    `{"label":"Ancillary","bytes_downloaded":N,"bytes_total":N,...}`
///
/// 2. **Step messages** (stderr):
///    `{"step_num":4,"total_steps":7,"message":"Downloading and verifying digests…"}`
///
/// 3. **Completion** (stdout):
///    `{"db_directory":"...","snapshot_converter_cmd_to_lmdb":"..."}`
///
/// Returns None if the line is not parseable as progress.
pub fn parse_mithril_output(line: &str) -> Option<MithrilProgress> {
    let json: serde_json::Value = serde_json::from_str(line).ok()?;

    // Format 3: final completion JSON (stdout) — has "db_directory"
    if json.get("db_directory").is_some() {
        return Some(MithrilProgress {
            stage: MithrilStage::Complete,
            progress_percent: 100.0,
            bytes_downloaded: 0,
            total_bytes: 0,
            message: "Download complete".to_string(),
        });
    }

    // Format 1: download progress bars — has "label" + "bytes_downloaded"
    if let Some(label) = json.get("label").and_then(|v| v.as_str()) {
        let downloaded = json
            .get("bytes_downloaded")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let total = json
            .get("bytes_total")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let percent = if total > 0 {
            (downloaded as f64 / total as f64) * 100.0
        } else {
            0.0
        };
        return Some(MithrilProgress {
            stage: MithrilStage::Downloading,
            progress_percent: percent,
            bytes_downloaded: downloaded,
            total_bytes: total,
            message: format!("Downloading {label}"),
        });
    }

    // Format 2: step messages — has "step_num" + "total_steps" + "message"
    if let Some(step_num) = json.get("step_num").and_then(|v| v.as_u64()) {
        let total_steps = json
            .get("total_steps")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let message = json
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let percent = if total_steps > 0 {
            (step_num as f64 / total_steps as f64) * 100.0
        } else {
            0.0
        };
        let msg_lower = message.to_lowercase();
        let stage = if msg_lower.contains("verif")
            || msg_lower.contains("certif")
            || msg_lower.contains("computing")
            || msg_lower.contains("signature")
        {
            MithrilStage::Verifying
        } else if msg_lower.contains("unpack") || msg_lower.contains("extract") {
            MithrilStage::Extracting
        } else if msg_lower.contains("download") {
            MithrilStage::Downloading
        } else {
            MithrilStage::FetchingSnapshot
        };
        return Some(MithrilProgress {
            stage,
            progress_percent: percent,
            bytes_downloaded: 0,
            total_bytes: 0,
            message,
        });
    }

    None
}

/// Check whether Mithril bootstrap is needed (no chain data directory or it's empty)
pub fn needs_bootstrap(app_config: &AppConfig, app_data_dir: &Path) -> bool {
    !super::cardano::has_chain_data(app_config, app_data_dir)
}
