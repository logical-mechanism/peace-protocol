use crate::crypto::secrets::{secure_delete, SecretsKey};
use std::path::Path;

use super::secrets::SecretsDir;

use crate::crypto::secrets::{decrypt_secret, encrypt_secret, EncryptedSecret};

// ── Constants ────────────────────────────────────────────────────────────

const IAGON_BASE: &str = "https://gw.iagon.com/api/v2";

// ── Helpers ─────────────────────────────────────────────────────────────

fn get_secrets_key(key_state: &SecretsKey) -> Result<[u8; 32], String> {
    let guard = key_state
        .0
        .lock()
        .map_err(|_| "Internal error: secrets key lock poisoned".to_string())?;
    match *guard {
        Some(key) => Ok(key),
        None => Err("Wallet is locked — unlock to access secrets".to_string()),
    }
}

fn encrypt_and_write(key: &[u8; 32], path: &Path, data: &[u8]) -> Result<(), String> {
    let encrypted = encrypt_secret(key, data)?;
    let json = serde_json::to_string_pretty(&encrypted)
        .map_err(|e| format!("Failed to serialize encrypted secret: {e}"))?;
    std::fs::write(path, json).map_err(|e| format!("Failed to write secret: {e}"))?;
    Ok(())
}

fn read_and_decrypt(key: &[u8; 32], path: &Path) -> Result<Vec<u8>, String> {
    let json = std::fs::read_to_string(path).map_err(|e| format!("Failed to read secret: {e}"))?;
    let encrypted: EncryptedSecret =
        serde_json::from_str(&json).map_err(|e| format!("Invalid secret file: {e}"))?;
    decrypt_secret(key, &encrypted)
}

fn iagon_dir(base: &Path) -> std::path::PathBuf {
    base.join("iagon")
}

const API_KEY_FILENAME: &str = "api_key.json";

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))
}

/// Map a reqwest error or non-2xx status into a user-friendly message.
fn map_iagon_error(status: reqwest::StatusCode, body: &str) -> String {
    match status.as_u16() {
        401 | 403 => "Authentication failed. Your API key may be expired or invalid.".to_string(),
        404 => "Iagon endpoint not found. The API may have changed.".to_string(),
        500..=599 => format!("Iagon server error ({status}). Try again later."),
        _ => {
            // Try to extract a message from JSON body
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(body) {
                if let Some(msg) = v.get("message").and_then(|m| m.as_str()) {
                    return format!("Iagon: {msg}");
                }
            }
            format!("Iagon request failed ({status})")
        }
    }
}

fn map_reqwest_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "Cannot reach Iagon servers. Request timed out.".to_string()
    } else if e.is_connect() {
        "Cannot reach Iagon servers. Check your internet connection.".to_string()
    } else {
        format!("Iagon request failed: {e}")
    }
}

// ── Iagon API key storage ───────────────────────────────────────────────

#[tauri::command]
pub fn store_iagon_api_key(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
    api_key: String,
) -> Result<(), String> {
    let key = get_secrets_key(&key_state)?;
    let dir = iagon_dir(&state.0);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create iagon secrets dir: {e}"))?;
    encrypt_and_write(&key, &dir.join(API_KEY_FILENAME), api_key.as_bytes())
}

#[tauri::command]
pub fn get_iagon_api_key(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
) -> Result<Option<String>, String> {
    let key = get_secrets_key(&key_state)?;
    let path = iagon_dir(&state.0).join(API_KEY_FILENAME);
    if !path.exists() {
        return Ok(None);
    }
    let plaintext = read_and_decrypt(&key, &path)?;
    let api_key = String::from_utf8(plaintext)
        .map_err(|_| "Decrypted data is not valid UTF-8".to_string())?;
    Ok(Some(api_key))
}

#[tauri::command]
pub fn remove_iagon_api_key(state: tauri::State<'_, SecretsDir>) -> Result<(), String> {
    let path = iagon_dir(&state.0).join(API_KEY_FILENAME);
    secure_delete(&path)
}

#[tauri::command]
pub fn has_iagon_api_key(state: tauri::State<'_, SecretsDir>) -> Result<bool, String> {
    let path = iagon_dir(&state.0).join(API_KEY_FILENAME);
    Ok(path.exists())
}

// ── Iagon HTTP proxy commands (bypass CORS) ─────────────────────────────

#[tauri::command]
pub async fn iagon_get_nonce(address: String) -> Result<String, String> {
    let client = build_client()?;
    let res = client
        .post(format!("{IAGON_BASE}/public/nonce"))
        .json(&serde_json::json!({ "publicAddress": address }))
        .send()
        .await
        .map_err(map_reqwest_error)?;

    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(map_iagon_error(status, &body));
    }
    let v: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Invalid response from Iagon: {e}"))?;
    v.get("nonce")
        .and_then(|n| n.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Iagon nonce response missing 'nonce' field".to_string())
}

