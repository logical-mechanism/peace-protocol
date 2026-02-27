use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::sync::Mutex;
use zeroize::Zeroizing;

/// In-memory secrets encryption key, derived from mnemonic on wallet unlock.
/// Cleared on wallet lock. Uses `Zeroizing` to automatically zero key material
/// on drop, including on error paths and panics.
pub struct SecretsKey(pub Mutex<Option<Zeroizing<[u8; 32]>>>);

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

/// KDF metadata, stored at `secrets/kdf_meta.json`.
/// Tracks the key derivation version and per-user salt.
#[derive(Serialize, Deserialize)]
pub struct KdfMeta {
    pub version: u32,
    /// Random 16-byte salt (hex-encoded). Present for version >= 2.
    pub salt: String,
}

/// Fixed salt for KDF version 1 (legacy, retained for migration only).
const SECRETS_KEY_SALT_V1: &[u8; 16] = b"PEACE_SECRETS_V1";

/// Derive secrets key using KDF version 1 (legacy).
/// 4 MiB, 1 iteration, 1 parallelism, fixed salt.
pub fn derive_secrets_key_v1(mnemonic: &str) -> Result<Zeroizing<[u8; 32]>, String> {
    let params = Params::new(4096, 1, 1, Some(32)).map_err(|e| format!("Argon2 params: {e}"))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0u8; 32]);
    argon2
        .hash_password_into(mnemonic.as_bytes(), SECRETS_KEY_SALT_V1, &mut *key)
        .map_err(|e| format!("Secrets key derivation failed: {e}"))?;
    Ok(key)
}

/// Derive secrets key using KDF version 2 (legacy, retained for migration only).
/// 32 MiB, 2 iterations, 1 parallelism, random per-user salt.
pub fn derive_secrets_key_v2(mnemonic: &str, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    let params = Params::new(32768, 2, 1, Some(32)).map_err(|e| format!("Argon2 params: {e}"))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0u8; 32]);
    argon2
        .hash_password_into(mnemonic.as_bytes(), salt, &mut *key)
        .map_err(|e| format!("Secrets key derivation failed: {e}"))?;
    Ok(key)
}

/// Derive secrets key using KDF version 3 (current).
/// 64 MiB, 3 iterations, 2 parallelism — matches wallet KDF memory/iterations,
/// with parallelism 2 (vs wallet's 4) to keep it faster.
pub fn derive_secrets_key_v3(mnemonic: &str, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    let params = Params::new(65536, 3, 2, Some(32)).map_err(|e| format!("Argon2 params: {e}"))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0u8; 32]);
    argon2
        .hash_password_into(mnemonic.as_bytes(), salt, &mut *key)
        .map_err(|e| format!("Secrets key derivation failed: {e}"))?;
    Ok(key)
}

/// Generate a random 16-byte salt for secrets KDF.
pub fn generate_kdf_salt() -> [u8; 16] {
    let mut salt = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    salt
}

/// Current KDF version. Secrets are migrated on unlock when meta version is lower.
const CURRENT_KDF_VERSION: u32 = 3;

/// Load KDF metadata from the secrets directory.
/// Returns `(meta, needs_migration)`. Migration is needed when the stored version
/// is older than CURRENT_KDF_VERSION, or when no metadata file exists (v1 legacy).
pub fn load_kdf_meta(secrets_dir: &std::path::Path) -> Result<(KdfMeta, bool), String> {
    let path = secrets_dir.join("kdf_meta.json");
    if path.exists() {
        let json = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read kdf_meta.json: {e}"))?;
        let meta: KdfMeta =
            serde_json::from_str(&json).map_err(|e| format!("Invalid kdf_meta.json: {e}"))?;
        let needs_migration = meta.version < CURRENT_KDF_VERSION;
        Ok((meta, needs_migration))
    } else {
        Ok((
            KdfMeta {
                version: 1,
                salt: String::new(),
            },
            true,
        ))
    }
}

