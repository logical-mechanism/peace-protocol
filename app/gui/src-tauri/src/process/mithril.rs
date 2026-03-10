use crate::config::AppConfig;
use crate::process::cardano::CardanoNodeConfig;
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
/// 3. After download completes, runs the `snapshot-converter` binary directly
///    to convert in-memory ledger snapshots to LMDB format
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
    let app_data_dir_owned = app_data_dir.to_path_buf();
    tauri::async_runtime::spawn(async move {
        if let Err(e) =
            run_conversion_after_download(&handle, &db_dir_owned, &app_data_dir_owned).await
        {
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
/// After the download completes, we run the `snapshot-converter` binary directly
/// (from the cardano-node distribution) instead of using `mithril-client tools`
/// because mithril-client 0.12.x constructs incorrect arguments for the
/// cardano-node 10.6+ snapshot-converter CLI.
async fn run_conversion_after_download(
    app_handle: &tauri::AppHandle,
    db_dir: &Path,
    app_data_dir: &Path,
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

    // Resolve the actual db directory (v1 compat: db/ subdirectory)
    let actual_db_dir = if db_dir.join("db").join("immutable").exists() {
        db_dir.join("db")
    } else {
        db_dir.to_path_buf()
    };

    // Ensure the snapshot-converter binary exists.
    // mithril-client downloads it as part of `tools utxo-hd snapshot-converter`.
    let converter_bin = actual_db_dir
        .join("tmp")
        .join("cardano-node-distribution")
        .join("bin")
        .join("snapshot-converter");

    if !converter_bin.exists() {
        eprintln!("[mithril] snapshot-converter not found, downloading via mithril-client...");

        // Emit status to frontend
        let _ = app_handle.emit(
            "mithril-progress",
            MithrilProgress {
                stage: MithrilStage::Converting,
                progress_percent: 0.0,
                bytes_downloaded: 0,
                total_bytes: 0,
                message: "Downloading snapshot converter...".to_string(),
            },
        );

        // Stop the NodeManager entry to prevent auto-restart interference
        let _ = manager.stop("mithril-client").await;

        // Run mithril-client as a one-shot command (not through NodeManager) to download
        // the cardano-node distribution. The conversion itself will fail (known mithril-client
        // 0.12.x bug with node 10.6+ snapshot-converter CLI), but the binary gets downloaded.
        // Using shell().sidecar().output() avoids NodeManager auto-restart.
        use tauri_plugin_shell::ShellExt;
        let shell = app_handle.shell();
        let command = shell
            .sidecar("mithril-client")
            .map_err(|e| format!("Failed to create mithril-client sidecar command: {e}"))?;
        let output = command
            .args([
                "tools",
                "utxo-hd",
                "snapshot-converter",
                "--db-directory",
                &actual_db_dir.to_string_lossy(),
                "--cardano-node-version",
                "10.6.2",
                "--utxo-hd-flavor",
                "LMDB",
            ])
            .output()
            .await
            .map_err(|e| format!("Failed to run mithril-client for distribution download: {e}"))?;

        // The conversion will fail — that's expected. We only need the binary.
        if !output.status.success() {
            eprintln!(
                "[mithril] mithril-client converter exited with status {} (expected — using binary directly)",
                output.status.code().unwrap_or(-1)
            );
        }

        if !converter_bin.exists() {
            return Err(
                "Failed to obtain snapshot-converter binary from cardano-node distribution"
                    .to_string(),
            );
        }
    }

    // Ensure node config files exist (needed by snapshot-converter --config)
    let config = app_handle.state::<AppConfig>();
    let node_config = CardanoNodeConfig::new(&config, app_data_dir);
    node_config.ensure_config_files(app_handle)?;
    let config_json = node_config.config_json;

    if !config_json.exists() {
        return Err(format!(
            "Node config not found at {}",
            config_json.display()
        ));
    }

    // Find ledger snapshots that need conversion (backend == "utxohd-mem")
    let ledger_dir = actual_db_dir.join("ledger");
    let snapshots = find_mem_snapshots(&ledger_dir)?;

    if snapshots.is_empty() {
        eprintln!("[mithril] No in-memory ledger snapshots found — skipping conversion");
        let _ = app_handle.emit(
            "mithril-progress",
            MithrilProgress {
                stage: MithrilStage::Complete,
                progress_percent: 100.0,
                bytes_downloaded: 0,
                total_bytes: 0,
                message: "Bootstrap complete".to_string(),
            },
        );
        return Ok(());
    }

    eprintln!(
        "[mithril] Converting {} ledger snapshot(s) to LMDB format",
        snapshots.len()
    );

    // Stop the mithril-client process to free sidecar resources
    let _ = manager.stop("mithril-client").await;

    // Create output directory for LMDB snapshots
    let lmdb_dir = actual_db_dir.join("ledger_lmdb");
    std::fs::create_dir_all(&lmdb_dir)
        .map_err(|e| format!("Failed to create ledger_lmdb dir: {e}"))?;

    // Convert each snapshot
    let total = snapshots.len();
    for (i, slot_name) in snapshots.iter().enumerate() {
        let input_path = ledger_dir.join(slot_name);
        let output_path = lmdb_dir.join(slot_name);

        eprintln!(
            "[mithril] Converting snapshot {}/{}: {} → LMDB",
            i + 1,
            total,
            slot_name
        );

        let _ = app_handle.emit(
            "mithril-progress",
            MithrilProgress {
                stage: MithrilStage::Converting,
                progress_percent: (i as f64 / total as f64) * 100.0,
                bytes_downloaded: 0,
                total_bytes: 0,
                message: format!("Converting ledger snapshot {}/{} to LMDB...", i + 1, total),
            },
        );

        let output = tokio::process::Command::new(&converter_bin)
            .arg("--mem-in")
            .arg(&input_path)
            .arg("--lmdb-out")
            .arg(&output_path)
            .arg("--config")
            .arg(&config_json)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("Failed to run snapshot-converter: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "snapshot-converter failed for {slot_name}: {stderr}"
            ));
        }

        eprintln!("[mithril] Successfully converted snapshot {slot_name} to LMDB");
    }

    // Swap directories: ledger (mem) → ledger_mem_backup, ledger_lmdb → ledger
    let backup_dir = actual_db_dir.join("ledger_mem_backup");
    std::fs::rename(&ledger_dir, &backup_dir)
        .map_err(|e| format!("Failed to rename ledger → ledger_mem_backup: {e}"))?;
    std::fs::rename(&lmdb_dir, &ledger_dir)
        .map_err(|e| format!("Failed to rename ledger_lmdb → ledger: {e}"))?;

    // Clean up backup and distribution
    let _ = std::fs::remove_dir_all(&backup_dir);
    let dist_dir = actual_db_dir.join("tmp").join("cardano-node-distribution");
    let _ = std::fs::remove_dir_all(&dist_dir);

    eprintln!("[mithril] LMDB conversion complete");

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

/// Find ledger snapshot directories that use the in-memory backend.
/// Reads each `<slot>/meta` file and checks for `"backend":"utxohd-mem"`.
fn find_mem_snapshots(ledger_dir: &Path) -> Result<Vec<String>, String> {
    if !ledger_dir.exists() {
        return Ok(Vec::new());
    }

    let mut snapshots = Vec::new();
    let entries =
        std::fs::read_dir(ledger_dir).map_err(|e| format!("Failed to read ledger dir: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {e}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let meta_path = path.join("meta");
        if !meta_path.exists() {
            continue;
        }

        if let Ok(meta_content) = std::fs::read_to_string(&meta_path) {
            if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&meta_content) {
                if meta
                    .get("backend")
                    .and_then(|v| v.as_str())
                    .map(|b| b.contains("mem"))
                    .unwrap_or(false)
                {
                    if let Some(name) = entry.file_name().to_str() {
                        snapshots.push(name.to_string());
                    }
                }
            }
        }
    }

    snapshots.sort();
    Ok(snapshots)
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
