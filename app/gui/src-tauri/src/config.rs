use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Network {
    Preprod,
    Mainnet,
}

impl Default for Network {
    fn default() -> Self {
        Network::Preprod
    }
}

impl std::fmt::Display for Network {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Network::Preprod => write!(f, "preprod"),
            Network::Mainnet => write!(f, "mainnet"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub network: Network,
    pub ogmios_port: u16,
    pub kupo_port: u16,
    pub auto_start_node: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            network: Network::Preprod,
            ogmios_port: 1337,
            kupo_port: 1442,
            auto_start_node: true,
        }
    }
}

impl AppConfig {
    /// Load from app_data_dir/config.json, or create default
    pub fn load(app_data_dir: &PathBuf) -> Self {
        let config_path = app_data_dir.join("config.json");
        if config_path.exists() {
            match std::fs::read_to_string(&config_path) {
                Ok(contents) => match serde_json::from_str(&contents) {
                    Ok(config) => return config,
                    Err(e) => {
                        eprintln!("Failed to parse config.json: {e}, using defaults");
                    }
                },
                Err(e) => {
                    eprintln!("Failed to read config.json: {e}, using defaults");
                }
            }
        }
        let config = Self::default();
        // Try to save the default config
        let _ = config.save(app_data_dir);
        config
    }

    /// Save to app_data_dir/config.json
    pub fn save(&self, app_data_dir: &PathBuf) -> Result<(), String> {
        std::fs::create_dir_all(app_data_dir)
            .map_err(|e| format!("Failed to create app data dir: {e}"))?;
        let config_path = app_data_dir.join("config.json");
        let json =
            serde_json::to_string_pretty(self).map_err(|e| format!("Failed to serialize: {e}"))?;
        std::fs::write(&config_path, json).map_err(|e| format!("Failed to write config: {e}"))
    }

    /// Get the chain data directory for the current network
    pub fn chain_data_dir(&self, app_data_dir: &PathBuf) -> PathBuf {
        app_data_dir.join(self.network.to_string())
    }

    /// Get the node database directory
    pub fn node_db_dir(&self, app_data_dir: &PathBuf) -> PathBuf {
        self.chain_data_dir(app_data_dir).join("node-db")
    }

    /// Get the kupo database directory
    pub fn kupo_db_dir(&self, app_data_dir: &PathBuf) -> PathBuf {
        self.chain_data_dir(app_data_dir).join("kupo-db")
    }

    /// Get the config files directory for the current network
    pub fn config_dir(&self, app_data_dir: &PathBuf) -> PathBuf {
        self.chain_data_dir(app_data_dir).join("config")
    }

    /// Get the node socket path
    pub fn node_socket_path(&self, app_data_dir: &PathBuf) -> PathBuf {
        self.chain_data_dir(app_data_dir).join("node.socket")
    }

    /// Get the mithril aggregator URL for the current network
    pub fn mithril_aggregator_url(&self) -> &str {
        match self.network {
            Network::Preprod => {
                "https://aggregator.release-preprod.api.mithril.network/aggregator"
            }
            Network::Mainnet => {
                "https://aggregator.release-mainnet.api.mithril.network/aggregator"
            }
        }
    }

    /// Get the mithril genesis verification key for the current network.
    /// These keys are published by IOG for each Mithril network.
    pub fn mithril_genesis_vkey(&self) -> &str {
        match self.network {
            Network::Preprod => "5b3132372c37332c3132342c3136312c362c3133372c3133312c3231332c3230372c3131372c3139382c38352c3137362c3139392c3136322c3234312c36382c3132332c3131392c3134352c31332c3233322c3234332c34392c3232392c322c3234392c3230352c3230352c33392c3233352c34345d",
            Network::Mainnet => "5b3132372c37332c3132342c3136312c362c3133372c3133312c3231332c3230372c3131372c3139382c38352c3137362c3139392c3136322c3234312c36382c3132332c3131392c3134352c31332c3233322c3234332c34392c3232392c322c3234392c3230352c3230352c33392c3233352c34345d",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = AppConfig::default();
        assert_eq!(config.network, Network::Preprod);
        assert_eq!(config.ogmios_port, 1337);
        assert_eq!(config.kupo_port, 1442);
        assert!(config.auto_start_node);
    }

    #[test]
    fn test_network_display() {
        assert_eq!(Network::Preprod.to_string(), "preprod");
        assert_eq!(Network::Mainnet.to_string(), "mainnet");
    }

    #[test]
    fn test_directory_paths() {
        let config = AppConfig::default();
        let base = PathBuf::from("/tmp/test-app");
        assert_eq!(config.chain_data_dir(&base), PathBuf::from("/tmp/test-app/preprod"));
        assert_eq!(config.node_db_dir(&base), PathBuf::from("/tmp/test-app/preprod/node-db"));
        assert_eq!(config.kupo_db_dir(&base), PathBuf::from("/tmp/test-app/preprod/kupo-db"));
        assert_eq!(
            config.node_socket_path(&base),
            PathBuf::from("/tmp/test-app/preprod/node.socket")
        );
    }
}