/// Save KDF metadata to the secrets directory.
pub fn save_kdf_meta(secrets_dir: &std::path::Path, meta: &KdfMeta) -> Result<(), String> {
    let path = secrets_dir.join("kdf_meta.json");
    let json =
        serde_json::to_string_pretty(meta).map_err(|e| format!("Failed to serialize: {e}"))?;
    std::fs::write(&path, &json).map_err(|e| format!("Failed to write kdf_meta.json: {e}"))?;
    crate::crypto::wallet::set_owner_only_file(&path)?;
    Ok(())
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

pub(crate) fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn from_hex(hex: &str) -> Result<Vec<u8>, String> {
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
    fn derive_key_v1_deterministic() {
        let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
        let key1 = derive_secrets_key_v1(mnemonic).unwrap();
        let key2 = derive_secrets_key_v1(mnemonic).unwrap();
        assert_eq!(key1, key2);
    }

    #[test]
    fn derive_key_v2_deterministic() {
        let mnemonic = "test mnemonic for v2";
        let salt = [42u8; 16];
        let key1 = derive_secrets_key_v2(mnemonic, &salt).unwrap();
        let key2 = derive_secrets_key_v2(mnemonic, &salt).unwrap();
        assert_eq!(key1, key2);
    }

    #[test]
    fn v1_and_v2_produce_different_keys() {
        let mnemonic = "alpha bravo charlie delta echo foxtrot";
        let key_v1 = derive_secrets_key_v1(mnemonic).unwrap();
        // Even using the same salt bytes as V1, params differ → different key
        let key_v2 = derive_secrets_key_v2(mnemonic, b"PEACE_SECRETS_V1").unwrap();
        assert_ne!(*key_v1, *key_v2);
    }

    #[test]
    fn v2_different_salts_different_keys() {
        let mnemonic = "alpha bravo charlie delta echo foxtrot";
        let key1 = derive_secrets_key_v2(mnemonic, &[1u8; 16]).unwrap();
        let key2 = derive_secrets_key_v2(mnemonic, &[2u8; 16]).unwrap();
        assert_ne!(key1, key2);
    }

    #[test]
    fn different_mnemonics_different_keys() {
        let key1 = derive_secrets_key_v1("alpha bravo charlie delta echo foxtrot").unwrap();
        let key2 = derive_secrets_key_v1("golf hotel india juliet kilo lima").unwrap();
        assert_ne!(key1, key2);
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = derive_secrets_key_v1("test mnemonic phrase for unit testing").unwrap();
        let plaintext = b"secret scalar a=0xdeadbeef";

        let encrypted = encrypt_secret(&key, plaintext).unwrap();
        assert_eq!(encrypted.version, 1);

        let decrypted = decrypt_secret(&key, &encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn wrong_key_fails() {
        let key1 = derive_secrets_key_v1("correct mnemonic").unwrap();
        let key2 = derive_secrets_key_v1("wrong mnemonic").unwrap();

        let encrypted = encrypt_secret(&key1, b"secret data").unwrap();
        let result = decrypt_secret(&key2, &encrypted);
        assert!(result.is_err());
    }

    #[test]
    fn kdf_meta_roundtrip() {
        let dir = std::env::temp_dir().join("peace_test_kdf_meta");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // No file → needs migration
        let (meta, needs) = load_kdf_meta(&dir).unwrap();
        assert_eq!(meta.version, 1);
        assert!(needs);

        // Save v2 meta → still needs migration (v2 < v3)
        let salt = generate_kdf_salt();
        let meta_v2 = KdfMeta {
            version: 2,
            salt: to_hex(&salt),
        };
        save_kdf_meta(&dir, &meta_v2).unwrap();
        let (loaded, needs) = load_kdf_meta(&dir).unwrap();
        assert_eq!(loaded.version, 2);
        assert!(needs); // v2 < CURRENT_KDF_VERSION (3)

        // Save v3 meta → no migration needed
        let meta_v3 = KdfMeta {
            version: 3,
            salt: to_hex(&salt),
        };
        save_kdf_meta(&dir, &meta_v3).unwrap();
        let (loaded, needs) = load_kdf_meta(&dir).unwrap();
        assert_eq!(loaded.version, 3);
        assert!(!needs);
        assert_eq!(loaded.salt, to_hex(&salt));

        let _ = std::fs::remove_dir_all(&dir);
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
