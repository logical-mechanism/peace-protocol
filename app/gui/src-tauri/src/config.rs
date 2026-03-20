use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub enum Network {
    #[default]
    Preprod,
    Mainnet,
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
    /// Empty values are skipped to avoid overriding Express defaults with empty strings.
    pub fn to_env_vars(&self, network: &Network) -> Vec<(String, String)> {
        let suffix = match network {
            Network::Preprod => "PREPROD",
            Network::Mainnet => "MAINNET",
        };
        vec![
            (
                format!("ENCRYPTION_CONTRACT_ADDRESS_{suffix}"),
                self.encryption_address.clone(),
            ),
            (
                format!("BIDDING_CONTRACT_ADDRESS_{suffix}"),
                self.bidding_address.clone(),
            ),
            (
                format!("REFERENCE_CONTRACT_ADDRESS_{suffix}"),
                self.reference_address.clone(),
            ),
            (
                format!("ENCRYPTION_POLICY_ID_{suffix}"),
                self.encryption_policy_id.clone(),
            ),
            (
                format!("BIDDING_POLICY_ID_{suffix}"),
                self.bidding_policy_id.clone(),
            ),
            (
                format!("GROTH_POLICY_ID_{suffix}"),
                self.groth_policy_id.clone(),
            ),
            (
                format!("GENESIS_POLICY_ID_{suffix}"),
                self.genesis_policy_id.clone(),
            ),
            (
                format!("GENESIS_TOKEN_NAME_{suffix}"),
                self.genesis_token_name.clone(),
            ),
            (
                format!("ENCRYPTION_REF_TX_HASH_{suffix}"),
                self.encryption_ref_tx_hash.clone(),
            ),
            (
                format!("ENCRYPTION_REF_OUTPUT_INDEX_{suffix}"),
                self.encryption_ref_output_index.to_string(),
            ),
            (
                format!("BIDDING_REF_TX_HASH_{suffix}"),
                self.bidding_ref_tx_hash.clone(),
            ),
            (
                format!("BIDDING_REF_OUTPUT_INDEX_{suffix}"),
                self.bidding_ref_output_index.to_string(),
            ),
            (
                format!("GROTH_REF_TX_HASH_{suffix}"),
                self.groth_ref_tx_hash.clone(),
            ),
            (
                format!("GROTH_REF_OUTPUT_INDEX_{suffix}"),
                self.groth_ref_output_index.to_string(),
            ),
        ]
        .into_iter()
        .filter(|(_, v)| !v.is_empty())
        .collect()
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
            kupo_port: 44203,
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
    /// Returns `(config, used_defaults)`. `used_defaults` is true when config.json
    /// was not found at either path and the app is running with default values.
    ///
    /// Edit `src-tauri/resources/config.json` to set contract addresses before building.
    pub fn load(_resource_dir: &Path) -> (Self, bool) {
        // Try the resource dir that Tauri resolved (works in prod builds)
        for path in [
            _resource_dir.join("resources/config.json"),
            // Dev fallback: CARGO_MANIFEST_DIR/resources/config.json
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/config.json"),
        ] {
            if path.exists() {
                if let Ok(contents) = std::fs::read_to_string(&path) {
                    match serde_json::from_str(&contents) {
                        Ok(config) => return (config, false),
                        Err(e) => eprintln!("Failed to parse {}: {e}", path.display()),
                    }
                }
            }
        }

        eprintln!(
            "Warning: config.json not found at either path, using defaults. \
             Contract addresses will be incorrect."
        );
        (Self::default(), true)
    }

    /// Save config to a specific file path.
    pub fn save_to(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config dir: {e}"))?;
        }
        let json =
            serde_json::to_string_pretty(self).map_err(|e| format!("Failed to serialize: {e}"))?;
        std::fs::write(path, json).map_err(|e| format!("Failed to write config: {e}"))
    }

    /// Get the chain data directory for the current network
    pub fn chain_data_dir(&self, app_data_dir: &Path) -> PathBuf {
        app_data_dir.join(self.network.to_string())
    }

    /// Get the node database directory
    pub fn node_db_dir(&self, app_data_dir: &Path) -> PathBuf {
        self.chain_data_dir(app_data_dir).join("node-db")
    }

    /// Get the kupo database directory
    pub fn kupo_db_dir(&self, app_data_dir: &Path) -> PathBuf {
        self.chain_data_dir(app_data_dir).join("kupo-db")
    }

    /// Get the config files directory for the current network
    pub fn config_dir(&self, app_data_dir: &Path) -> PathBuf {
        self.chain_data_dir(app_data_dir).join("config")
    }

    /// Get the node socket path
    pub fn node_socket_path(&self, app_data_dir: &Path) -> PathBuf {
        self.chain_data_dir(app_data_dir).join("node.socket")
    }

    /// Generate all environment variables needed by the Express backend.
    pub fn express_env_vars(&self) -> Vec<(String, String)> {
        let mut vars = vec![
            ("PORT".to_string(), "3001".to_string()),
            ("NODE_ENV".to_string(), "production".to_string()),
            ("NETWORK".to_string(), self.network.to_string()),
            ("USE_STUBS".to_string(), "false".to_string()),
            (
                "KUPO_URL".to_string(),
                format!("http://127.0.0.1:{}", self.kupo_port),
            ),
        ];

        if let Some(ref contracts) = self.contracts {
            vars.extend(contracts.to_env_vars(&self.network));
        }

        vars
    }

    /// Get the Koios REST API base URL for the current network
    pub fn koios_base_url(&self) -> &str {
        match self.network {
            Network::Preprod => "https://preprod.koios.rest/api/v1",
            Network::Mainnet => "https://api.koios.rest/api/v1",
        }
    }

    /// Get the mithril aggregator URL for the current network
    pub fn mithril_aggregator_url(&self) -> &str {
        match self.network {
            Network::Preprod => "https://aggregator.release-preprod.api.mithril.network/aggregator",
            Network::Mainnet => "https://aggregator.release-mainnet.api.mithril.network/aggregator",
        }
    }

    /// Validate semantic correctness of the loaded config.
    /// Returns Ok(()) if valid, Err(message) describing what is wrong.
    pub fn validate(&self) -> Result<(), String> {
        let mut errors: Vec<String> = Vec::new();

        if self.ogmios_port == 0 {
            errors.push("ogmios_port must be > 0".to_string());
        }
        if self.kupo_port == 0 {
            errors.push("kupo_port must be > 0".to_string());
        }

        if self.contracts.is_none() {
            errors.push("contracts configuration is required".to_string());
        }

        if let Some(ref c) = self.contracts {
            // Addresses must be non-empty
            for (name, val) in [
                ("encryption_address", &c.encryption_address),
                ("bidding_address", &c.bidding_address),
                ("reference_address", &c.reference_address),
            ] {
                if val.is_empty() {
                    errors.push(format!("contracts.{name} is empty"));
                }
            }

            // Policy IDs: 56 hex chars
            for (name, val) in [
                ("encryption_policy_id", &c.encryption_policy_id),
                ("bidding_policy_id", &c.bidding_policy_id),
                ("groth_policy_id", &c.groth_policy_id),
                ("genesis_policy_id", &c.genesis_policy_id),
            ] {
                if !val.is_empty() {
                    if val.len() != 56 {
                        errors.push(format!(
                            "contracts.{name} must be 56 hex chars, got {}",
                            val.len()
                        ));
                    }
                    if !val.chars().all(|ch| ch.is_ascii_hexdigit()) {
                        errors.push(format!("contracts.{name} contains non-hex characters"));
                    }
                }
            }

            // Token name: 1-64 hex chars
            if !c.genesis_token_name.is_empty() {
                let len = c.genesis_token_name.len();
                if len > 64 {
                    errors.push(format!(
                        "contracts.genesis_token_name must be 1-64 hex chars, got {len}"
                    ));
                }
                if !c
                    .genesis_token_name
                    .chars()
                    .all(|ch| ch.is_ascii_hexdigit())
                {
                    errors.push(
                        "contracts.genesis_token_name contains non-hex characters".to_string(),
                    );
                }
            }

            // Tx hashes: 64 hex chars
            for (name, val) in [
                ("encryption_ref_tx_hash", &c.encryption_ref_tx_hash),
                ("bidding_ref_tx_hash", &c.bidding_ref_tx_hash),
                ("groth_ref_tx_hash", &c.groth_ref_tx_hash),
            ] {
                if !val.is_empty() {
                    if val.len() != 64 {
                        errors.push(format!(
                            "contracts.{name} must be 64 hex chars, got {}",
                            val.len()
                        ));
                    }
                    if !val.chars().all(|ch| ch.is_ascii_hexdigit()) {
                        errors.push(format!("contracts.{name} contains non-hex characters"));
                    }
                }
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "Config validation failed:\n- {}",
                errors.join("\n- ")
            ))
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

    /// Get the mithril ancillary verification key for the current network.
    /// Required for --include-ancillary (ledger state snapshot download).
    /// Keys from: https://github.com/input-output-hk/mithril/tree/main/mithril-infra/configuration/
    pub fn mithril_ancillary_vkey(&self) -> &str {
        match self.network {
            Network::Preprod => "5b3138392c3139322c3231362c3135302c3131342c3231362c3233372c3231302c34352c31382c32312c3139362c3230382c3234362c3134362c322c3235322c3234332c3235312c3139372c32382c3135372c3230342c3134352c33302c31342c3232382c3136382c3132392c38332c3133362c33365d",
            Network::Mainnet => "5b32332c37312c39362c3133332c34372c3235332c3232362c3133362c3233352c35372c3136342c3130362c3138362c322c32312c32392c3132302c3136332c38392c3132312c3137372c3133382c3230382c3133382c3231342c39392c35382c32322c302c35382c332c36395d",
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
        assert_eq!(config.kupo_port, 44203);
        assert!(config.auto_start_node);
    }

    #[test]
    fn test_network_display() {
        assert_eq!(Network::Preprod.to_string(), "preprod");
        assert_eq!(Network::Mainnet.to_string(), "mainnet");
    }

    fn make_valid_contracts() -> ContractConfig {
        ContractConfig {
            encryption_address: "addr_test1abc".to_string(),
            bidding_address: "addr_test1def".to_string(),
            reference_address: "addr_test1ghi".to_string(),
            script_reference_address: "addr_test1jkl".to_string(),
            encryption_policy_id: "a".repeat(56),
            bidding_policy_id: "b".repeat(56),
            groth_policy_id: "c".repeat(56),
            genesis_policy_id: "d".repeat(56),
            genesis_token_name: "e".repeat(64),
            encryption_ref_tx_hash: "1".repeat(64),
            encryption_ref_output_index: 0,
            bidding_ref_tx_hash: "2".repeat(64),
            bidding_ref_output_index: 1,
            groth_ref_tx_hash: "3".repeat(64),
            groth_ref_output_index: 1,
        }
    }

    #[test]
    fn test_validate_default_config_requires_contracts() {
        let err = AppConfig::default().validate().unwrap_err();
        assert!(err.contains("contracts configuration is required"));
    }

    #[test]
    fn test_validate_with_valid_contracts() {
        let config = AppConfig {
            contracts: Some(make_valid_contracts()),
            ..Default::default()
        };
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_validate_zero_port() {
        let config = AppConfig {
            ogmios_port: 0,
            ..Default::default()
        };
        let err = config.validate().unwrap_err();
        assert!(err.contains("ogmios_port must be > 0"));
    }

    #[test]
    fn test_validate_bad_policy_id_length() {
        let mut contracts = make_valid_contracts();
        contracts.encryption_policy_id = "abc".to_string();
        let config = AppConfig {
            contracts: Some(contracts),
            ..Default::default()
        };
        let err = config.validate().unwrap_err();
        assert!(err.contains("encryption_policy_id must be 56 hex chars"));
    }

    #[test]
    fn test_validate_non_hex_policy_id() {
        let mut contracts = make_valid_contracts();
        contracts.groth_policy_id = "z".repeat(56);
        let config = AppConfig {
            contracts: Some(contracts),
            ..Default::default()
        };
        let err = config.validate().unwrap_err();
        assert!(err.contains("groth_policy_id contains non-hex"));
    }

    #[test]
    fn test_validate_bad_tx_hash() {
        let mut contracts = make_valid_contracts();
        contracts.bidding_ref_tx_hash = "ab".to_string();
        let config = AppConfig {
            contracts: Some(contracts),
            ..Default::default()
        };
        let err = config.validate().unwrap_err();
        assert!(err.contains("bidding_ref_tx_hash must be 64 hex chars"));
    }

    #[test]
    fn test_validate_empty_address() {
        let mut contracts = make_valid_contracts();
        contracts.encryption_address = String::new();
        let config = AppConfig {
            contracts: Some(contracts),
            ..Default::default()
        };
        let err = config.validate().unwrap_err();
        assert!(err.contains("encryption_address is empty"));
    }

    #[test]
    fn test_validate_no_contracts_fails() {
        let config = AppConfig {
            contracts: None,
            ..Default::default()
        };
        let err = config.validate().unwrap_err();
        assert!(err.contains("contracts configuration is required"));
    }

    #[test]
    fn test_directory_paths() {
        let config = AppConfig::default();
        let base = PathBuf::from("/tmp/test-app");
        assert_eq!(
            config.chain_data_dir(&base),
            PathBuf::from("/tmp/test-app/preprod")
        );
        assert_eq!(
            config.node_db_dir(&base),
            PathBuf::from("/tmp/test-app/preprod/node-db")
        );
        assert_eq!(
            config.kupo_db_dir(&base),
            PathBuf::from("/tmp/test-app/preprod/kupo-db")
        );
        assert_eq!(
            config.node_socket_path(&base),
            PathBuf::from("/tmp/test-app/preprod/node.socket")
        );
    }
}
