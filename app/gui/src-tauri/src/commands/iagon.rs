use crate::crypto::audit::AuditLog;
use crate::crypto::secrets::{secure_delete, SecretsKey};
use std::path::Path;
use zeroize::Zeroizing;

use super::media::ContentDir;
use super::secrets::SecretsDir;

use crate::crypto::secrets::{decrypt_secret, encrypt_secret, EncryptedSecret};

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use rand::RngCore;
use sha2::{Digest, Sha256};

// ── Constants ────────────────────────────────────────────────────────────

const IAGON_BASE: &str = "https://gw.iagon.com/api/v2";

// ── Helpers ─────────────────────────────────────────────────────────────

fn get_secrets_key(key_state: &SecretsKey) -> Result<Zeroizing<[u8; 32]>, String> {
    let guard = key_state
        .0
        .lock()
        .map_err(|_| "Internal error: secrets key lock poisoned".to_string())?;
    match guard.as_ref() {
        Some(key) => Ok(key.clone()),
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

fn validate_api_key(api_key: &str) -> Result<(), String> {
    if api_key.is_empty() {
        return Err("API key must not be empty".to_string());
    }
    if api_key.len() > 1024 {
        return Err("API key too long".to_string());
    }
    Ok(())
}

fn build_client() -> Result<reqwest::Client, String> {
    build_client_with_timeout(60)
}

fn build_client_with_timeout(secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(secs))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))
}

/// Build a structured JSON error string with code and message.
/// Frontend can parse the code for specific handling (e.g. re-auth on AUTH_FAILED).
fn iagon_error_json(code: &str, message: &str) -> String {
    serde_json::json!({ "code": code, "message": message }).to_string()
}

/// Map a non-2xx HTTP status into a structured JSON error.
fn map_iagon_error(status: reqwest::StatusCode, body: &str) -> String {
    match status.as_u16() {
        401 | 403 => iagon_error_json(
            "AUTH_FAILED",
            "Authentication failed. Your API key may be expired or invalid.",
        ),
        404 => iagon_error_json(
            "NOT_FOUND",
            "Iagon endpoint not found. The API may have changed.",
        ),
        413 => iagon_error_json(
            "FILE_TOO_LARGE",
            "File exceeds Iagon's upload size limit. Try a smaller file (under 200 MB).",
        ),
        500..=599 => iagon_error_json(
            "SERVER_ERROR",
            &format!("Iagon server error ({status}). Try again later."),
        ),
        _ => {
            // Try to extract a message from JSON body
            let msg = serde_json::from_str::<serde_json::Value>(body)
                .ok()
                .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from));
            let message = msg.unwrap_or_else(|| format!("Iagon request failed ({status})"));
            iagon_error_json("UNKNOWN", &message)
        }
    }
}

/// Map a reqwest transport error into a structured JSON error.
fn map_reqwest_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        iagon_error_json("TIMEOUT", "Cannot reach Iagon servers. Request timed out.")
    } else if e.is_connect() {
        iagon_error_json(
            "CONNECTION",
            "Cannot reach Iagon servers. Check your internet connection.",
        )
    } else {
        iagon_error_json("UNKNOWN", &format!("Iagon request failed: {e}"))
    }
}

// ── Iagon API key storage ───────────────────────────────────────────────

#[tauri::command]
pub fn store_iagon_api_key(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
    audit: tauri::State<'_, AuditLog>,
    api_key: String,
) -> Result<(), String> {
    validate_api_key(&api_key)?;
    let key = get_secrets_key(&key_state)?;
    let dir = iagon_dir(&state.0);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create iagon secrets dir: {e}"))?;
    let result = encrypt_and_write(&key, &dir.join(API_KEY_FILENAME), api_key.as_bytes());
    audit.log("WRITE", "iagon/api_key.json");
    result
}

