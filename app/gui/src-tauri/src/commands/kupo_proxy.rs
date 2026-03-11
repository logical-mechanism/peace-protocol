/// Tauri IPC proxy for Kupo and Ogmios HTTP requests.
///
/// WebKitGTK enforces CORS differently across versions. Kupo and Ogmios
/// are third-party binaries that serve no CORS headers, so direct `fetch()`
/// from the webview fails on some Linux distros. Routing through Tauri IPC
/// (`invoke` → `reqwest`) bypasses browser CORS entirely.
fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(30))
        .no_proxy()
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
        .map_err(|e| format!("Ogmios request failed: {e:?}"))?;

    if !resp.status().is_success() {
        return Err(format!("Ogmios returned {}", resp.status()));
    }

    resp.text()
        .await
        .map_err(|e| format!("Failed to read Ogmios response: {e}"))
}

/// POST a JSON-RPC request to the local Ogmios instance (port 1337).
/// Used for evaluateTransaction and submitTransaction — replaces WebSocket
/// calls that WebKitGTK may block in cross-scheme contexts.
#[tauri::command]
pub async fn ogmios_post(body: String) -> Result<String, String> {
    let url = "http://127.0.0.1:1337";

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(30))
        .no_proxy()
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;
    let resp = client
        .post(url)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                format!("Ogmios POST timed out: the node connection may be degraded ({e:?})")
            } else if e.is_connect() {
                format!("Ogmios POST connect failed: cannot reach Ogmios on port 1337 ({e:?})")
            } else {
                format!("Ogmios POST request failed: {e:?}")
            }
        })?;

    // Don't check status — Ogmios returns HTTP 400 for valid JSON-RPC errors.
    // The frontend parses json.error and throws with the actual error message.
    resp.text()
        .await
        .map_err(|e| format!("Failed to read Ogmios POST response: {e:?}"))
}
