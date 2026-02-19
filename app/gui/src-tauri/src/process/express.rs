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
    let env_vars = app_config.express_env_vars();
    manager
        .start_command(
            "express",
            "node",
            vec!["dist/index.js".to_string()],
            Some(be_dir),
            env_vars,
        )
        .await
}