#[tauri::command]
pub fn get_iagon_api_key(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
    audit: tauri::State<'_, AuditLog>,
) -> Result<Option<String>, String> {
    let key = get_secrets_key(&key_state)?;
    let path = iagon_dir(&state.0).join(API_KEY_FILENAME);
    if !path.exists() {
        return Ok(None);
    }
    audit.log("READ", "iagon/api_key.json");
    let plaintext = read_and_decrypt(&key, &path)?;
    let api_key = String::from_utf8(plaintext)
        .map_err(|_| "Decrypted data is not valid UTF-8".to_string())?;
    Ok(Some(api_key))
}

#[tauri::command]
pub fn remove_iagon_api_key(
    state: tauri::State<'_, SecretsDir>,
    audit: tauri::State<'_, AuditLog>,
) -> Result<(), String> {
    let path = iagon_dir(&state.0).join(API_KEY_FILENAME);
    audit.log("DELETE", "iagon/api_key.json");
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

    // Iagon download expects application/x-www-form-urlencoded, NOT multipart/form-data
    let params = [("id", file_id.as_str())];

    let res = client
        .post(format!("{IAGON_BASE}/storage/download/"))
        .header("x-api-key", &api_key)
        .form(&params)
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

#[derive(serde::Serialize, serde::Deserialize)]
pub struct IagonSearchResult {
    pub files: Vec<IagonFileInfo>,
}

#[tauri::command]
pub async fn iagon_search_files(
    api_key: String,
    query: String,
) -> Result<IagonSearchResult, String> {
    let client = build_client()?;
    let res = client
        .get(format!("{IAGON_BASE}/storage/filter"))
        .header("x-api-key", &api_key)
        .query(&[
            ("q", query.as_str()),
            ("visibility", "public"),
            ("listingType", "index"),
        ])
        .send()
        .await
        .map_err(map_reqwest_error)?;

    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(map_iagon_error(status, &body));
    }
    let v: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Invalid search response: {e}"))?;
    let files = v
        .get("files")
        .cloned()
        .unwrap_or(serde_json::Value::Array(vec![]));
    let files: Vec<IagonFileInfo> = serde_json::from_value(files)
        .map_err(|e| format!("Failed to parse search results: {e}"))?;
    Ok(IagonSearchResult { files })
}

#[tauri::command]
pub async fn iagon_list_files(api_key: String) -> Result<IagonSearchResult, String> {
    let client = build_client()?;
    let res = client
        .get(format!("{IAGON_BASE}/storage/directory"))
        .header("x-api-key", &api_key)
        .query(&[("visibility", "public"), ("listingType", "index")])
        .send()
        .await
        .map_err(map_reqwest_error)?;

    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(map_iagon_error(status, &body));
    }
    let v: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Invalid directory response: {e}"))?;
    let files = v
        .pointer("/data/files")
        .cloned()
        .unwrap_or(serde_json::Value::Array(vec![]));
    let files: Vec<IagonFileInfo> =
        serde_json::from_value(files).map_err(|e| format!("Failed to parse file list: {e}"))?;
    Ok(IagonSearchResult { files })
}

// ── Helpers for hex encoding/decoding ────────────────────────────────────

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn hex_to_bytes(hex: &str) -> Result<Vec<u8>, String> {
    if !hex.len().is_multiple_of(2) {
        return Err("Hex string has odd length".to_string());
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).map_err(|e| format!("Invalid hex: {e}")))
        .collect()
}

// ── File-based encrypt+upload / download+save commands ──────────────────

/// Maximum file size for encrypt+upload (1 GB).
const MAX_FILE_SIZE: u64 = 1_073_741_824;

/// Valid content categories (must match media.rs VALID_CATEGORIES).
const VALID_CATEGORIES: &[&str] = &["text", "document", "audio", "image", "video", "other"];

#[derive(serde::Serialize)]
pub struct IagonEncryptUploadResult {
    pub file_info: IagonFileInfo,
    pub key_hex: String,
    pub nonce_hex: String,
    pub digest_hex: String,
}

