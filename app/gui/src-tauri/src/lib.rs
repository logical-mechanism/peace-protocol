mod commands;
mod config;
mod crypto;
mod process;

use commands::media::{ContentDir, MediaDir};
use commands::node::AppDataDir;
use commands::secrets::SecretsDir;
use commands::snark::{AppTmpDir, SnarkLock};
use commands::wallet::WalletState;
use config::AppConfig;
use crypto::audit::AuditLog;
use crypto::secrets::SecretsKey;
use process::manager::NodeManager;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Global flag to prevent duplicate shutdown attempts.
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

/// Securely delete files in the temp directory that are older than 1 hour.
/// Overwrites file contents with zeros before removing (SNARK temp files
/// contain secret cryptographic scalars).
fn cleanup_old_temp_files(tmp_dir: &std::path::Path) {
    let one_hour = std::time::Duration::from_secs(3600);
    let entries = match std::fs::read_dir(tmp_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        // Recurse into subdirectories (temp proof output dirs)
        if path.is_dir() {
            cleanup_old_temp_files(&path);
            // Remove empty dirs
            let _ = std::fs::remove_dir(&path);
            continue;
        }

        let modified = match std::fs::metadata(&path).and_then(|m| m.modified()) {
            Ok(t) => t,
            Err(_) => continue,
        };

        let age = std::time::SystemTime::now()
            .duration_since(modified)
            .unwrap_or_default();

        if age > one_hour {
            // Secure delete: overwrite with zeros, flush, then remove
            if let Ok(size) = std::fs::metadata(&path).map(|m| m.len() as usize) {
                if let Ok(mut file) = std::fs::OpenOptions::new().write(true).open(&path) {
                    use std::io::Write;
                    let zeros = vec![0u8; size];
                    let _ = file.write_all(&zeros);
                    let _ = file.sync_all();
                }
            }
            let _ = std::fs::remove_file(&path);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    {
        // Workaround for WebKitGTK DMA-BUF crashes on newer kernels (6.17+)
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

        // AppImage's linuxdeploy launcher sets GST_PLUGIN_SYSTEM_PATH_1_0 to
        // "$APPDIR/usr/lib/gstreamer-1.0:" which overrides GStreamer's compiled-in
        // default plugin search paths. The AppImage bundles GStreamer libraries but
        // NOT plugins, so WebKitGTK fails to find appsink/autoaudiosink and crashes.
        // Append the standard system plugin directories.
        let system_gst_dirs = [
            "/usr/lib/x86_64-linux-gnu/gstreamer-1.0",
            "/usr/lib/gstreamer-1.0",
            "/usr/lib64/gstreamer-1.0",
        ];
        let current = std::env::var("GST_PLUGIN_SYSTEM_PATH_1_0").unwrap_or_default();
        let mut paths: Vec<&str> = current.split(':').filter(|s| !s.is_empty()).collect();
        for dir in &system_gst_dirs {
            if !paths.contains(dir) && std::path::Path::new(dir).is_dir() {
                paths.push(dir);
            }
        }
        std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", paths.join(":"));
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");

            // Cache app_data_dir for hot-path commands (get_node_status polled every 5s)
            app.manage(AppDataDir(app_data_dir.clone()));

            // Wallet state (Phase 1)
            let wallet_path = app_data_dir.join("wallet.json");
            app.manage(WalletState { wallet_path });

            // App config — reads from bundled resources/config.json
            let resource_dir = app
                .path()
                .resource_dir()
                .unwrap_or_else(|_| app_data_dir.clone());
            let (app_config, config_used_defaults) = AppConfig::load(&resource_dir);
            if let Err(msg) = app_config.validate() {
                eprintln!("Config validation failed: {msg}");
                use tauri_plugin_dialog::DialogExt;
                app.dialog()
                    .message(format!(
                        "Invalid configuration:\n\n{msg}\n\nPlease reinstall the application."
                    ))
                    .title("Veiled: Configuration Error")
                    .blocking_show();
                std::process::exit(1);
            }
            let ogmios_port = app_config.ogmios_port;
            let kupo_port = app_config.kupo_port;
            app.manage(app_config);

            // Node manager (Phase 2) — pass service ports for periodic health checks
            let node_manager = NodeManager::new(app.handle().clone(), ogmios_port, kupo_port);
            app.manage(node_manager);

            // App-specific temp directory — wiped on startup to clean crash orphans
            // (SNARK temp files contain secret cryptographic material)
            let app_tmp_dir = app_data_dir.join("tmp");
            if app_tmp_dir.exists() {
                if let Err(e) = std::fs::remove_dir_all(&app_tmp_dir) {
                    eprintln!("Warning: failed to clean temp dir: {e}");
                }
            }
            std::fs::create_dir_all(&app_tmp_dir).expect("Failed to create app temp directory");
            crypto::wallet::set_owner_only_dir(&app_tmp_dir)
                .expect("Failed to set temp directory permissions");
            app.manage(AppTmpDir(app_tmp_dir.clone()));

            // SNARK serialization lock — prevents concurrent sidecar invocations.
            // Wrapped in Arc so the cleanup task can check if a prove is in progress.
            let snark_mutex = std::sync::Arc::new(tokio::sync::Mutex::new(()));
            let snark_mutex_for_cleanup = snark_mutex.clone();
            app.manage(SnarkLock(snark_mutex));

            // Pre-compute media images path for background cleanup task
            let media_images_cleanup_dir = app_data_dir.join("media").join("images");

            // Periodic cleanup (runs every hour):
            // 1. Securely delete orphaned SNARK temp files older than 1 hour
            //    (skipped if a prove operation is in progress to avoid deleting active files)
            // 2. Evict cached images older than 30 days or exceeding 500 MB total
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
                    match snark_mutex_for_cleanup.try_lock() {
                        Ok(_guard) => {
                            cleanup_old_temp_files(&app_tmp_dir);
                        }
                        Err(_) => {
                            eprintln!(
                                "[cleanup] Skipping SNARK temp cleanup: prove operation in progress"
                            );
                        }
                    }
                    commands::media::cleanup_image_cache(
                        &media_images_cleanup_dir,
                        2_592_000,   // 30 days in seconds
                        524_288_000, // 500 MB in bytes
                    );
                }
            });

            // Secret storage directory (filesystem-backed, survives WebView resets)
            let secrets_dir = app_data_dir.join("secrets");
            std::fs::create_dir_all(&secrets_dir).expect("Failed to create secrets directory");
            crypto::wallet::set_owner_only_dir(&secrets_dir)
                .expect("Failed to set secrets directory permissions");
            app.manage(SecretsDir(secrets_dir));

            // Secrets encryption key (derived from mnemonic on wallet unlock)
            app.manage(SecretsKey(Mutex::new(None)));

            // Audit log for secrets operations
            app.manage(AuditLog::new(&app_data_dir));

            // Media directory (for cached listing preview images)
            let media_images_dir = app_data_dir.join("media").join("images");
            std::fs::create_dir_all(&media_images_dir)
                .expect("Failed to create media/images directory");
            crypto::wallet::set_owner_only_dir(&media_images_dir)
                .expect("Failed to set media directory permissions");
            app.manage(MediaDir(media_images_dir));

            // Content directory (for purchased/decrypted files, organized by category)
            let content_dir = app_data_dir.join("media").join("content");
            commands::media::ensure_content_dirs(&content_dir)
                .expect("Failed to create content directories");
            crypto::wallet::set_owner_only_dir(&content_dir)
                .expect("Failed to set content directory permissions");
            app.manage(ContentDir(content_dir));

            // Warn frontend if config fell back to defaults
            if config_used_defaults {
                let _ = app.emit(
                    "config-warning",
                    "Config file not found — using default values. Contract addresses may be incorrect.",
                );
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Prevent the window from closing immediately — the 30s
                // process shutdown would block the event loop and trigger
                // the OS "force quit" dialog.
                api.prevent_close();

                if SHUTTING_DOWN.swap(true, Ordering::SeqCst) {
                    // Already shutting down from a previous click; skip.
                    return;
                }

                let app_handle = window.app_handle().clone();

                // Show a shutdown overlay in the frontend instead of hiding.
                let _ = window.emit("app-shutting-down", ());

                // Run the blocking shutdown on a dedicated thread so the
                // Tauri event loop stays responsive.
                std::thread::spawn(move || {
                    let manager = app_handle.state::<NodeManager>();
                    manager.kill_all_sync(&app_handle);
                    app_handle.exit(0);
                });
            }
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
            // Chain commands (Koios direct)
            commands::chain::get_network_tip,
            // Config commands (Phase 2)
            commands::config::get_network,
            commands::config::set_network,
            commands::config::get_data_dir,
            commands::config::get_app_config,
            commands::config::get_disk_usage,
            commands::config::get_available_disk_space,
            // SNARK commands (Phase 4)
            commands::snark::snark_check_setup,
            commands::snark::snark_decompress_setup,
            commands::snark::snark_gt_to_hash,
            commands::snark::snark_decrypt_to_hash,
            commands::snark::snark_prove,
            // Secret storage commands
            commands::secrets::store_seller_secrets,
            commands::secrets::get_seller_secrets,
            commands::secrets::remove_seller_secrets,
            commands::secrets::list_seller_secrets,
            commands::secrets::store_bid_secrets,
            commands::secrets::get_bid_secrets,
            commands::secrets::get_bid_secrets_for_encryption,
            commands::secrets::remove_bid_secrets,
            commands::secrets::store_accept_bid_secrets,
            commands::secrets::get_accept_bid_secrets,
            commands::secrets::remove_accept_bid_secrets,
            commands::secrets::has_accept_bid_secrets,
            // Listing draft commands
            commands::secrets::store_listing_draft,
            commands::secrets::update_listing_draft,
            commands::secrets::get_listing_draft,
            commands::secrets::list_listing_drafts,
            commands::secrets::remove_listing_draft,
            // Iagon data layer commands
            commands::iagon::store_iagon_api_key,
            commands::iagon::get_iagon_api_key,
            commands::iagon::remove_iagon_api_key,
            commands::iagon::has_iagon_api_key,
            // Iagon HTTP proxy commands (bypass CORS)
            commands::iagon::iagon_get_nonce,
            commands::iagon::iagon_verify,
            commands::iagon::iagon_generate_api_key,
            commands::iagon::iagon_verify_api_key,
            commands::iagon::iagon_upload,
            commands::iagon::iagon_download,
            commands::iagon::iagon_encrypt_and_upload,
            commands::iagon::iagon_download_and_save,
            commands::iagon::iagon_delete_file,
            commands::iagon::iagon_search_files,
            commands::iagon::iagon_list_files,
            // Media commands (image caching)
            commands::media::download_image,
            commands::media::get_cached_image,
            commands::media::list_cached_images,
            commands::media::ban_image,
            commands::media::unban_image,
            commands::media::delete_cached_image,
            // Content commands (for future data layer)
            commands::media::save_content,
            commands::media::copy_to_library,
            // Library commands (browse/read/delete/export decrypted content)
            commands::media::list_library_items,
            commands::media::read_library_content,
            commands::media::read_subtitle_file,
            commands::media::delete_library_item,
            commands::media::export_library_content,
            commands::media::export_text_file,
            commands::media::open_with_system,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // Last-resort cleanup: if the window close handler didn't
                // run (e.g. the app was killed externally), fire-and-forget
                // SIGTERMs without waiting so we don't block here.
                if !SHUTTING_DOWN.load(Ordering::SeqCst) {
                    let manager = app_handle.state::<NodeManager>();
                    manager.sigterm_all();
                }
            }
        });
}
