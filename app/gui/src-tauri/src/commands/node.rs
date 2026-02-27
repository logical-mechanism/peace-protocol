use crate::config::AppConfig;
use crate::process::manager::{NodeManager, ProcessInfo, ProcessStatus};
use crate::process::{cardano, cardano_cli, express, kupo, mithril, ogmios};
use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

/// Cached app data directory path, resolved once at startup.
/// Avoids calling `app.path().app_data_dir()` on every `get_node_status` poll.
pub struct AppDataDir(pub PathBuf);

/// Overall node infrastructure state returned to the frontend
#[derive(Clone, Serialize, PartialEq)]
pub enum OverallNodeState {
    Stopped,
    Bootstrapping,
    Starting,
    Syncing,
    Synced,
    Error,
}

/// Aggregate status for all node infrastructure
#[derive(Clone, Serialize)]
pub struct NodeStatus {
    pub overall: OverallNodeState,
    pub sync_progress: f64,
    pub kupo_sync_progress: f64,
    pub tip_slot: Option<u64>,
    pub tip_height: Option<u64>,
    pub network: String,
    pub processes: Vec<ProcessInfo>,
    pub needs_bootstrap: bool,
    // Extended fields from cardano-cli tip query
    pub epoch: Option<u64>,
    pub era: Option<String>,
    pub slot_in_epoch: Option<u64>,
    pub slots_to_epoch_end: Option<u64>,
    // Kupo health details from /metrics
    pub kupo_connection_status: Option<bool>,
    pub kupo_seconds_since_last_block: Option<f64>,
}

