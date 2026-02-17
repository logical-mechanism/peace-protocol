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

/// All protocol contract configuration for a single network.
/// This is the single source of truth — the Express backend receives
/// these values as environment variables when spawned.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractConfig {
    // Script addresses
    pub encryption_address: String,
    pub bidding_address: String,
    pub reference_address: String,
    /// Address holding on-chain script reference UTxOs (encryption, bidding, groth scripts)
    #[serde(default)]
    pub script_reference_address: String,
    // Policy IDs
    #[serde(default)]
    pub encryption_policy_id: String,
    #[serde(default)]
    pub bidding_policy_id: String,
    #[serde(default)]
    pub groth_policy_id: String,
    // Genesis token
    #[serde(default)]
    pub genesis_policy_id: String,
    #[serde(default)]
    pub genesis_token_name: String,
    // Reference script UTxOs
    #[serde(default)]
    pub encryption_ref_tx_hash: String,
    #[serde(default)]
    pub encryption_ref_output_index: u32,
    #[serde(default)]
    pub bidding_ref_tx_hash: String,
    #[serde(default)]
    pub bidding_ref_output_index: u32,
    #[serde(default)]
    pub groth_ref_tx_hash: String,
    #[serde(default)]
    pub groth_ref_output_index: u32,
}

impl ContractConfig {
    /// Generate environment variables for the Express backend.
    /// Uses the network-suffixed naming convention that be/src/config/index.ts expects.
    pub fn to_env_vars(&self, network: &Network) -> Vec<(String, String)> {
        let suffix = match network {
            Network::Preprod => "PREPROD",
            Network::Mainnet => "MAINNET",
        };
        vec![
            (format!("ENCRYPTION_CONTRACT_ADDRESS_{suffix}"), self.encryption_address.clone()),
            (format!("BIDDING_CONTRACT_ADDRESS_{suffix}"), self.bidding_address.clone()),
            (format!("REFERENCE_CONTRACT_ADDRESS_{suffix}"), self.reference_address.clone()),
            (format!("ENCRYPTION_POLICY_ID_{suffix}"), self.encryption_policy_id.clone()),
            (format!("BIDDING_POLICY_ID_{suffix}"), self.bidding_policy_id.clone()),
            (format!("GROTH_POLICY_ID_{suffix}"), self.groth_policy_id.clone()),
            (format!("GENESIS_POLICY_ID_{suffix}"), self.genesis_policy_id.clone()),
            (format!("GENESIS_TOKEN_NAME_{suffix}"), self.genesis_token_name.clone()),
            (format!("ENCRYPTION_REF_TX_HASH_{suffix}"), self.encryption_ref_tx_hash.clone()),
            (format!("ENCRYPTION_REF_OUTPUT_INDEX_{suffix}"), self.encryption_ref_output_index.to_string()),
            (format!("BIDDING_REF_TX_HASH_{suffix}"), self.bidding_ref_tx_hash.clone()),
            (format!("BIDDING_REF_OUTPUT_INDEX_{suffix}"), self.bidding_ref_output_index.to_string()),
            (format!("GROTH_REF_TX_HASH_{suffix}"), self.groth_ref_tx_hash.clone()),
            (format!("GROTH_REF_OUTPUT_INDEX_{suffix}"), self.groth_ref_output_index.to_string()),
        ]
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub network: Network,
    pub ogmios_port: u16,
    pub kupo_port: u16,
    pub auto_start_node: bool,
    /// Protocol contract configuration — set after deployment
    #[serde(default)]
    pub contracts: Option<ContractConfig>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            network: Network::Preprod,
            ogmios_port: 1337,
            kupo_port: 1442,
            auto_start_node: true,
            contracts: None,
        }
    }
}

impl AppConfig {
    /// Load config from the bundled resources/config.json in the project tree.
    /// In dev: reads from src-tauri/resources/config.json
    /// In prod: reads from the bundled resource directory
    ///
    /// Edit `src-tauri/resources/config.json` to set contract addresses before building.
    pub fn load(_resource_dir: &PathBuf) -> Self {
        // Try the resource dir that Tauri resolved (works in prod builds)
        for path in [
            _resource_dir.join("resources/config.json"),
            // Dev fallback: CARGO_MANIFEST_DIR/resources/config.json
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/config.json"),
        ] {
            if path.exists() {
                if let Ok(contents) = std::fs::read_to_string(&path) {
                    match serde_json::from_str(&contents) {
                        Ok(config) => return config,
                        Err(e) => eprintln!("Failed to parse {}: {e}", path.display()),
                    }
                }
            }
        }

        Self::default()
    }

    /// Save config to a specific file path.
    pub fn save_to(&self, path: &PathBuf) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config dir: {e}"))?;
        }
        let json =
            serde_json::to_string_pretty(self).map_err(|e| format!("Failed to serialize: {e}"))?;
        std::fs::write(path, json).map_err(|e| format!("Failed to write config: {e}"))
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

    /// Generate all environment variables needed by the Express backend.
    pub fn express_env_vars(&self) -> Vec<(String, String)> {
        let mut vars = vec![
            ("PORT".to_string(), "3001".to_string()),
            ("NODE_ENV".to_string(), "production".to_string()),
            ("NETWORK".to_string(), self.network.to_string()),
            ("USE_STUBS".to_string(), "false".to_string()),
            ("KUPO_URL".to_string(), format!("http://127.0.0.1:{}", self.kupo_port)),
        ];

        if let Some(ref contracts) = self.contracts {
            vars.extend(contracts.to_env_vars(&self.network));
        }

        vars
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
