use crate::config::AppConfig;
use crate::process::manager::NodeManager;
use std::path::PathBuf;

/// Start the Express backend as a child process.
/// Unlike the sidecar-based processes, Express is spawned via tokio::process::Command
/// since it's a Node.js application, not a bundled binary.
///
/// Contract configuration from config.json is passed as environment variables,
/// making config.json the single source of truth for all protocol settings.
pub async fn start_express(
    manager: &NodeManager,
    app_config: &AppConfig,
    be_dir: &PathBuf,
) -> Result<(), String> {
    manager.ensure_port_available(3001)?;
    let env_vars = app_config.express_env_vars();
    manager
        .start_command(
            "express",
            "node",
            vec!["dist/index.js".to_string()],
            Some(be_dir),
            env_vars,
            false,
        )
        .await
}

/// Health check: GET http://127.0.0.1:3001/health
/// Returns true if Express responds (any HTTP status — connection success means alive).
/// The /health endpoint may return 503 when dependencies (Kupo/Koios) are unhealthy,
/// but Express itself is running and accepting requests.
pub async fn health_check() -> bool {
    reqwest::get("http://127.0.0.1:3001/health").await.is_ok()
}
