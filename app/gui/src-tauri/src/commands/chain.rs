use crate::config::AppConfig;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct ChainTip {
    pub block_no: u64,
    pub epoch_no: u64,
    pub block_time: u64,
}

#[tauri::command]
pub async fn get_network_tip(config: tauri::State<'_, AppConfig>) -> Result<ChainTip, String> {
    let url = format!("{}/tip", config.koios_base_url());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let res = client.get(&url).send().await.map_err(|e| {
        if e.is_timeout() {
            "Koios request timed out".to_string()
        } else if e.is_connect() {
            "Failed to connect to Koios".to_string()
        } else {
            format!("Koios request failed: {e}")
        }
    })?;

    if !res.status().is_success() {
        return Err(format!("Koios returned status {}", res.status()));
    }

    let body: Vec<ChainTip> = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse Koios tip response: {e}"))?;

    body.into_iter()
        .next()
        .ok_or_else(|| "No tip data returned from Koios".to_string())
}