#[derive(serde::Serialize)]
pub struct IagonVerifyResult {
    pub id: String,
    pub session: String,
}

#[tauri::command]
pub async fn iagon_verify(
    address: String,
    signature: String,
    key: String,
) -> Result<IagonVerifyResult, String> {
    let client = build_client()?;
    let res = client
        .post(format!("{IAGON_BASE}/public/verify"))
        .json(&serde_json::json!({
            "publicAddress": address,
            "signature": signature,
            "key": key,
        }))
        .send()
        .await
        .map_err(map_reqwest_error)?;

    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(map_iagon_error(status, &body));
    }
    let v: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Invalid response from Iagon: {e}"))?;
    let id = v
        .get("id")
        .and_then(|n| n.as_str())
        .unwrap_or_default()
        .to_string();
    let session = v
        .get("session")
        .and_then(|n| n.as_str())
        .ok_or_else(|| "Iagon verify response missing 'session' field".to_string())?
        .to_string();
    Ok(IagonVerifyResult { id, session })
}

#[tauri::command]
pub async fn iagon_generate_api_key(session_token: String, name: String) -> Result<String, String> {
    let client = build_client()?;
    let res = client
        .post(format!("{IAGON_BASE}/key/generate"))
        .header("Authorization", format!("Bearer {session_token}"))
        .json(&serde_json::json!({ "api_key_name": name }))
        .send()
        .await
        .map_err(map_reqwest_error)?;

    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(map_iagon_error(status, &body));
    }
    let v: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Invalid response from Iagon: {e}"))?;
    if v.get("success").and_then(|s| s.as_bool()) != Some(true) {
        let msg = v
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        return Err(format!("Iagon API key generation failed: {msg}"));
    }
    v.get("data")
        .and_then(|d| d.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Iagon generateApiKey response missing 'data' field".to_string())
}

#[tauri::command]
pub async fn iagon_verify_api_key(api_key: String) -> Result<bool, String> {
    let client = build_client()?;
    let res = client
        .post(format!("{IAGON_BASE}/key/verify"))
        .json(&serde_json::json!({ "api_key": api_key }))
        .send()
        .await
        .map_err(map_reqwest_error)?;

    if !res.status().is_success() {
        return Ok(false);
    }
    let body = res.text().await.unwrap_or_default();
    let v: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
    Ok(v.get("success").and_then(|s| s.as_bool()) == Some(true))
}

// ── Storage proxy commands ──────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
pub struct IagonFileInfo {
    pub _id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub unique_id: String,
    #[serde(default)]
    pub file_size_byte_native: u64,
    #[serde(default)]
    pub file_size_byte_encrypted: u64,
}

#[tauri::command]
pub async fn iagon_upload(
    api_key: String,
    file_data: Vec<u8>,
    filename: String,
) -> Result<IagonFileInfo, String> {
    let client = build_client()?;
    let part = reqwest::multipart::Part::bytes(file_data)
        .file_name(filename.clone())
        .mime_str("application/octet-stream")
        .map_err(|e| format!("Failed to create upload part: {e}"))?;

    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("filename", filename)
        .text("visibility", "public");

    let res = client
        .post(format!("{IAGON_BASE}/storage/upload"))
        .header("x-api-key", &api_key)
        .multipart(form)
        .send()
        .await
        .map_err(map_reqwest_error)?;

    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(map_iagon_error(status, &body));
    }
    let v: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Invalid upload response: {e}"))?;
    if v.get("success").and_then(|s| s.as_bool()) != Some(true) {
        let msg = v
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        return Err(format!("Iagon upload failed: {msg}"));
    }
    let data = v
        .get("data")
        .ok_or_else(|| "Iagon upload response missing 'data' field".to_string())?;
    serde_json::from_value(data.clone()).map_err(|e| format!("Failed to parse upload result: {e}"))
}

#[tauri::command]
pub async fn iagon_download(api_key: String, file_id: String) -> Result<Vec<u8>, String> {
    let client = build_client()?;
    let form = reqwest::multipart::Form::new().text("id", file_id);

    let res = client
        .post(format!("{IAGON_BASE}/storage/download"))
        .header("x-api-key", &api_key)
        .multipart(form)
        .send()
        .await
        .map_err(map_reqwest_error)?;

    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(map_iagon_error(status, &body));
    }
    res.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("Failed to read download response: {e}"))
}

#[tauri::command]
pub async fn iagon_delete_file(api_key: String, file_id: String) -> Result<(), String> {
    let client = build_client()?;
    let res = client
        .delete(format!("{IAGON_BASE}/storage/file/{file_id}"))
        .header("x-api-key", &api_key)
        .send()
        .await
        .map_err(map_reqwest_error)?;

    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(map_iagon_error(status, &body));
    }
    Ok(())
}
