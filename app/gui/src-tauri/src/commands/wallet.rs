use std::sync::Mutex;

use crate::crypto::secrets::{derive_secrets_key, SecretsKey};
use crate::crypto::wallet::{decrypt_mnemonic, encrypt_mnemonic, EncryptedWallet};

/// Application state for wallet management.
pub struct WalletState {
    /// Path to the encrypted wallet JSON file.
    pub wallet_path: std::path::PathBuf,
    /// The decrypted mnemonic (only present when unlocked).
    pub mnemonic: Mutex<Option<String>>,
}

/// Check if an encrypted wallet file exists.
#[tauri::command]
pub fn wallet_exists(state: tauri::State<'_, WalletState>) -> bool {
    state.wallet_path.exists()
}

/// Create a new wallet by encrypting the mnemonic with the password.
#[tauri::command]
pub fn create_wallet(
    state: tauri::State<'_, WalletState>,
    mnemonic: String,
    password: String,
) -> Result<(), String> {
    let words: Vec<&str> = mnemonic.split_whitespace().collect();
    if words.len() != 24 {
        return Err(format!(
            "Mnemonic must be exactly 24 words, got {}",
            words.len()
        ));
    }

    let encrypted = encrypt_mnemonic(&mnemonic, &password)?;
    let json = serde_json::to_string_pretty(&encrypted)
        .map_err(|e| format!("Failed to serialize: {e}"))?;

    if let Some(parent) = state.wallet_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create data directory: {e}"))?;
    }

    std::fs::write(&state.wallet_path, json)
        .map_err(|e| format!("Failed to write wallet file: {e}"))?;

    Ok(())
}

/// Unlock the wallet by decrypting the mnemonic with the password.
/// Returns the mnemonic words as a JSON array of strings.
/// Also derives the secrets encryption key from the mnemonic.
#[tauri::command]
pub fn unlock_wallet(
    state: tauri::State<'_, WalletState>,
    secrets_key_state: tauri::State<'_, SecretsKey>,
    password: String,
) -> Result<Vec<String>, String> {
    let json = std::fs::read_to_string(&state.wallet_path)
        .map_err(|e| format!("Failed to read wallet file: {e}"))?;

    let encrypted: EncryptedWallet =
        serde_json::from_str(&json).map_err(|e| format!("Invalid wallet file format: {e}"))?;

    let mnemonic = decrypt_mnemonic(&encrypted, &password)?;
    let words: Vec<String> = mnemonic.split_whitespace().map(String::from).collect();

    // Derive the secrets encryption key from the mnemonic
    let secrets_key = derive_secrets_key(&mnemonic)?;
    *secrets_key_state
        .0
        .lock()
        .map_err(|_| "Internal error: secrets key lock poisoned".to_string())? = Some(secrets_key);

    *state
        .mnemonic
        .lock()
        .map_err(|_| "Internal error: wallet state lock poisoned".to_string())? = Some(mnemonic);

    Ok(words)
}

/// Lock the wallet by clearing the mnemonic and secrets key from memory.
#[tauri::command]
pub fn lock_wallet(
    state: tauri::State<'_, WalletState>,
    secrets_key_state: tauri::State<'_, SecretsKey>,
) -> Result<(), String> {
    // Zero and clear the secrets encryption key
    {
        let mut guard = secrets_key_state
            .0
            .lock()
            .map_err(|_| "Internal error: secrets key lock poisoned".to_string())?;
        if let Some(ref mut key) = *guard {
            key.fill(0);
        }
        *guard = None;
    }

    *state
        .mnemonic
        .lock()
        .map_err(|_| "Internal error: wallet state lock poisoned".to_string())? = None;
    Ok(())
}

/// Delete the wallet file and clear in-memory state (mnemonic + secrets key).
#[tauri::command]
pub fn delete_wallet(
    state: tauri::State<'_, WalletState>,
    secrets_key_state: tauri::State<'_, SecretsKey>,
) -> Result<(), String> {
    if state.wallet_path.exists() {
        std::fs::remove_file(&state.wallet_path)
            .map_err(|e| format!("Failed to delete wallet file: {e}"))?;
    }

    // Zero and clear the secrets encryption key
    {
        let mut guard = secrets_key_state
            .0
            .lock()
            .map_err(|_| "Internal error: secrets key lock poisoned".to_string())?;
        if let Some(ref mut key) = *guard {
            key.fill(0);
        }
        *guard = None;
    }

    *state
        .mnemonic
        .lock()
        .map_err(|_| "Internal error: wallet state lock poisoned".to_string())? = None;
    Ok(())
}

/// Reveal the mnemonic by re-verifying the password.
/// This re-decrypts from disk rather than using the in-memory copy,
/// ensuring the password is correct before showing sensitive data.
#[tauri::command]
pub fn reveal_mnemonic(
    state: tauri::State<'_, WalletState>,
    password: String,
) -> Result<Vec<String>, String> {
    let json = std::fs::read_to_string(&state.wallet_path)
        .map_err(|e| format!("Failed to read wallet file: {e}"))?;

    let encrypted: EncryptedWallet =
        serde_json::from_str(&json).map_err(|e| format!("Invalid wallet file format: {e}"))?;

    let mnemonic = decrypt_mnemonic(&encrypted, &password)?;
    let words: Vec<String> = mnemonic.split_whitespace().map(String::from).collect();

    Ok(words)
}