/// Encrypt a file on disk with AES-256-GCM and upload to Iagon.
///
/// This avoids the Tauri IPC JSON serialization bottleneck by reading the file
/// directly from disk in Rust rather than receiving bytes through invoke().
#[tauri::command]
pub async fn iagon_encrypt_and_upload(
    api_key: String,
    file_path: String,
    filename: String,
) -> Result<IagonEncryptUploadResult, String> {
    // Validate file exists and is within size limit
    let path = std::path::Path::new(&file_path);
    if !path.exists() || !path.is_file() {
        return Err("File not found".to_string());
    }
    let metadata =
        std::fs::metadata(path).map_err(|e| format!("Failed to read file metadata: {e}"))?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(format!(
            "File too large: {} bytes (max {} bytes)",
            metadata.len(),
            MAX_FILE_SIZE
        ));
    }

    // Read file from disk
    let plaintext = std::fs::read(path).map_err(|e| format!("Failed to read file: {e}"))?;

    // Generate random AES-256 key (32 bytes) and GCM nonce (12 bytes)
    let mut key_bytes = [0u8; 32];
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut key_bytes);
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    // SHA-256 digest of original plaintext
    let digest = Sha256::digest(&plaintext);

    // AES-256-GCM encrypt (no AAD — matches Web Crypto API in fileEncryption.ts)
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| format!("Failed to create AES cipher: {e}"))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let encrypted = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| format!("AES-GCM encryption failed: {e}"))?;

    // Drop plaintext to free memory before upload
    drop(plaintext);

    // Timeout scales with file size: 30s base + 3s per MB (assumes ≥330 KB/s upload).
    let file_mb = (encrypted.len() as u64).saturating_add(1_048_575) / 1_048_576;
    let timeout_secs = 30 + file_mb * 3;
    let client = build_client_with_timeout(timeout_secs)?;
    let part = reqwest::multipart::Part::bytes(encrypted)
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
    let file_info: IagonFileInfo = serde_json::from_value(data.clone())
        .map_err(|e| format!("Failed to parse upload result: {e}"))?;

    Ok(IagonEncryptUploadResult {
        file_info,
        key_hex: bytes_to_hex(&key_bytes),
        nonce_hex: bytes_to_hex(&nonce_bytes),
        digest_hex: bytes_to_hex(&digest),
    })
}

#[derive(serde::Serialize)]
pub struct IagonDownloadSaveResult {
    pub path: String,
    pub size: u64,
}

