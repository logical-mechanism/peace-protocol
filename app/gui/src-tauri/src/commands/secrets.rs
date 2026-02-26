use crate::crypto::audit::AuditLog;
use crate::crypto::secrets::{
    decrypt_secret, encrypt_secret, secure_delete, EncryptedSecret, SecretsKey,
};
#[cfg(not(unix))]
use crate::crypto::wallet::set_owner_only_file;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

/// Managed state holding the base directory for secret storage.
pub struct SecretsDir(pub PathBuf);

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

fn encrypt_and_write(key: &[u8; 32], path: &std::path::Path, data: &[u8]) -> Result<(), String> {
    let encrypted = encrypt_secret(key, data)?;
    let json = serde_json::to_string_pretty(&encrypted)
        .map_err(|e| format!("Failed to serialize encrypted secret: {e}"))?;

    // On Unix, create the file with 0o600 atomically (no race window where
    // the file exists with default permissions before chmod).
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .map_err(|e| format!("Failed to write secret: {e}"))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("Failed to write secret: {e}"))?;
        return Ok(());
    }

    #[cfg(not(unix))]
    {
        std::fs::write(path, json).map_err(|e| format!("Failed to write secret: {e}"))?;
        set_owner_only_file(path)?;
        Ok(())
    }
}

fn read_and_decrypt(key: &[u8; 32], path: &std::path::Path) -> Result<Vec<u8>, String> {
    let json = std::fs::read_to_string(path).map_err(|e| format!("Failed to read secret: {e}"))?;
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

/// Validate that a hex scalar string is non-empty, at most 128 hex chars, and all hex digits.
fn validate_hex_scalar(name: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("Seller secret '{name}' cannot be empty"));
    }
    if value.len() > 128 {
        return Err(format!(
            "Seller secret '{name}' too long ({} chars, max 128)",
            value.len()
        ));
    }
    if !value.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("Seller secret '{name}' must be valid hex"));
    }
    Ok(())
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

fn seller_dir(base: &Path) -> PathBuf {
    base.join("seller")
}

#[tauri::command]
pub fn store_seller_secrets(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
    audit: tauri::State<'_, AuditLog>,
    token_name: String,
    a: String,
    r: String,
) -> Result<(), String> {
    validate_hex_scalar("a", &a)?;
    validate_hex_scalar("r", &r)?;

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
    let result = encrypt_and_write(
        &key,
        &dir.join(format!("{token_name}.json")),
        plaintext.as_bytes(),
    );
    audit.log("WRITE", &format!("seller/{token_name}.json"));
    result
}

