use crate::config::AppConfig;
use crate::process::manager::NodeManager;
use std::path::{Path, PathBuf};

/// Paths to all config files needed by cardano-node
pub struct CardanoNodeConfig {
    pub config_json: PathBuf,
    pub topology_json: PathBuf,
    pub db_dir: PathBuf,
    pub socket_path: PathBuf,
}

impl CardanoNodeConfig {
    /// Build config paths from app config and data directory.
    /// Mithril v2 extracts directly into the download-dir.
    /// Legacy v1 extracted into a `db/` subdirectory — we check for that
    /// and use it if present (backward compat for existing users).
    pub fn new(app_config: &AppConfig, app_data_dir: &Path) -> Self {
        let config_dir = app_config.config_dir(app_data_dir);
        let base_db = app_config.node_db_dir(app_data_dir);
        // v1 extracted into db/ subdirectory; v2 extracts directly.
        // Use v1 path if it exists (backward compat), otherwise v2 path.
        let db_dir = if base_db.join("db").join("immutable").exists() {
            base_db.join("db")
        } else {
            base_db
        };
        Self {
            config_json: config_dir.join("config.json"),
            topology_json: config_dir.join("topology.json"),
            db_dir,
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
        let prod_path = resource_dir
            .join("resources")
            .join("cardano")
            .join(&network_name);
        let dev_path = resource_dir
            .parent() // target/
            .and_then(|p| p.parent()) // src-tauri/
            .map(|p| p.join("resources").join("cardano").join(&network_name));
        let source_dirs: Vec<&std::path::Path> = [dev_path.as_deref(), Some(prod_path.as_path())]
            .into_iter()
            .flatten()
            .filter(|p| p.exists())
            .collect();

        // Config files to copy from resources.
        // config.json and topology.json are always overwritten so that changes
        // (e.g. ledger backend, trace flags) take effect on upgrade.
        // Genesis files are large and stable — only copied if missing.
        let always_overwrite = ["config.json", "topology.json"];
        let copy_if_missing = [
            "byron-genesis.json",
            "shelley-genesis.json",
            "alonzo-genesis.json",
            "conway-genesis.json",
            "peer-snapshot.json",
        ];

        let all_files: Vec<(&str, bool)> = always_overwrite
            .iter()
            .map(|f| (*f, true))
            .chain(copy_if_missing.iter().map(|f| (*f, false)))
            .collect();

        for (file, overwrite) in &all_files {
            let dst = config_dir.join(file);
            if *overwrite || !dst.exists() {
                let found = source_dirs.iter().find_map(|dir| {
                    let src = dir.join(file);
                    if src.exists() {
                        Some(src)
                    } else {
                        None
                    }
                });
                if let Some(src) = found {
                    std::fs::copy(&src, &dst)
                        .map_err(|e| format!("Failed to copy {file} from resources: {e}"))?;
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
    app_data_dir: &Path,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    let config = CardanoNodeConfig::new(app_config, app_data_dir);

    // Remove stale peer snapshot BEFORE ensure_config_files so the bundled
    // version gets re-copied. cardano-node overwrites peer-snapshot.json with
    // discovered peers; stale cached peers prevent fresh bootstrap discovery.
    if let Some(config_dir) = config.config_json.parent() {
        let peer_snapshot = config_dir.join("peer-snapshot.json");
        if peer_snapshot.exists() {
            let _ = std::fs::remove_file(&peer_snapshot);
        }
    }

    config.ensure_config_files(app_handle)?;

    // Fix peerSnapshotFile path in topology.json to use an absolute path.
    // Known bug in cardano-node 10.6.x: relative paths in peerSnapshotFile are
    // resolved from the binary's directory, not the topology file's directory.
    // In AppImage the binary lives in /tmp/.mount_*/usr/bin/ so the relative
    // path never resolves. Rewriting to absolute after copying ensures the node
    // always finds the bundled snapshot.
    if let Some(config_dir) = config.config_json.parent() {
        let topo_path = config_dir.join("topology.json");
        let snapshot_abs = config_dir.join("peer-snapshot.json");
        if topo_path.exists() && snapshot_abs.exists() {
            if let Ok(topo) = std::fs::read_to_string(&topo_path) {
                let fixed = topo.replace(
                    "\"peer-snapshot.json\"",
                    &format!("\"{}\"", snapshot_abs.display()),
                );
                let _ = std::fs::write(&topo_path, fixed);
            }
        }
    }

    // Fix LiveTablesPath in config.json to use an absolute path.
    // V1LMDB needs a writable path for its live UTxO database. The bundled config
    // uses a relative "lmdb" placeholder which would resolve from the binary's
    // directory (broken in AppImage). Rewrite to an absolute path inside the db dir.
    {
        let config_path = &config.config_json;
        if config_path.exists() {
            if let Ok(cfg) = std::fs::read_to_string(config_path) {
                let lmdb_abs = config.db_dir.join("lmdb");
                let fixed = cfg.replace(
                    "\"LiveTablesPath\": \"lmdb\"",
                    &format!("\"LiveTablesPath\": \"{}\"", lmdb_abs.display()),
                );
                let _ = std::fs::write(config_path, fixed);
            }
        }
    }

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
        .start_sidecar(
            "cardano-node",
            "cardano-node",
            args,
            Some(&config.db_dir),
            true,
        )
        .await
}

/// Check if cardano-node has a database (i.e., has been bootstrapped).
/// Checks both v2 path (node-db/) and legacy v1 path (node-db/db/).
pub fn has_chain_data(app_config: &AppConfig, app_data_dir: &Path) -> bool {
    let base_db = app_config.node_db_dir(app_data_dir);
    let check = |dir: &Path| dir.join("protocolMagicId").exists() || dir.join("immutable").exists();
    check(&base_db) || check(&base_db.join("db"))
}
