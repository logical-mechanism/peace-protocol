use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::sync::Mutex;

/// In-memory secrets encryption key, derived from mnemonic on wallet unlock.
/// Cleared on wallet lock.
pub struct SecretsKey(pub Mutex<Option<[u8; 32]>>);

/// Encrypted secret file format (JSON-serialized to disk).
#[derive(Serialize, Deserialize)]
pub struct EncryptedSecret {
    /// Format version for future migrations.
    pub version: u32,
    /// AES-256-GCM nonce (12 bytes, hex-encoded).
    pub nonce: String,
    /// AES-256-GCM ciphertext + 16-byte auth tag (hex-encoded).
    pub ciphertext: String,
}

/// Fixed salt for deriving the secrets encryption key from the mnemonic.
/// Domain-separated and not secret — the mnemonic provides all the entropy.
const SECRETS_KEY_SALT: &[u8; 16] = b"PEACE_SECRETS_V1";

/// Derive a 32-byte AES key from the wallet mnemonic for secret encryption.
///
/// Uses Argon2id with light parameters (4 MiB, 1 iteration) since the
/// mnemonic already has 256 bits of entropy.
pub fn derive_secrets_key(mnemonic: &str) -> Result<[u8; 32], String> {
    let params = Params::new(4096, 1, 1, Some(32)).map_err(|e| format!("Argon2 params: {e}"))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(mnemonic.as_bytes(), SECRETS_KEY_SALT, &mut key)
        .map_err(|e| format!("Secrets key derivation failed: {e}"))?;
    Ok(key)
}

/// Encrypt plaintext bytes with AES-256-GCM using the secrets key.
pub fn encrypt_secret(key: &[u8; 32], plaintext: &[u8]) -> Result<EncryptedSecret, String> {
    let mut nonce_bytes = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("Cipher init: {e}"))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("Secret encryption failed: {e}"))?;

    Ok(EncryptedSecret {
        version: 1,
        nonce: to_hex(&nonce_bytes),
        ciphertext: to_hex(&ciphertext),
    })
}

/// Decrypt an encrypted secret with AES-256-GCM using the secrets key.
pub fn decrypt_secret(key: &[u8; 32], encrypted: &EncryptedSecret) -> Result<Vec<u8>, String> {
    let nonce_bytes = from_hex(&encrypted.nonce)?;
    let ciphertext = from_hex(&encrypted.ciphertext)?;

    if nonce_bytes.len() != 12 {
        return Err("Invalid secret file: bad nonce length".to_string());
    }

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("Cipher init: {e}"))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| "Failed to decrypt secret (wallet key may have changed)".to_string())
}

/// Securely delete a file by overwriting with zeros, flushing to disk,
/// then removing. This prevents recovery of secret data from deleted files.
pub fn secure_delete(path: &std::path::Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let size = std::fs::metadata(path)
        .map_err(|e| format!("Failed to get file metadata: {e}"))?
        .len() as usize;

    // Overwrite file contents with zeros, then flush to disk
    {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .open(path)
            .map_err(|e| format!("Failed to open secret for overwrite: {e}"))?;
        let zeros = vec![0u8; size];
        file.write_all(&zeros)
            .map_err(|e| format!("Failed to overwrite secret: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("Failed to sync overwrite: {e}"))?;
    }

    std::fs::remove_file(path).map_err(|e| format!("Failed to remove secret file: {e}"))?;

    Ok(())
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn from_hex(hex: &str) -> Result<Vec<u8>, String> {
    if hex.len() % 2 != 0 {
        return Err("Invalid hex: odd length".to_string());
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).map_err(|e| format!("Invalid hex: {e}")))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_key_deterministic() {
        let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
        let key1 = derive_secrets_key(mnemonic).unwrap();
        let key2 = derive_secrets_key(mnemonic).unwrap();
        assert_eq!(key1, key2);
    }

    #[test]
    fn different_mnemonics_different_keys() {
        let key1 = derive_secrets_key("alpha bravo charlie delta echo foxtrot").unwrap();
        let key2 = derive_secrets_key("golf hotel india juliet kilo lima").unwrap();
        assert_ne!(key1, key2);
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = derive_secrets_key("test mnemonic phrase for unit testing").unwrap();
        let plaintext = b"secret scalar a=0xdeadbeef";

        let encrypted = encrypt_secret(&key, plaintext).unwrap();
        assert_eq!(encrypted.version, 1);

        let decrypted = decrypt_secret(&key, &encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn wrong_key_fails() {
        let key1 = derive_secrets_key("correct mnemonic").unwrap();
        let key2 = derive_secrets_key("wrong mnemonic").unwrap();

        let encrypted = encrypt_secret(&key1, b"secret data").unwrap();
        let result = decrypt_secret(&key2, &encrypted);
        assert!(result.is_err());
    }

    #[test]
    fn secure_delete_removes_file() {
        let dir = std::env::temp_dir().join("peace_test_secure_delete");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test_secret.json");
        std::fs::write(&path, "sensitive data here").unwrap();
        assert!(path.exists());

        secure_delete(&path).unwrap();
        assert!(!path.exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn secure_delete_nonexistent_is_ok() {
        let path = std::path::Path::new("/tmp/peace_test_nonexistent_secret.json");
        assert!(secure_delete(path).is_ok());
    }
}