#[tauri::command]
pub fn get_seller_secrets(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
    audit: tauri::State<'_, AuditLog>,
    token_name: String,
) -> Result<Option<SellerSecretResult>, String> {
    let key = get_secrets_key(&key_state)?;
    let path = seller_dir(&state.0).join(format!("{token_name}.json"));
    if !path.exists() {
        return Ok(None);
    }
    audit.log("READ", &format!("seller/{token_name}.json"));
    let plaintext = read_and_decrypt(&key, &path)?;
    let plaintext_str = String::from_utf8(plaintext)
        .map_err(|_| "Decrypted data is not valid UTF-8".to_string())?;
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
    audit: tauri::State<'_, AuditLog>,
    token_name: String,
) -> Result<(), String> {
    let path = seller_dir(&state.0).join(format!("{token_name}.json"));
    audit.log("DELETE", &format!("seller/{token_name}.json"));
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
    audit: tauri::State<'_, AuditLog>,
) -> Result<Vec<SecretListEntry>, String> {
    audit.log("LIST", "seller/");
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

fn bid_dir(base: &Path) -> PathBuf {
    base.join("bid")
}

#[tauri::command]
pub fn store_bid_secrets(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
    audit: tauri::State<'_, AuditLog>,
    bid_token_name: String,
    encryption_token_name: String,
    b: String,
) -> Result<(), String> {
    let key = get_secrets_key(&key_state)?;
    let dir = bid_dir(&state.0);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create bid secrets dir: {e}"))?;

    let file = BidSecretFile {
        bid_token_name: bid_token_name.clone(),
        encryption_token_name,
        b,
        created_at: chrono_now(),
    };
    let plaintext =
        serde_json::to_string(&file).map_err(|e| format!("Failed to serialize: {e}"))?;
    let result = encrypt_and_write(
        &key,
        &dir.join(format!("{bid_token_name}.json")),
        plaintext.as_bytes(),
    );
    audit.log("WRITE", &format!("bid/{bid_token_name}.json"));
    result
}

#[tauri::command]
pub fn get_bid_secrets(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
    audit: tauri::State<'_, AuditLog>,
    bid_token_name: String,
) -> Result<Option<BidSecretResult>, String> {
    let key = get_secrets_key(&key_state)?;
    let path = bid_dir(&state.0).join(format!("{bid_token_name}.json"));
    if !path.exists() {
        return Ok(None);
    }
    audit.log("READ", &format!("bid/{bid_token_name}.json"));
    let plaintext = read_and_decrypt(&key, &path)?;
    let plaintext_str = String::from_utf8(plaintext)
        .map_err(|_| "Decrypted data is not valid UTF-8".to_string())?;
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
    audit: tauri::State<'_, AuditLog>,
    encryption_token_name: String,
) -> Result<Option<BidSecretResult>, String> {
    audit.log(
        "READ",
        &format!("bid/ (scan for encryption {encryption_token_name})"),
    );
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
    audit: tauri::State<'_, AuditLog>,
    bid_token_name: String,
) -> Result<(), String> {
    let path = bid_dir(&state.0).join(format!("{bid_token_name}.json"));
    audit.log("DELETE", &format!("bid/{bid_token_name}.json"));
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

fn accept_bid_dir(base: &Path) -> PathBuf {
    base.join("accept-bid")
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn store_accept_bid_secrets(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
    audit: tauri::State<'_, AuditLog>,
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
    let result = encrypt_and_write(
        &key,
        &dir.join(format!("{encryption_token_name}.json")),
        plaintext.as_bytes(),
    );
    audit.log("WRITE", &format!("accept-bid/{encryption_token_name}.json"));
    result
}

#[tauri::command]
pub fn get_accept_bid_secrets(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
    audit: tauri::State<'_, AuditLog>,
    encryption_token_name: String,
) -> Result<Option<AcceptBidSecretResult>, String> {
    let key = get_secrets_key(&key_state)?;
    let path = accept_bid_dir(&state.0).join(format!("{encryption_token_name}.json"));
    if !path.exists() {
        return Ok(None);
    }
    audit.log("READ", &format!("accept-bid/{encryption_token_name}.json"));
    let plaintext = read_and_decrypt(&key, &path)?;
    let plaintext_str = String::from_utf8(plaintext)
        .map_err(|_| "Decrypted data is not valid UTF-8".to_string())?;
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
    audit: tauri::State<'_, AuditLog>,
    encryption_token_name: String,
) -> Result<(), String> {
    let path = accept_bid_dir(&state.0).join(format!("{encryption_token_name}.json"));
    audit.log(
        "DELETE",
        &format!("accept-bid/{encryption_token_name}.json"),
    );
    secure_delete(&path)
}

#[tauri::command]
pub fn has_accept_bid_secrets(
    state: tauri::State<'_, SecretsDir>,
    audit: tauri::State<'_, AuditLog>,
    encryption_token_name: String,
) -> Result<bool, String> {
    audit.log(
        "READ",
        &format!("accept-bid/{encryption_token_name}.json (exists check)"),
    );
    let path = accept_bid_dir(&state.0).join(format!("{encryption_token_name}.json"));
    Ok(path.exists())
}

// ── Listing drafts ─────────────────────────────────────────────────────

/// Listing draft — persists multi-step listing creation state so the expensive
/// Iagon upload never needs to repeat on retry or crash recovery.
#[derive(Serialize, Deserialize)]
struct ListingDraftFile {
    id: String,
    status: String,
    created_at: String,
    updated_at: String,
    // Form data
    category: String,
    description: String,
    suggested_price: String,
    image_link: String,
    original_filename: String,
    original_file_size: u64,
    // Iagon upload result
    #[serde(default)]
    iagon_file_id: Option<String>,
    #[serde(default)]
    iagon_filename: Option<String>,
    // File encryption keys (hex)
    #[serde(default)]
    file_key: Option<String>,
    #[serde(default)]
    file_nonce: Option<String>,
    #[serde(default)]
    file_digest: Option<String>,
    // Original file extension (e.g. ".mp3", ".pdf")
    #[serde(default)]
    file_extension: Option<String>,
    // Transaction details
    #[serde(default)]
    token_name: Option<String>,
    #[serde(default)]
    tx_hash: Option<String>,
    // Error tracking
    #[serde(default)]
    last_error: Option<String>,
    #[serde(default)]
    retry_count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListingDraftResult {
    id: String,
    status: String,
    created_at: String,
    updated_at: String,
    category: String,
    description: String,
    suggested_price: String,
    image_link: String,
    original_filename: String,
    original_file_size: u64,
    iagon_file_id: Option<String>,
    iagon_filename: Option<String>,
    file_key: Option<String>,
    file_nonce: Option<String>,
    file_digest: Option<String>,
    file_extension: Option<String>,
    token_name: Option<String>,
    tx_hash: Option<String>,
    last_error: Option<String>,
    retry_count: u32,
}

fn listing_draft_dir(base: &Path) -> PathBuf {
    base.join("listing-drafts")
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn store_listing_draft(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
    audit: tauri::State<'_, AuditLog>,
    id: String,
    status: String,
    category: String,
    description: String,
    suggested_price: String,
    image_link: String,
    original_filename: String,
    original_file_size: u64,
) -> Result<(), String> {
    let key = get_secrets_key(&key_state)?;
    let dir = listing_draft_dir(&state.0);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create listing-drafts dir: {e}"))?;

    let now = chrono_now();
    let file = ListingDraftFile {
        id: id.clone(),
        status,
        created_at: now.clone(),
        updated_at: now,
        category,
        description,
        suggested_price,
        image_link,
        original_filename,
        original_file_size,
        iagon_file_id: None,
        iagon_filename: None,
        file_key: None,
        file_nonce: None,
        file_digest: None,
        file_extension: None,
        token_name: None,
        tx_hash: None,
        last_error: None,
        retry_count: 0,
    };
    let plaintext =
        serde_json::to_string(&file).map_err(|e| format!("Failed to serialize: {e}"))?;
    let result = encrypt_and_write(&key, &dir.join(format!("{id}.json")), plaintext.as_bytes());
    audit.log("WRITE", &format!("listing-drafts/{id}.json"));
    result
}

#[tauri::command]
pub fn update_listing_draft(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
    audit: tauri::State<'_, AuditLog>,
    id: String,
    updates_json: String,
) -> Result<(), String> {
    let key = get_secrets_key(&key_state)?;
    let dir = listing_draft_dir(&state.0);
    let path = dir.join(format!("{id}.json"));
    if !path.exists() {
        return Err(format!("Listing draft {id} not found"));
    }
    let plaintext = read_and_decrypt(&key, &path)?;
    let plaintext_str = String::from_utf8(plaintext)
        .map_err(|_| "Decrypted data is not valid UTF-8".to_string())?;
    let mut file: ListingDraftFile =
        serde_json::from_str(&plaintext_str).map_err(|e| format!("Invalid listing draft: {e}"))?;

    // Apply partial updates from a JSON object
    let updates: serde_json::Value =
        serde_json::from_str(&updates_json).map_err(|e| format!("Invalid updates JSON: {e}"))?;

    if let Some(v) = updates.get("status").and_then(|v| v.as_str()) {
        file.status = v.to_string();
    }
    if let Some(v) = updates.get("iagonFileId").and_then(|v| v.as_str()) {
        file.iagon_file_id = Some(v.to_string());
    }
    if let Some(v) = updates.get("iagonFilename").and_then(|v| v.as_str()) {
        file.iagon_filename = Some(v.to_string());
    }
    if let Some(v) = updates.get("fileKey").and_then(|v| v.as_str()) {
        file.file_key = Some(v.to_string());
    }
    if let Some(v) = updates.get("fileNonce").and_then(|v| v.as_str()) {
        file.file_nonce = Some(v.to_string());
    }
    if let Some(v) = updates.get("fileDigest").and_then(|v| v.as_str()) {
        file.file_digest = Some(v.to_string());
    }
    if let Some(v) = updates.get("fileExtension").and_then(|v| v.as_str()) {
        file.file_extension = Some(v.to_string());
    }
    if let Some(v) = updates.get("tokenName").and_then(|v| v.as_str()) {
        file.token_name = Some(v.to_string());
    }
    if let Some(v) = updates.get("txHash").and_then(|v| v.as_str()) {
        file.tx_hash = Some(v.to_string());
    }
    if let Some(v) = updates.get("lastError") {
        file.last_error = if v.is_null() {
            None
        } else {
            v.as_str().map(|s| s.to_string())
        };
    }
    if let Some(v) = updates.get("retryCount").and_then(|v| v.as_u64()) {
        file.retry_count = v as u32;
    }

    file.updated_at = chrono_now();

    let new_plaintext =
        serde_json::to_string(&file).map_err(|e| format!("Failed to serialize: {e}"))?;
    let result = encrypt_and_write(&key, &path, new_plaintext.as_bytes());
    audit.log("WRITE", &format!("listing-drafts/{id}.json (update)"));
    result
}

#[tauri::command]
pub fn get_listing_draft(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
    audit: tauri::State<'_, AuditLog>,
    id: String,
) -> Result<Option<ListingDraftResult>, String> {
    let key = get_secrets_key(&key_state)?;
    let path = listing_draft_dir(&state.0).join(format!("{id}.json"));
    if !path.exists() {
        return Ok(None);
    }
    audit.log("READ", &format!("listing-drafts/{id}.json"));
    let plaintext = read_and_decrypt(&key, &path)?;
    let plaintext_str = String::from_utf8(plaintext)
        .map_err(|_| "Decrypted data is not valid UTF-8".to_string())?;
    let file: ListingDraftFile =
        serde_json::from_str(&plaintext_str).map_err(|e| format!("Invalid listing draft: {e}"))?;
    Ok(Some(draft_file_to_result(file)))
}

#[tauri::command]
pub fn list_listing_drafts(
    state: tauri::State<'_, SecretsDir>,
    key_state: tauri::State<'_, SecretsKey>,
    audit: tauri::State<'_, AuditLog>,
) -> Result<Vec<ListingDraftResult>, String> {
    audit.log("LIST", "listing-drafts/");
    let key = get_secrets_key(&key_state)?;
    let dir = listing_draft_dir(&state.0);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut results = Vec::new();
    for entry in
        std::fs::read_dir(&dir).map_err(|e| format!("Failed to read listing-drafts dir: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if let Ok(plaintext) = read_and_decrypt(&key, &path) {
            if let Ok(plaintext_str) = String::from_utf8(plaintext) {
                if let Ok(file) = serde_json::from_str::<ListingDraftFile>(&plaintext_str) {
                    results.push(draft_file_to_result(file));
                }
            }
        }
    }
    Ok(results)
}

#[tauri::command]
pub fn remove_listing_draft(
    state: tauri::State<'_, SecretsDir>,
    audit: tauri::State<'_, AuditLog>,
    id: String,
) -> Result<(), String> {
    let path = listing_draft_dir(&state.0).join(format!("{id}.json"));
    audit.log("DELETE", &format!("listing-drafts/{id}.json"));
    secure_delete(&path)
}

fn draft_file_to_result(file: ListingDraftFile) -> ListingDraftResult {
    ListingDraftResult {
        id: file.id,
        status: file.status,
        created_at: file.created_at,
        updated_at: file.updated_at,
        category: file.category,
        description: file.description,
        suggested_price: file.suggested_price,
        image_link: file.image_link,
        original_filename: file.original_filename,
        original_file_size: file.original_file_size,
        iagon_file_id: file.iagon_file_id,
        iagon_filename: file.iagon_filename,
        file_key: file.file_key,
        file_nonce: file.file_nonce,
        file_digest: file.file_digest,
        file_extension: file.file_extension,
        token_name: file.token_name,
        tx_hash: file.tx_hash,
        last_error: file.last_error,
        retry_count: file.retry_count,
    }
}