/// Get aggregated node status
#[tauri::command]
pub async fn get_node_status(
    manager: tauri::State<'_, NodeManager>,
    app_data_dir: tauri::State<'_, AppDataDir>,
    app_handle: tauri::AppHandle,
) -> Result<NodeStatus, String> {
    let app_data_dir = &app_data_dir.0;

    let config = app_handle.state::<AppConfig>();
    let processes = manager.get_all_status().await;

    let needs_bootstrap_check = mithril::needs_bootstrap(&config, app_data_dir);

    // Determine overall state from individual process statuses
    let mithril_status = manager.get_status("mithril-client").await;
    let node_status = manager.get_status("cardano-node").await;
    let ogmios_status = manager.get_status("ogmios").await;

    // Helper: build a NodeStatus with no sync data (early exit states)
    let empty_status = |overall: OverallNodeState| NodeStatus {
        overall,
        sync_progress: 0.0,
        kupo_sync_progress: 0.0,
        tip_slot: None,
        tip_height: None,
        network: config.network.to_string(),
        processes: processes.clone(),
        needs_bootstrap: needs_bootstrap_check,
        epoch: None,
        era: None,
        slot_in_epoch: None,
        slots_to_epoch_end: None,
        kupo_connection_status: None,
        kupo_seconds_since_last_block: None,
    };

    // Check for Mithril bootstrapping
    if let Some(ref ms) = mithril_status {
        if matches!(
            ms.status,
            ProcessStatus::Starting | ProcessStatus::Running | ProcessStatus::Syncing { .. }
        ) {
            return Ok(empty_status(OverallNodeState::Bootstrapping));
        }
    }

    // Check if any process has an error
    let has_error = processes
        .iter()
        .any(|p| matches!(p.status, ProcessStatus::Error { .. }));
    if has_error {
        return Ok(empty_status(OverallNodeState::Error));
    }

    // Check if node process is active (starting or running)
    let node_starting = node_status
        .as_ref()
        .map(|s| matches!(s.status, ProcessStatus::Starting))
        .unwrap_or(false);
    let node_running = node_status
        .as_ref()
        .map(|s| {
            matches!(
                s.status,
                ProcessStatus::Running | ProcessStatus::Syncing { .. } | ProcessStatus::Ready
            )
        })
        .unwrap_or(false);

    if !node_starting && !node_running {
        return Ok(empty_status(OverallNodeState::Stopped));
    }

    // Node process is spawning but not Running yet
    if node_starting && !node_running {
        return Ok(empty_status(OverallNodeState::Starting));
    }

    // --- Node is Running: query sync data ---

    // Query Kupo metrics (independent of node sync source)
    let kupo_status = manager.get_status("kupo").await;
    let kupo_running = kupo_status
        .as_ref()
        .map(|s| matches!(s.status, ProcessStatus::Running | ProcessStatus::Ready))
        .unwrap_or(false);

    let kupo_result = if kupo_running {
        kupo::get_metrics(config.kupo_port).await.ok()
    } else {
        None
    };

    let kupo_sync = kupo_result.as_ref().map(|m| m.sync_progress).unwrap_or(0.0);
    let kupo_connection = kupo_result.as_ref().map(|m| m.connected);
    let kupo_last_block = kupo_result.as_ref().map(|m| m.seconds_since_last_block);

    // Primary sync source: cardano-cli query tip (works as soon as socket exists)
    if let Ok(cli_tip) = cardano_cli::query_tip(&app_handle, &config, app_data_dir).await {
        let sync = cli_tip.sync_progress_f64();

        let overall = if sync >= 0.999 && kupo_sync >= 0.999 {
            OverallNodeState::Synced
        } else {
            OverallNodeState::Syncing
        };

        return Ok(NodeStatus {
            overall,
            sync_progress: sync,
            kupo_sync_progress: kupo_sync,
            tip_slot: Some(cli_tip.slot),
            tip_height: Some(cli_tip.block),
            network: config.network.to_string(),
            processes,
            needs_bootstrap: needs_bootstrap_check,
            epoch: Some(cli_tip.epoch),
            era: Some(cli_tip.era),
            slot_in_epoch: Some(cli_tip.slot_in_epoch),
            slots_to_epoch_end: Some(cli_tip.slots_to_epoch_end),
            kupo_connection_status: kupo_connection,
            kupo_seconds_since_last_block: kupo_last_block,
        });
    }

    // Fallback: try Ogmios if cardano-cli failed (e.g. socket busy, CLI not available)
    let ogmios_active = ogmios_status
        .as_ref()
        .map(|s| {
            matches!(
                s.status,
                ProcessStatus::Starting | ProcessStatus::Running | ProcessStatus::Ready
            )
        })
        .unwrap_or(false);

    if ogmios_active {
        if let Ok(sync) = ogmios::get_sync_progress(config.ogmios_port).await {
            let (tip_slot, tip_height) = ogmios::get_tip_info(config.ogmios_port)
                .await
                .unwrap_or((0, 0));

            let overall = if sync >= 0.999 && kupo_sync >= 0.999 {
                OverallNodeState::Synced
            } else {
                OverallNodeState::Syncing
            };

            return Ok(NodeStatus {
                overall,
                sync_progress: sync,
                kupo_sync_progress: kupo_sync,
                tip_slot: Some(tip_slot),
                tip_height: Some(tip_height),
                network: config.network.to_string(),
                processes,
                needs_bootstrap: needs_bootstrap_check,
                epoch: None,
                era: None,
                slot_in_epoch: None,
                slots_to_epoch_end: None,
                kupo_connection_status: kupo_connection,
                kupo_seconds_since_last_block: kupo_last_block,
            });
        }
    }

    // Both cardano-cli and Ogmios failed — report as Starting
    Ok(empty_status(OverallNodeState::Starting))
}

/// Get status of individual processes
#[tauri::command]
pub async fn get_process_status(
    manager: tauri::State<'_, NodeManager>,
) -> Result<Vec<ProcessInfo>, String> {
    Ok(manager.get_all_status().await)
}

