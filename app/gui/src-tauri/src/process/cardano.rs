use crate::config::AppConfig;
use crate::process::manager::NodeManager;
use std::path::PathBuf;

/// Paths to all config files needed by cardano-node
pub struct CardanoNodeConfig {
    pub config_json: PathBuf,
    pub topology_json: PathBuf,
    pub db_dir: PathBuf,
    pub socket_path: PathBuf,
}

impl CardanoNodeConfig {
    /// Build config paths from app config and data directory.
    /// Note: Mithril v1 extracts the snapshot into a `db/` subdirectory within
    /// the download-dir, so cardano-node's database-path must point there.
    pub fn new(app_config: &AppConfig, app_data_dir: &PathBuf) -> Self {
        let config_dir = app_config.config_dir(app_data_dir);
        Self {
            config_json: config_dir.join("config.json"),
            topology_json: config_dir.join("topology.json"),
            db_dir: app_config.node_db_dir(app_data_dir).join("db"),
            socket_path: app_config.node_socket_path(app_data_dir),
        }
    }

    /// Copy bundled config files from Tauri resources to the chain data config directory.
    /// Only copies if the destination files don't already exist.
    pub fn ensure_config_files(&self, app_handle: &tauri::AppHandle) -> Result<(), String> {
        use tauri::Manager;

        let config_dir = self.config_json.parent().ok_or("Invalid config path")?;
        std::fs::create_dir_all(config_dir)
            .map_err(|e| format!("Failed to create config dir: {e}"))?;

        // Resolve the bundled resource directory.
        // In production builds, resources are at resource_dir/resources/cardano/<network>/
        // In dev mode, resource_dir points to target/debug/ which doesn't have them,
        // so we fall back to the source tree at src-tauri/resources/cardano/<network>/
        let resource_dir = app_handle
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to resolve resource dir: {e}"))?;

        let app_config_state = app_handle.state::<AppConfig>();
        let network_name = app_config_state.network.to_string();

        // Build candidate source directories in priority order.
        // Dev path (src-tauri/resources/) is always up-to-date; the prod path
        // (target/debug/resources/) can be stale from an earlier build.
        let prod_path = resource_dir.join("resources").join("cardano").join(&network_name);
        let dev_path = resource_dir
            .parent() // target/
            .and_then(|p| p.parent()) // src-tauri/
            .map(|p| p.join("resources").join("cardano").join(&network_name));
        let source_dirs: Vec<&std::path::Path> = [dev_path.as_deref(), Some(prod_path.as_path())]
            .into_iter()
            .flatten()
            .filter(|p| p.exists())
            .collect();

        // List of config files to copy
        let files = [
            "config.json",
            "topology.json",
            "byron-genesis.json",
            "shelley-genesis.json",
            "alonzo-genesis.json",
            "conway-genesis.json",
            "peer-snapshot.json",
        ];

        for file in &files {
            let dst = config_dir.join(file);
            if !dst.exists() {
                let found = source_dirs.iter().find_map(|dir| {
                    let src = dir.join(file);
                    if src.exists() { Some(src) } else { None }
                });
                if let Some(src) = found {
                    std::fs::copy(&src, &dst).map_err(|e| {
                        format!("Failed to copy {file} from resources: {e}")
                    })?;
                } else {
                    eprintln!("Warning: bundled config file not found: {file}");
                }
            }
        }

        Ok(())
    }

    /// Build the command-line arguments for cardano-node
    pub fn build_args(&self) -> Vec<String> {
        vec![
            "run".to_string(),
            "--config".to_string(),
            self.config_json.to_string_lossy().into(),
            "--topology".to_string(),
            self.topology_json.to_string_lossy().into(),
            "--database-path".to_string(),
            self.db_dir.to_string_lossy().into(),
            "--socket-path".to_string(),
            self.socket_path.to_string_lossy().into(),
        ]
    }
}

/// Start cardano-node via the NodeManager
pub async fn start_cardano_node(
    manager: &NodeManager,
    app_config: &AppConfig,
    app_data_dir: &PathBuf,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    let config = CardanoNodeConfig::new(app_config, app_data_dir);
    config.ensure_config_files(app_handle)?;

    // Ensure db directory exists
    std::fs::create_dir_all(&config.db_dir)
        .map_err(|e| format!("Failed to create node db dir: {e}"))?;

    // Remove stale socket and lock files from a previous run (e.g., unclean shutdown).
    // cardano-node will recreate them once it's ready.
    if config.socket_path.exists() {
        let _ = std::fs::remove_file(&config.socket_path);
    }
    let lock_file = config.db_dir.join("lock");
    if lock_file.exists() {
        let _ = std::fs::remove_file(&lock_file);
    }

    let args = config.build_args();
    manager
        .start("cardano-node", "cardano-node", args)
        .await
}

/// Check if cardano-node has a database (i.e., has been bootstrapped).
/// Mithril v1 extracts to `node-db/db/`, so we check for markers there.
pub fn has_chain_data(app_config: &AppConfig, app_data_dir: &PathBuf) -> bool {
    let db_dir = app_config.node_db_dir(app_data_dir).join("db");
    db_dir.join("protocolMagicId").exists()
        || db_dir.join("immutable").exists()
}
