use crate::config::AppConfig;
use crate::process::manager::NodeManager;
use serde::Serialize;
use std::path::Path;

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
pub enum MithrilStage {
    FetchingSnapshot,
    Downloading,
    Verifying,
    Extracting,
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
///
/// 1. Fetches the latest snapshot digest from the aggregator
/// 2. Spawns `mithril-client cardano-db download` with `--include-ancillary`
///
/// When the download finishes, mithril-client exits (process status → Stopped).
/// The frontend detects this and auto-starts the node. The node uses the
/// in-memory ledger snapshots directly (`V2InMemory` backend in config.json).
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
        .start_sidecar("mithril-client", "mithril-client", args, None, false)
        .await?;

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

    // Format 1: download progress bars — has "label" + either "bytes_downloaded" or "files_downloaded"
    //
    // Two sub-formats:
    //   Files phase:     {"label":"Files","files_downloaded":N,"files_total":N,...}
    //   Ancillary phase: {"label":"Ancillary","bytes_downloaded":N,"bytes_total":N,...}
    if let Some(label) = json.get("label").and_then(|v| v.as_str()) {
        let (downloaded, total) =
            if let Some(bd) = json.get("bytes_downloaded").and_then(|v| v.as_u64()) {
                (
                    bd,
                    json.get("bytes_total")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0),
                )
            } else if let Some(fd) = json.get("files_downloaded").and_then(|v| v.as_u64()) {
                (
                    fd,
                    json.get("files_total")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0),
                )
            } else {
                (0, 0)
            };
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
