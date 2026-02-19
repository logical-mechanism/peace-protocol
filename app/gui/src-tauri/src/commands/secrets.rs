use crate::crypto::secrets::{
    decrypt_secret, encrypt_secret, secure_delete, EncryptedSecret, SecretsKey,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Managed state holding the base directory for secret storage.
pub struct SecretsDir(pub PathBuf);

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

fn encrypt_and_write(key: &[u8; 32], path: &std::path::Path, data: &[u8]) -> Result<(), String> {
    let encrypted = encrypt_secret(key, data)?;
    let json = serde_json::to_string_pretty(&encrypted)
        .map_err(|e| format!("Failed to serialize encrypted secret: {e}"))?;
    std::fs::write(path, json).map_err(|e| format!("Failed to write secret: {e}"))?;
    Ok(())
}

fn read_and_decrypt(key: &[u8; 32], path: &std::path::Path) -> Result<Vec<u8>, String> {
    let json =
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read secret: {e}"))?;
    let encrypted: EncryptedSecret =
        serde_json::from_str(&json).map_err(|e| format!("Invalid secret file: {e}"))?;
    decrypt_secret(key, &encrypted)
}

fn chrono_now() -> String {
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", dur.as_secs())
}

// ── Seller secrets ──────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct SellerSecretFile {
    token_name: String,
    a: String,
    r: String,
    created_at: String,
}

#[derive(Serialize)]
pub struct SellerSecretResult {
    a: String,
    r: String,
}

fn seller_dir(base: &PathBuf) -> PathBuf {
    base.join("seller")
}

#[tauri::command]
pub fn store_seller_secrets(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
    token_name: String,
    a: String,
    r: String,
) -> Result<(), String> {
    let key = get_secrets_key(&key_state)?;
    let dir = seller_dir(&state.0);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create seller secrets dir: {e}"))?;

    let file = SellerSecretFile {
        token_name: token_name.clone(),
        a,
        r,
        created_at: chrono_now(),
    };
    let plaintext =
        serde_json::to_string(&file).map_err(|e| format!("Failed to serialize: {e}"))?;
    encrypt_and_write(
        &key,
        &dir.join(format!("{token_name}.json")),
        plaintext.as_bytes(),
    )
}

#[tauri::command]
pub fn get_seller_secrets(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
    token_name: String,
) -> Result<Option<SellerSecretResult>, String> {
    let key = get_secrets_key(&key_state)?;
    let path = seller_dir(&state.0).join(format!("{token_name}.json"));
    if !path.exists() {
        return Ok(None);
    }
    let plaintext = read_and_decrypt(&key, &path)?;
    let plaintext_str =
        String::from_utf8(plaintext).map_err(|_| "Decrypted data is not valid UTF-8".to_string())?;
    let file: SellerSecretFile =
        serde_json::from_str(&plaintext_str).map_err(|e| format!("Invalid seller secret: {e}"))?;
    Ok(Some(SellerSecretResult {
        a: file.a,
        r: file.r,
    }))
}

#[tauri::command]
pub fn remove_seller_secrets(
    state: tauri::State<'_, SecretsDir>,
    token_name: String,
) -> Result<(), String> {
    let path = seller_dir(&state.0).join(format!("{token_name}.json"));
    secure_delete(&path)
}

#[derive(Serialize)]
pub struct SecretListEntry {
    token_name: String,
    created_at: String,
}

#[tauri::command]
pub fn list_seller_secrets(
    state: tauri::State<'_, SecretsDir>,
) -> Result<Vec<SecretListEntry>, String> {
    let dir = seller_dir(&state.0);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut entries = Vec::new();
    for entry in
        std::fs::read_dir(&dir).map_err(|e| format!("Failed to read seller secrets dir: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            let created_at = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| format!("{}", d.as_secs()))
                .unwrap_or_default();
            entries.push(SecretListEntry {
                token_name: stem.to_string(),
                created_at,
            });
        }
    }
    Ok(entries)
}

// ── Bid secrets ─────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct BidSecretFile {
    bid_token_name: String,
    encryption_token_name: String,
    b: String,
    created_at: String,
}

#[derive(Serialize)]
pub struct BidSecretResult {
    b: String,
    #[serde(rename = "encryptionTokenName")]
    encryption_token_name: String,
}

fn bid_dir(base: &PathBuf) -> PathBuf {
    base.join("bid")
}

#[tauri::command]
pub fn store_bid_secrets(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
    bid_token_name: String,
    encryption_token_name: String,
    b: String,
) -> Result<(), String> {
    let key = get_secrets_key(&key_state)?;
    let dir = bid_dir(&state.0);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create bid secrets dir: {e}"))?;

    let file = BidSecretFile {
        bid_token_name: bid_token_name.clone(),
        encryption_token_name,
        b,
        created_at: chrono_now(),
    };
    let plaintext =
        serde_json::to_string(&file).map_err(|e| format!("Failed to serialize: {e}"))?;
    encrypt_and_write(
        &key,
        &dir.join(format!("{bid_token_name}.json")),
        plaintext.as_bytes(),
    )
}

