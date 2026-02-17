use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use serde::{Deserialize, Serialize};

/// Encrypted wallet file format, serialized to JSON on disk.
#[derive(Serialize, Deserialize)]
pub struct EncryptedWallet {
    /// Format version for future migrations.
    pub version: u32,
    /// Argon2id salt (16 bytes, hex-encoded).
    pub salt: String,
    /// AES-256-GCM nonce (12 bytes, hex-encoded).
    pub nonce: String,
    /// AES-256-GCM ciphertext + 16-byte auth tag (hex-encoded).
    pub ciphertext: String,
}

/// Derive a 32-byte AES key from password + salt using Argon2id.
///
/// Parameters: m=65536 (64 MiB), t=3 iterations, p=4 parallelism.
fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let params = Params::new(65536, 3, 4, Some(32)).map_err(|e| format!("Argon2 params: {e}"))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| format!("Key derivation failed: {e}"))?;
    Ok(key)
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

/// Encrypt a mnemonic phrase with a password.
///
/// The mnemonic should be space-separated words.
/// Returns an `EncryptedWallet` ready for JSON serialization.
pub fn encrypt_mnemonic(mnemonic: &str, password: &str) -> Result<EncryptedWallet, String> {
    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);

    let key = derive_key(password, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("Cipher init: {e}"))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, mnemonic.as_bytes())
        .map_err(|e| format!("Encryption failed: {e}"))?;

    Ok(EncryptedWallet {
        version: 1,
        salt: to_hex(&salt),
        nonce: to_hex(&nonce_bytes),
        ciphertext: to_hex(&ciphertext),
    })
}

/// Decrypt a mnemonic phrase from an `EncryptedWallet` using the password.
///
/// Returns the mnemonic as a space-separated word string.
/// Returns a user-friendly error on wrong password.
pub fn decrypt_mnemonic(wallet: &EncryptedWallet, password: &str) -> Result<String, String> {
    let salt = from_hex(&wallet.salt)?;
    let nonce_bytes = from_hex(&wallet.nonce)?;
    let ciphertext = from_hex(&wallet.ciphertext)?;

    if nonce_bytes.len() != 12 {
        return Err("Invalid wallet file: bad nonce length".to_string());
    }

    let key = derive_key(password, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("Cipher init: {e}"))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| "Incorrect password".to_string())?;

    String::from_utf8(plaintext).map_err(|_| "Decrypted data is not valid UTF-8".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
        let password = "test_password_123";

        let encrypted = encrypt_mnemonic(mnemonic, password).unwrap();
        assert_eq!(encrypted.version, 1);

        let decrypted = decrypt_mnemonic(&encrypted, password).unwrap();
        assert_eq!(decrypted, mnemonic);
    }

    #[test]
    fn wrong_password_fails() {
        let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

        let encrypted = encrypt_mnemonic(mnemonic, "correct_password").unwrap();
        let result = decrypt_mnemonic(&encrypted, "wrong_password");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Incorrect password");
    }

    #[test]
    fn hex_roundtrip() {
        let data = vec![0xde, 0xad, 0xbe, 0xef];
        let hex = to_hex(&data);
        assert_eq!(hex, "deadbeef");
        assert_eq!(from_hex(&hex).unwrap(), data);
    }
}
