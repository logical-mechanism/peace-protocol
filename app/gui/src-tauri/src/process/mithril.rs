use crate::config::AppConfig;
use crate::process::manager::{NodeManager, ProcessStatus};
use crate::MithrilConversionPending;
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};

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

/// Start a Mithril bootstrap download followed by LMDB conversion.
///
/// 1. Fetches the latest snapshot digest from the aggregator
/// 2. Spawns `mithril-client cardano-db download` with `--include-ancillary`
/// 3. After download completes, spawns `mithril-client tools utxo-hd snapshot-converter`
///    to convert the in-memory snapshot to LMDB format
/// 4. An `MithrilConversionPending` flag prevents the node from starting during the gap
pub async fn start_mithril_bootstrap(
    manager: &NodeManager,
    app_config: &AppConfig,
    app_data_dir: &Path,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    let db_dir = app_config.node_db_dir(app_data_dir);
    std::fs::create_dir_all(&db_dir).map_err(|e| format!("Failed to create node db dir: {e}"))?;

    let digest = fetch_latest_digest(app_config.mithril_aggregator_url()).await?;

    // Set conversion-pending flag BEFORE starting download so the gap is always covered
    if let Some(flag) = app_handle.try_state::<MithrilConversionPending>() {
        flag.0.store(true, Ordering::SeqCst);
    }

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
        .await?;

    // Spawn background orchestrator: wait for download → run LMDB conversion
    let handle = app_handle.clone();
    let db_dir_owned = db_dir.to_path_buf();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run_conversion_after_download(&handle, &db_dir_owned).await {
            eprintln!("[mithril] Conversion orchestrator error: {e}");
        }
        // Always clear the flag when done (success or failure)
        if let Some(flag) = handle.try_state::<MithrilConversionPending>() {
            flag.0.store(false, Ordering::SeqCst);
        }
    });

    Ok(())
}

/// Background task: wait for download to finish, then run the LMDB converter.
///
/// After the download completes, the mithril-client outputs a completion JSON with
/// `snapshot_converter_cmd_to_lmdb` containing the exact conversion command (including
/// `--db-directory` and `--cardano-node-version`). We parse this from the log buffer
/// to get the correct args rather than guessing them.
async fn run_conversion_after_download(
    app_handle: &tauri::AppHandle,
    db_dir: &Path,
) -> Result<(), String> {
    let manager = app_handle.state::<NodeManager>();

    // Poll until the download process exits
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;

        let status = manager.get_status("mithril-client").await;
        match status {
            Some(info) => match &info.status {
                ProcessStatus::Stopped => break, // Download finished
                ProcessStatus::Error { message } => {
                    return Err(format!("Mithril download failed: {message}"));
                }
                // Still running — keep waiting
                _ => continue,
            },
            None => {
                // Process not registered yet — wait a bit more
                continue;
            }
        }
    }

    // Parse the conversion command from the completion JSON in the log buffer.
    // The completion line looks like:
    //   {"db_directory":"...","snapshot_converter_cmd_to_lmdb":"mithril-client tools ...","..."}
    let conversion_args = parse_conversion_args_from_logs(&manager, db_dir).await?;

    // Emit Converting stage to frontend
    let _ = app_handle.emit(
        "mithril-progress",
        MithrilProgress {
            stage: MithrilStage::Converting,
            progress_percent: 0.0,
            bytes_downloaded: 0,
            total_bytes: 0,
            message: "Converting snapshot to LMDB format...".to_string(),
        },
    );

    // Stop the previous mithril-client entry before starting the converter.
    // This prevents race conditions with auto-restart state.
    let _ = manager.stop("mithril-client").await;

    manager
        .start("mithril-client", "mithril-client", conversion_args)
        .await?;

    // Poll until the conversion process exits
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;

        let status = manager.get_status("mithril-client").await;
        match status {
            Some(info) => match &info.status {
                ProcessStatus::Stopped => break, // Conversion finished
                ProcessStatus::Error { message } => {
                    // Stop to prevent auto-restart loop
                    let _ = manager.stop("mithril-client").await;
                    return Err(format!("LMDB conversion failed: {message}"));
                }
                _ => continue,
            },
            None => continue,
        }
    }

    // Emit completion
    let _ = app_handle.emit(
        "mithril-progress",
        MithrilProgress {
            stage: MithrilStage::Complete,
            progress_percent: 100.0,
            bytes_downloaded: 0,
            total_bytes: 0,
            message: "Snapshot conversion complete".to_string(),
        },
    );

    Ok(())
}

/// Parse the LMDB conversion args from the mithril-client log buffer.
///
/// After a successful download, mithril-client outputs a JSON line containing
/// `snapshot_converter_cmd_to_lmdb` with the exact command string. We parse this
/// to get the correct `--db-directory` and `--cardano-node-version` args.
async fn parse_conversion_args_from_logs(
    manager: &NodeManager,
    fallback_db_dir: &Path,
) -> Result<Vec<String>, String> {
    let logs = manager.get_logs("mithril-client", 20).await;

    // Search log lines for the completion JSON
    for line in logs.iter().rev() {
        // Strip the "[mithril-client] " prefix if present (log buffer may include it)
        let json_str = line
            .strip_prefix("[mithril-client] ")
            .unwrap_or(line)
            .trim();

        if let Ok(json) = serde_json::from_str::<serde_json::Value>(json_str) {
            if let Some(cmd) = json
                .get("snapshot_converter_cmd_to_lmdb")
                .and_then(|v| v.as_str())
            {
                // Parse the command string into args, skipping "mithril-client" itself
                let args: Vec<String> = cmd
                    .split_whitespace()
                    .skip(1) // skip "mithril-client"
                    .map(String::from)
                    .collect();
                if !args.is_empty() {
                    eprintln!("[mithril] Parsed conversion command from completion JSON: {cmd}");
                    return Ok(args);
                }
            }
        }
    }

    // Fallback: construct a reasonable command if we couldn't parse the completion JSON.
    // Use the db/subdirectory (mithril v2 extracts into download-dir/db/).
    eprintln!(
        "[mithril] Warning: could not parse conversion command from logs, using fallback args"
    );
    let actual_db_dir = fallback_db_dir.join("db");
    Ok(vec![
        "tools".to_string(),
        "utxo-hd".to_string(),
        "snapshot-converter".to_string(),
        "--db-directory".to_string(),
        actual_db_dir.to_string_lossy().into(),
        "--cardano-node-version".to_string(),
        "10.6.2".to_string(),
        "--utxo-hd-flavor".to_string(),
        "LMDB".to_string(),
        "--commit".to_string(),
    ])
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
