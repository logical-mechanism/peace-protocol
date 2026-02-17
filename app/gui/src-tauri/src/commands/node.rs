use crate::config::AppConfig;
use crate::process::manager::{NodeManager, ProcessInfo, ProcessStatus};
use crate::process::{cardano, kupo, mithril, ogmios};
use serde::Serialize;
use tauri::Manager;

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
    pub tip_slot: Option<u64>,
    pub tip_height: Option<u64>,
    pub network: String,
    pub processes: Vec<ProcessInfo>,
    pub needs_bootstrap: bool,
}

/// Get aggregated node status
#[tauri::command]
pub async fn get_node_status(
    manager: tauri::State<'_, NodeManager>,
    app_handle: tauri::AppHandle,
) -> Result<NodeStatus, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let config = app_handle.state::<AppConfig>();
    let processes = manager.get_all_status().await;

    let needs_bootstrap_check = mithril::needs_bootstrap(&config, &app_data_dir);

    // Determine overall state from individual process statuses
    let mithril_status = manager.get_status("mithril-client").await;
    let node_status = manager.get_status("cardano-node").await;
    let ogmios_status = manager.get_status("ogmios").await;

    // Check for Mithril bootstrapping
    if let Some(ref ms) = mithril_status {
        if matches!(
            ms.status,
            ProcessStatus::Starting | ProcessStatus::Running | ProcessStatus::Syncing { .. }
        ) {
            return Ok(NodeStatus {
                overall: OverallNodeState::Bootstrapping,
                sync_progress: 0.0,
                tip_slot: None,
                tip_height: None,
                network: config.network.to_string(),
                processes,
                needs_bootstrap: needs_bootstrap_check,
            });
        }
    }

    // Check if any process has an error
    let has_error = processes.iter().any(|p| matches!(p.status, ProcessStatus::Error { .. }));
    if has_error {
        return Ok(NodeStatus {
            overall: OverallNodeState::Error,
            sync_progress: 0.0,
            tip_slot: None,
            tip_height: None,
            network: config.network.to_string(),
            processes,
            needs_bootstrap: needs_bootstrap_check,
        });
    }

    // Check if node is running
    let node_running = node_status
        .as_ref()
        .map(|s| {
            matches!(
                s.status,
                ProcessStatus::Running | ProcessStatus::Syncing { .. } | ProcessStatus::Ready
            )
        })
        .unwrap_or(false);

    if !node_running {
        return Ok(NodeStatus {
            overall: OverallNodeState::Stopped,
            sync_progress: 0.0,
            tip_slot: None,
            tip_height: None,
            network: config.network.to_string(),
            processes,
            needs_bootstrap: needs_bootstrap_check,
        });
    }

    // If Ogmios is running, try to get sync progress from it
    let ogmios_running = ogmios_status
        .as_ref()
        .map(|s| {
            matches!(
                s.status,
                ProcessStatus::Running | ProcessStatus::Ready
            )
        })
        .unwrap_or(false);

    if ogmios_running {
        if let Ok(sync) = ogmios::get_sync_progress(config.ogmios_port).await {
            let (tip_slot, tip_height) = ogmios::get_tip_info(config.ogmios_port)
                .await
                .unwrap_or((0, 0));

            let overall = if sync >= 0.999 {
                OverallNodeState::Synced
            } else {
                OverallNodeState::Syncing
            };

            return Ok(NodeStatus {
                overall,
                sync_progress: sync,
                tip_slot: Some(tip_slot),
                tip_height: Some(tip_height),
                network: config.network.to_string(),
                processes,
                needs_bootstrap: needs_bootstrap_check,
            });
        }
    }

    // Node running but Ogmios not ready yet
    Ok(NodeStatus {
        overall: OverallNodeState::Starting,
        sync_progress: 0.0,
        tip_slot: None,
        tip_height: None,
        network: config.network.to_string(),
        processes,
        needs_bootstrap: needs_bootstrap_check,
    })
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
#[tauri::command]
pub async fn start_node(
    manager: tauri::State<'_, NodeManager>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let config = app_handle.state::<AppConfig>();

    // Check if Mithril bootstrap is needed
    if mithril::needs_bootstrap(&config, &app_data_dir) {
        return Err("Chain data not found. Run start_mithril_bootstrap first.".to_string());
    }

    // 1. Start cardano-node
    cardano::start_cardano_node(&manager, &config, &app_data_dir, &app_handle).await?;

    // 2. Wait for node socket to appear (poll every 5s, no fixed timeout).
    // After a Mithril bootstrap, ledger replay can take 10+ minutes (preprod)
    // or hours (mainnet). We wait as long as cardano-node is still running.
    let socket_path = config.node_socket_path(&app_data_dir);
    loop {
        if socket_path.exists() {
            break;
        }
        // Check if the process is still alive
        let status = manager.get_status("cardano-node").await;
        let still_running = status
            .as_ref()
            .map(|s| matches!(s.status, ProcessStatus::Starting | ProcessStatus::Running | ProcessStatus::Syncing { .. }))
            .unwrap_or(false);
        if !still_running {
            return Err("cardano-node exited before creating its socket".to_string());
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    }

    // 3. Start Ogmios
    ogmios::start_ogmios(&manager, &config, &app_data_dir).await?;

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

    // 5. Start Kupo (even if Ogmios isn't healthy yet — kupo connects to the node socket)
    kupo::start_kupo(&manager, &config, &app_data_dir, &[]).await?;

    Ok(())
}

/// Stop all node infrastructure processes in reverse dependency order
#[tauri::command]
pub async fn stop_node(manager: tauri::State<'_, NodeManager>) -> Result<(), String> {
    manager.stop("kupo").await?;
    manager.stop("ogmios").await?;
    manager.stop("cardano-node").await?;
    Ok(())
}

/// Trigger a Mithril snapshot download for bootstrapping
#[tauri::command]
pub async fn start_mithril_bootstrap(
    manager: tauri::State<'_, NodeManager>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let config = app_handle.state::<AppConfig>();
    mithril::start_mithril_bootstrap(&manager, &config, &app_data_dir).await
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
