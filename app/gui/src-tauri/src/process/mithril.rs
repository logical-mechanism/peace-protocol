use crate::config::AppConfig;
use crate::process::manager::NodeManager;
use serde::Serialize;
use std::path::PathBuf;

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
    Error,
}

/// Fetch the latest snapshot digest from the Mithril aggregator API.
/// The /artifact/snapshots endpoint returns an array with a "digest" field per entry.
async fn fetch_latest_digest(aggregator_url: &str) -> Result<String, String> {
    let url = format!("{}/artifact/snapshots", aggregator_url);
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
        .and_then(|snap| snap.get("digest"))
        .and_then(|d| d.as_str())
        .ok_or_else(|| "No snapshots available from Mithril aggregator".to_string())?;
    Ok(digest.to_string())
}

/// Start a Mithril bootstrap download.
/// Fetches the latest snapshot digest, then spawns mithril-client to download it.
pub async fn start_mithril_bootstrap(
    manager: &NodeManager,
    app_config: &AppConfig,
    app_data_dir: &PathBuf,
) -> Result<(), String> {
    let db_dir = app_config.node_db_dir(app_data_dir);
    std::fs::create_dir_all(&db_dir)
        .map_err(|e| format!("Failed to create node db dir: {e}"))?;

    let digest = fetch_latest_digest(app_config.mithril_aggregator_url()).await?;

    let args = vec![
        "cardano-db".to_string(),
        "download".to_string(),
        digest,
        "--backend".to_string(),
        "v1".to_string(),
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

/// Parse JSON progress output from mithril-client.
/// When run with --json, mithril-client outputs JSON progress lines.
/// Returns None if the line is not parseable as progress.
pub fn parse_mithril_output(line: &str) -> Option<MithrilProgress> {
    let json: serde_json::Value = serde_json::from_str(line).ok()?;

    let step = json.get("step")?.as_str()?;
    let progress = json
        .get("progress")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let bytes_downloaded = json
        .get("bytes_downloaded")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let total_bytes = json
        .get("total_bytes")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let message = json
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let stage = match step {
        "fetching" | "listing" => MithrilStage::FetchingSnapshot,
        "downloading" => MithrilStage::Downloading,
        "verifying" | "certifying" => MithrilStage::Verifying,
        "unpacking" | "extracting" => MithrilStage::Extracting,
        "done" | "complete" => MithrilStage::Complete,
        _ => MithrilStage::Downloading,
    };

    Some(MithrilProgress {
        stage,
        progress_percent: progress,
        bytes_downloaded,
        total_bytes,
        message,
    })
}

/// Check whether Mithril bootstrap is needed (no chain data directory or it's empty)
pub fn needs_bootstrap(app_config: &AppConfig, app_data_dir: &PathBuf) -> bool {
    !super::cardano::has_chain_data(app_config, app_data_dir)
}
