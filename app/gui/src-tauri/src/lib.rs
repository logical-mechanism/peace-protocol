mod commands;
mod config;
mod crypto;
mod process;

use commands::wallet::WalletState;
use config::AppConfig;
use process::manager::NodeManager;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Workaround for WebKitGTK sandbox crash on newer kernels (6.17+)
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        std::env::set_var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");

            // Wallet state (Phase 1)
            let wallet_path = app_data_dir.join("wallet.json");
            app.manage(WalletState {
                wallet_path,
                mnemonic: Mutex::new(None),
            });

            // App config — reads from bundled resources/config.json
            let resource_dir = app
                .path()
                .resource_dir()
                .unwrap_or_else(|_| app_data_dir.clone());
            let app_config = AppConfig::load(&resource_dir);
            app.manage(app_config);

            // Node manager (Phase 2)
            let node_manager = NodeManager::new(app.handle().clone());
            app.manage(node_manager);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Wallet commands (Phase 1)
            commands::wallet::wallet_exists,
            commands::wallet::create_wallet,
            commands::wallet::unlock_wallet,
            commands::wallet::lock_wallet,
            commands::wallet::delete_wallet,
            commands::wallet::reveal_mnemonic,
            // Node commands (Phase 2)
            commands::node::get_node_status,
            commands::node::get_process_status,
            commands::node::start_node,
            commands::node::stop_node,
            commands::node::start_mithril_bootstrap,
            commands::node::get_process_logs,
            // Config commands (Phase 2)
            commands::config::get_network,
            commands::config::set_network,
            commands::config::get_data_dir,
            commands::config::get_app_config,
            commands::config::get_disk_usage,
            // SNARK commands (Phase 4)
            commands::snark::snark_check_setup,
            commands::snark::snark_decompress_setup,
            commands::snark::snark_gt_to_hash,
            commands::snark::snark_decrypt_to_hash,
            commands::snark::snark_prove,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Graceful shutdown: kill all managed processes on app exit
            if let tauri::RunEvent::Exit = event {
                let manager = app_handle.state::<NodeManager>();
                tauri::async_runtime::block_on(async {
                    manager.shutdown_all().await;
                });
            }
        });
}