/// Download a file from Iagon, decrypt with AES-256-GCM, verify digest, and save to content dir.
///
/// This avoids the Tauri IPC JSON serialization bottleneck by keeping all byte
/// operations in Rust rather than returning bytes through invoke().
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn iagon_download_and_save(
    api_key: String,
    file_id: String,
    key_hex: String,
    nonce_hex: String,
    digest_hex: Option<String>,
    token_name: String,
    category: String,
    file_name: String,
    state: tauri::State<'_, ContentDir>,
) -> Result<IagonDownloadSaveResult, String> {
    // Validate inputs
    if !VALID_CATEGORIES.contains(&category.as_str()) {
        return Err(format!("Invalid category: {category}"));
    }
    if token_name.is_empty() || token_name.len() > 64 {
        return Err("Invalid token name".to_string());
    }
    if file_name.is_empty() || file_name.contains('/') || file_name.contains('\\') {
        return Err("Invalid file name".to_string());
    }

    // Decode hex key and nonce
    let key_bytes = hex_to_bytes(&key_hex)?;
    let nonce_bytes = hex_to_bytes(&nonce_hex)?;
    if key_bytes.len() != 32 {
        return Err(format!("AES key must be 32 bytes, got {}", key_bytes.len()));
    }
    if nonce_bytes.len() != 12 {
        return Err(format!(
            "GCM nonce must be 12 bytes, got {}",
            nonce_bytes.len()
        ));
    }

    // Download encrypted file from Iagon (10 min timeout for large files)
    let client = build_client_with_timeout(600)?;
    let params = [("id", file_id.as_str())];
    let res = client
        .post(format!("{IAGON_BASE}/storage/download/"))
        .header("x-api-key", &api_key)
        .form(&params)
        .send()
        .await
        .map_err(map_reqwest_error)?;

    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(map_iagon_error(status, &body));
    }
    let encrypted = res
        .bytes()
        .await
        .map_err(|e| format!("Failed to read download response: {e}"))?;

    // Decrypt with AES-256-GCM (no AAD — matches Web Crypto API)
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| format!("Failed to create AES cipher: {e}"))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let decrypted = cipher.decrypt(nonce, encrypted.as_ref()).map_err(|_| {
        "AES-GCM decryption failed: invalid key, nonce, or corrupted data".to_string()
    })?;

    // Drop encrypted blob to free memory
    drop(encrypted);

    // Verify SHA-256 digest if provided
    if let Some(ref expected_hex) = digest_hex {
        let actual = Sha256::digest(&decrypted);
        let actual_hex = bytes_to_hex(&actual);
        if actual_hex != *expected_hex {
            return Err("File integrity check failed: content has been tampered with".to_string());
        }
    }

    // Save to content directory: media/content/{category}/{token_name}/{file_name}
    let token_dir = state.0.join(&category).join(&token_name);
    std::fs::create_dir_all(&token_dir)
        .map_err(|e| format!("Failed to create content directory: {e}"))?;

    let file_path = token_dir.join(&file_name);
    let size = decrypted.len() as u64;
    std::fs::write(&file_path, &decrypted).map_err(|e| format!("Failed to save content: {e}"))?;

    let path_str = file_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "File path contains invalid UTF-8".to_string())?;

    Ok(IagonDownloadSaveResult {
        path: path_str,
        size,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_api_key() {
        assert!(validate_api_key("").is_err());
    }

    #[test]
    fn rejects_oversized_api_key() {
        let long = "a".repeat(1025);
        assert!(validate_api_key(&long).is_err());
    }

    #[test]
    fn accepts_normal_api_key() {
        assert!(validate_api_key("sk-abc123-def456").is_ok());
    }

    #[test]
    fn accepts_max_length_api_key() {
        let max = "x".repeat(1024);
        assert!(validate_api_key(&max).is_ok());
    }

    #[test]
    fn hex_roundtrip() {
        let original = vec![0u8, 1, 127, 128, 255];
        let hex = bytes_to_hex(&original);
        assert_eq!(hex, "00017f80ff");
        let decoded = hex_to_bytes(&hex).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn hex_to_bytes_rejects_odd_length() {
        assert!(hex_to_bytes("abc").is_err());
    }

    #[test]
    fn aes_gcm_roundtrip() {
        // Verify our AES-256-GCM encrypt/decrypt matches the Web Crypto API format
        let plaintext = b"hello world test data for AES-GCM compatibility";
        let mut key = [0u8; 32];
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut key);
        rand::thread_rng().fill_bytes(&mut nonce_bytes);

        let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
        let nonce = Nonce::from_slice(&nonce_bytes);

        // Encrypt
        let encrypted = cipher.encrypt(nonce, plaintext.as_ref()).unwrap();
        // ciphertext should be plaintext.len() + 16 (auth tag)
        assert_eq!(encrypted.len(), plaintext.len() + 16);

        // Decrypt
        let decrypted = cipher.decrypt(nonce, encrypted.as_ref()).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn aes_gcm_wrong_key_fails() {
        let plaintext = b"secret data";
        let mut key = [0u8; 32];
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut key);
        rand::thread_rng().fill_bytes(&mut nonce_bytes);

        let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
        let nonce = Nonce::from_slice(&nonce_bytes);
        let encrypted = cipher.encrypt(nonce, plaintext.as_ref()).unwrap();

        // Wrong key should fail decryption
        let mut wrong_key = key;
        wrong_key[0] ^= 0xff;
        let wrong_cipher = Aes256Gcm::new_from_slice(&wrong_key).unwrap();
        assert!(wrong_cipher.decrypt(nonce, encrypted.as_ref()).is_err());
    }

    #[test]
    fn sha256_digest_consistency() {
        let data = b"test file content";
        let digest1 = Sha256::digest(data);
        let digest2 = Sha256::digest(data);
        assert_eq!(bytes_to_hex(&digest1), bytes_to_hex(&digest2));
        assert_eq!(digest1.len(), 32);
    }
}