/// Start the full node infrastructure stack.
/// Order: cardano-node → wait for socket → ogmios → wait for health → kupo
/// The wallet_address is used by Kupo to scope indexing to only the user's
/// wallet + protocol contract addresses (instead of the entire chain).
#[tauri::command]
pub async fn start_node(
    manager: tauri::State<'_, NodeManager>,
    app_data_dir: tauri::State<'_, AppDataDir>,
    app_handle: tauri::AppHandle,
    wallet_address: String,
) -> Result<(), String> {
    let app_data_dir = &app_data_dir.0;

    let config = app_handle.state::<AppConfig>();

    // Check if Mithril bootstrap is needed
    if mithril::needs_bootstrap(&config, app_data_dir) {
        return Err("Chain data not found. Run start_mithril_bootstrap first.".to_string());
    }

    // 1. Start cardano-node
    cardano::start_cardano_node(&manager, &config, app_data_dir, &app_handle).await?;

    // 2. Wait for node socket to appear (poll every 5s, no fixed timeout).
    // After a Mithril bootstrap, ledger replay can take 10+ minutes (preprod)
    // or hours (mainnet). We wait as long as cardano-node is still running.
    let socket_path = config.node_socket_path(app_data_dir);
    loop {
        if socket_path.exists() {
            break;
        }
        // Check if the process is still alive
        let status = manager.get_status("cardano-node").await;
        let still_running = status
            .as_ref()
            .map(|s| {
                matches!(
                    s.status,
                    ProcessStatus::Starting
                        | ProcessStatus::Running
                        | ProcessStatus::Syncing { .. }
                )
            })
            .unwrap_or(false);
        if !still_running {
            return Err("cardano-node exited before creating its socket".to_string());
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    }

    // 3. Start Ogmios
    ogmios::start_ogmios(&manager, &config, app_data_dir).await?;

    // 4. Wait for Ogmios health (poll every 5s, no fixed timeout).
    // Stop waiting if the ogmios process dies.
    loop {
        if ogmios::health_check(config.ogmios_port).await {
            break;
        }
        let status = manager.get_status("ogmios").await;
        let still_running = status
            .as_ref()
            .map(|s| matches!(s.status, ProcessStatus::Starting | ProcessStatus::Running))
            .unwrap_or(false);
        if !still_running {
            return Err("ogmios exited before becoming healthy".to_string());
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    }

    // 5. Start Kupo scoped to contract addresses + wallet address
    kupo::start_kupo(&manager, &config, app_data_dir, &wallet_address).await?;

    // 5b. Wait for Kupo health (poll every 5s).
    // Stop waiting if the kupo process dies.
    loop {
        if kupo::health_check(config.kupo_port).await {
            break;
        }
        let status = manager.get_status("kupo").await;
        let still_running = status
            .as_ref()
            .map(|s| matches!(s.status, ProcessStatus::Starting | ProcessStatus::Running))
            .unwrap_or(false);
        if !still_running {
            return Err("kupo exited before becoming healthy".to_string());
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    }

    // 6. Start Express backend with contract config as env vars.
    // In dev: be/ is at src-tauri/../be relative to the source tree.
    // In prod: be/ is bundled as a resource.
    // Skipped if the backend isn't built yet (dist/index.js missing).
    let be_dir = app_handle
        .path()
        .resource_dir()
        .ok()
        .map(|r| r.join("be"))
        .filter(|p| p.exists())
        .unwrap_or_else(|| {
            // Dev fallback: CARGO_MANIFEST_DIR is always src-tauri/
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../be")
        });
    if be_dir.join("dist/index.js").exists() {
        express::start_express(&manager, &config, &be_dir).await?;

        // 6b. Wait for Express health (poll every 2s — starts fast).
        // Stop waiting if the express process dies.
        loop {
            if express::health_check().await {
                break;
            }
            let status = manager.get_status("express").await;
            let still_running = status
                .as_ref()
                .map(|s| matches!(s.status, ProcessStatus::Starting | ProcessStatus::Running))
                .unwrap_or(false);
            if !still_running {
                return Err("express exited before becoming healthy".to_string());
            }
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        }
    } else {
        eprintln!(
            "Express backend not built ({}), skipping",
            be_dir.join("dist/index.js").display()
        );
    }

    Ok(())
}

/// Stop all node infrastructure processes in reverse dependency order
#[tauri::command]
pub async fn stop_node(manager: tauri::State<'_, NodeManager>) -> Result<(), String> {
    manager.stop("express").await?;
    manager.stop("kupo").await?;
    manager.stop("ogmios").await?;
    manager.stop("cardano-node").await?;
    Ok(())
}

/// Trigger a Mithril snapshot download for bootstrapping
#[tauri::command]
pub async fn start_mithril_bootstrap(
    manager: tauri::State<'_, NodeManager>,
    app_data_dir: tauri::State<'_, AppDataDir>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let config = app_handle.state::<AppConfig>();
    mithril::start_mithril_bootstrap(&manager, &config, &app_data_dir.0).await
}

/// Get recent log lines for a specific process
#[tauri::command]
pub async fn get_process_logs(
    manager: tauri::State<'_, NodeManager>,
    process_name: String,
    lines: Option<usize>,
) -> Result<Vec<String>, String> {
    Ok(manager.get_logs(&process_name, lines.unwrap_or(100)).await)
}