#[tauri::command]
pub fn get_bid_secrets(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
    bid_token_name: String,
) -> Result<Option<BidSecretResult>, String> {
    let key = get_secrets_key(&key_state)?;
    let path = bid_dir(&state.0).join(format!("{bid_token_name}.json"));
    if !path.exists() {
        return Ok(None);
    }
    let plaintext = read_and_decrypt(&key, &path)?;
    let plaintext_str =
        String::from_utf8(plaintext).map_err(|_| "Decrypted data is not valid UTF-8".to_string())?;
    let file: BidSecretFile =
        serde_json::from_str(&plaintext_str).map_err(|e| format!("Invalid bid secret: {e}"))?;
    Ok(Some(BidSecretResult {
        b: file.b,
        encryption_token_name: file.encryption_token_name,
    }))
}

#[tauri::command]
pub fn get_bid_secrets_for_encryption(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
    encryption_token_name: String,
) -> Result<Option<BidSecretResult>, String> {
    let key = get_secrets_key(&key_state)?;
    let dir = bid_dir(&state.0);
    if !dir.exists() {
        return Ok(None);
    }
    for entry in
        std::fs::read_dir(&dir).map_err(|e| format!("Failed to read bid secrets dir: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if let Ok(plaintext) = read_and_decrypt(&key, &path) {
            if let Ok(plaintext_str) = String::from_utf8(plaintext) {
                if let Ok(file) = serde_json::from_str::<BidSecretFile>(&plaintext_str) {
                    if file.encryption_token_name == encryption_token_name {
                        return Ok(Some(BidSecretResult {
                            b: file.b,
                            encryption_token_name: file.encryption_token_name,
                        }));
                    }
                }
            }
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn remove_bid_secrets(
    state: tauri::State<'_, SecretsDir>,
    bid_token_name: String,
) -> Result<(), String> {
    let path = bid_dir(&state.0).join(format!("{bid_token_name}.json"));
    secure_delete(&path)
}

// ── Accept-bid (hop) secrets ────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct AcceptBidSecretFile {
    encryption_token_name: String,
    bid_token_name: String,
    a0: String,
    r0: String,
    hk: String,
    groth_public: Vec<String>,
    ttl: i64,
    snark_tx_hash: String,
    created_at: String,
}

#[derive(Serialize)]
pub struct AcceptBidSecretResult {
    a0: String,
    r0: String,
    hk: String,
    #[serde(rename = "bidTokenName")]
    bid_token_name: String,
    #[serde(rename = "grothPublic")]
    groth_public: Vec<String>,
    ttl: i64,
    #[serde(rename = "snarkTxHash")]
    snark_tx_hash: String,
}

fn accept_bid_dir(base: &PathBuf) -> PathBuf {
    base.join("accept-bid")
}

#[tauri::command]
pub fn store_accept_bid_secrets(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
    encryption_token_name: String,
    bid_token_name: String,
    a0: String,
    r0: String,
    hk: String,
    groth_public: Vec<String>,
    ttl: i64,
    snark_tx_hash: String,
) -> Result<(), String> {
    let key = get_secrets_key(&key_state)?;
    let dir = accept_bid_dir(&state.0);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create accept-bid secrets dir: {e}"))?;

    let file = AcceptBidSecretFile {
        encryption_token_name: encryption_token_name.clone(),
        bid_token_name,
        a0,
        r0,
        hk,
        groth_public,
        ttl,
        snark_tx_hash,
        created_at: chrono_now(),
    };
    let plaintext =
        serde_json::to_string(&file).map_err(|e| format!("Failed to serialize: {e}"))?;
    encrypt_and_write(
        &key,
        &dir.join(format!("{encryption_token_name}.json")),
        plaintext.as_bytes(),
    )
}

#[tauri::command]
pub fn get_accept_bid_secrets(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
    encryption_token_name: String,
) -> Result<Option<AcceptBidSecretResult>, String> {
    let key = get_secrets_key(&key_state)?;
    let path = accept_bid_dir(&state.0).join(format!("{encryption_token_name}.json"));
    if !path.exists() {
        return Ok(None);
    }
    let plaintext = read_and_decrypt(&key, &path)?;
    let plaintext_str =
        String::from_utf8(plaintext).map_err(|_| "Decrypted data is not valid UTF-8".to_string())?;
    let file: AcceptBidSecretFile = serde_json::from_str(&plaintext_str)
        .map_err(|e| format!("Invalid accept-bid secret: {e}"))?;
    Ok(Some(AcceptBidSecretResult {
        a0: file.a0,
        r0: file.r0,
        hk: file.hk,
        bid_token_name: file.bid_token_name,
        groth_public: file.groth_public,
        ttl: file.ttl,
        snark_tx_hash: file.snark_tx_hash,
    }))
}

#[tauri::command]
pub fn remove_accept_bid_secrets(
    state: tauri::State<'_, SecretsDir>,
    encryption_token_name: String,
) -> Result<(), String> {
    let path = accept_bid_dir(&state.0).join(format!("{encryption_token_name}.json"));
    secure_delete(&path)
}

#[tauri::command]
pub fn has_accept_bid_secrets(
    state: tauri::State<'_, SecretsDir>,
    encryption_token_name: String,
) -> Result<bool, String> {
    let path = accept_bid_dir(&state.0).join(format!("{encryption_token_name}.json"));
    Ok(path.exists())
}
