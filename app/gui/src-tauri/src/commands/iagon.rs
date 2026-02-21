use crate::crypto::secrets::{secure_delete, SecretsKey};
use std::path::Path;

use super::secrets::SecretsDir;

// Reuse helpers from the secrets module via the shared crate-level helpers.
// Since the helpers are private to secrets.rs, we re-implement the thin
// encrypt/decrypt wrappers here using the same underlying crypto primitives.

use crate::crypto::secrets::{decrypt_secret, encrypt_secret, EncryptedSecret};

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
