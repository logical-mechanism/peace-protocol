use crate::crypto::audit::AuditLog;
use crate::crypto::migration::migrate_secrets;
use crate::crypto::secrets::{
    derive_secrets_key_v1, derive_secrets_key_v2, derive_secrets_key_v3, from_hex,
    generate_kdf_salt, load_kdf_meta, save_kdf_meta, to_hex, KdfMeta, SecretsKey,
};
use crate::crypto::wallet::{
    decrypt_mnemonic, encrypt_mnemonic, set_owner_only_file, EncryptedWallet,
};
use zeroize::Zeroizing;

use super::secrets::SecretsDir;

/// Application state for wallet management.
pub struct WalletState {
    /// Path to the encrypted wallet JSON file.
    pub wallet_path: std::path::PathBuf,
}

/// Check if an encrypted wallet file exists.
#[tauri::command]
pub fn wallet_exists(state: tauri::State<'_, WalletState>) -> bool {
    state.wallet_path.exists()
}

/// Create a new wallet by encrypting the mnemonic with the password.
/// Also initializes the KDF v3 salt for secrets encryption.
#[tauri::command]
pub fn create_wallet(
    state: tauri::State<'_, WalletState>,
    secrets_dir_state: tauri::State<'_, SecretsDir>,
    audit: tauri::State<'_, AuditLog>,
    mnemonic: String,
    password: String,
) -> Result<(), String> {
    // Wrap in Zeroizing so the plaintext mnemonic is zeroed on drop
    let mnemonic = Zeroizing::new(mnemonic);
    let words: Vec<&str> = mnemonic.split_whitespace().collect();
    if words.len() != 24 {
        return Err(format!(
            "Mnemonic must be exactly 24 words, got {}",
            words.len()
        ));
    }

    // Validate BIP39 checksum (catches typos in imported mnemonics)
    bip39::Mnemonic::parse_in_normalized(bip39::Language::English, &mnemonic).map_err(|_| {
        "Invalid mnemonic: checksum verification failed. Please double-check your recovery phrase for typos.".to_string()
    })?;

    if password.len() < 12 {
        return Err("Password must be at least 12 characters".to_string());
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

    // Restrict wallet file to owner-only read/write (0o600 on Unix)
    set_owner_only_file(&state.wallet_path)?;

    // Initialize KDF v3 salt for this new wallet
    let new_salt = generate_kdf_salt();
    let meta = KdfMeta {
        version: 3,
        salt: to_hex(&new_salt),
    };
    save_kdf_meta(&secrets_dir_state.0, &meta)?;

    audit.log("WALLET_CREATED", "wallet.json");
    Ok(())
}

/// Unlock the wallet by decrypting the mnemonic with the password.
/// Returns the mnemonic words as a JSON array of strings.
/// Also derives the secrets encryption key from the mnemonic.
///
/// On first unlock after a KDF upgrade, transparently re-encrypts all secrets
/// from v1 (4 MiB, fixed salt) to v2 (32 MiB, random per-user salt).
#[tauri::command]
pub fn unlock_wallet(
    state: tauri::State<'_, WalletState>,
    secrets_key_state: tauri::State<'_, SecretsKey>,
    secrets_dir_state: tauri::State<'_, SecretsDir>,
    audit: tauri::State<'_, AuditLog>,
    password: String,
) -> Result<Vec<String>, String> {
    let json = std::fs::read_to_string(&state.wallet_path)
        .map_err(|e| format!("Failed to read wallet file: {e}"))?;

    let encrypted: EncryptedWallet =
        serde_json::from_str(&json).map_err(|e| format!("Invalid wallet file format: {e}"))?;

    let mnemonic = decrypt_mnemonic(&encrypted, &password)?;
    let words: Vec<String> = mnemonic.split_whitespace().map(String::from).collect();

    let secrets_dir = &secrets_dir_state.0;
    let (kdf_meta, needs_migration) = load_kdf_meta(secrets_dir)?;

    let secrets_key = if needs_migration {
        // Derive old key based on the stored KDF version
        let old_key = match kdf_meta.version {
            1 => derive_secrets_key_v1(&mnemonic)?,
            2 => {
                let salt = from_hex(&kdf_meta.salt)?;
                derive_secrets_key_v2(&mnemonic, &salt)?
            }
            v => return Err(format!("Unknown KDF version {v} in kdf_meta.json")),
        };

        // Generate new salt and derive new key (v3)
        let new_salt = generate_kdf_salt();
        let new_key = derive_secrets_key_v3(&mnemonic, &new_salt)?;

        // Re-encrypt all secrets
        let from_ver = kdf_meta.version;
        audit.log("MIGRATE", &format!("kdf_v{from_ver}_to_v3_start"));
        let count = migrate_secrets(secrets_dir, &old_key, &new_key, &audit)?;
        audit.log(
            "MIGRATE",
            &format!("kdf_v{from_ver}_to_v3_complete ({count} files)"),
        );

        // Write KDF metadata
        let meta = KdfMeta {
            version: 3,
            salt: to_hex(&new_salt),
        };
        save_kdf_meta(secrets_dir, &meta)?;

        new_key
    } else {
        // Normal path: derive with stored salt
        let salt = from_hex(&kdf_meta.salt)?;
        derive_secrets_key_v3(&mnemonic, &salt)?
    };

    *secrets_key_state
        .0
        .lock()
        .map_err(|_| "Internal error: secrets key lock poisoned".to_string())? = Some(secrets_key);

    audit.log("WALLET_UNLOCKED", "wallet.json");
    Ok(words)
}

/// Lock the wallet by clearing the secrets key from memory.
/// Zeroizing::drop automatically zeros the key bytes when the Option is set to None.
#[tauri::command]
pub fn lock_wallet(
    secrets_key_state: tauri::State<'_, SecretsKey>,
    audit: tauri::State<'_, AuditLog>,
) -> Result<(), String> {
    let mut guard = secrets_key_state
        .0
        .lock()
        .map_err(|_| "Internal error: secrets key lock poisoned".to_string())?;
    *guard = None;
    audit.log("WALLET_LOCKED", "wallet.json");
    Ok(())
}

/// Delete the wallet file and clear in-memory secrets key.
/// Zeroizing::drop automatically zeros the key bytes when the Option is set to None.
#[tauri::command]
pub fn delete_wallet(
    state: tauri::State<'_, WalletState>,
    secrets_key_state: tauri::State<'_, SecretsKey>,
    audit: tauri::State<'_, AuditLog>,
) -> Result<(), String> {
    if state.wallet_path.exists() {
        std::fs::remove_file(&state.wallet_path)
            .map_err(|e| format!("Failed to delete wallet file: {e}"))?;
    }

    let mut guard = secrets_key_state
        .0
        .lock()
        .map_err(|_| "Internal error: secrets key lock poisoned".to_string())?;
    *guard = None;
    audit.log("WALLET_DELETED", "wallet.json");
    Ok(())
}

/// Reveal the mnemonic by re-verifying the password.
/// This re-decrypts from disk rather than using the in-memory copy,
/// ensuring the password is correct before showing sensitive data.
#[tauri::command]
pub fn reveal_mnemonic(
    state: tauri::State<'_, WalletState>,
    audit: tauri::State<'_, AuditLog>,
    password: String,
) -> Result<Vec<String>, String> {
    let json = std::fs::read_to_string(&state.wallet_path)
        .map_err(|e| format!("Failed to read wallet file: {e}"))?;

    let encrypted: EncryptedWallet =
        serde_json::from_str(&json).map_err(|e| format!("Invalid wallet file format: {e}"))?;

    let mnemonic = decrypt_mnemonic(&encrypted, &password)?;
    let words: Vec<String> = mnemonic.split_whitespace().map(String::from).collect();

    audit.log("MNEMONIC_REVEALED", "wallet.json");
    Ok(words)
}
