/// Tauri IPC proxy for Kupo and Ogmios HTTP requests.
///
/// WebKitGTK enforces CORS differently across versions. Kupo and Ogmios
/// are third-party binaries that serve no CORS headers, so direct `fetch()`
/// from the webview fails on some Linux distros. Routing through Tauri IPC
/// (`invoke` → `reqwest`) bypasses browser CORS entirely.
fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))
}

/// Fetch a URL from the local Kupo instance (port 44203).
/// Validates the URL prefix to prevent SSRF.
#[tauri::command]
pub async fn kupo_fetch(url: String) -> Result<String, String> {
    if !url.starts_with("http://127.0.0.1:44203/") {
        return Err("Invalid Kupo URL: must target 127.0.0.1:44203".to_string());
    }

    let client = build_client()?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Kupo request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Kupo returned {}", resp.status()));
    }

    resp.text()
        .await
        .map_err(|e| format!("Failed to read Kupo response: {e}"))
}

/// Fetch a URL from the local Ogmios instance (port 1337).
/// Validates the URL prefix to prevent SSRF.
#[tauri::command]
pub async fn ogmios_fetch(url: String) -> Result<String, String> {
    if !url.starts_with("http://127.0.0.1:1337/") {
        return Err("Invalid Ogmios URL: must target 127.0.0.1:1337".to_string());
    }

    let client = build_client()?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Ogmios request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Ogmios returned {}", resp.status()));
    }

    resp.text()
        .await
        .map_err(|e| format!("Failed to read Ogmios response: {e}"))
}
