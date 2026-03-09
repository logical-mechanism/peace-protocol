use crate::crypto::audit::AuditLog;
use crate::crypto::secrets::{decrypt_secret, encrypt_secret, EncryptedSecret};
use crate::crypto::wallet::set_owner_only_file;
use std::path::Path;

/// Subdirectories that contain encrypted secret files.
const SECRET_SUBDIRS: &[&str] = &["seller", "bid", "accept-bid", "listing-drafts", "iagon"];

/// Re-encrypt all secrets from `old_key` to `new_key`.
///
/// Walks all known subdirectories of `secrets_dir`, decrypts each `.json` file
/// with the old key, and re-encrypts with the new key. Files that fail
/// decryption (e.g., already migrated from a partial prior run) are skipped.
///
/// Returns the number of files successfully migrated.
pub fn migrate_secrets(
    secrets_dir: &Path,
    old_key: &[u8; 32],
    new_key: &[u8; 32],
    audit: &AuditLog,
) -> Result<u32, String> {
    let mut migrated = 0u32;

    for subdir_name in SECRET_SUBDIRS {
        let subdir = secrets_dir.join(subdir_name);
        if !subdir.exists() {
            continue;
        }

        let entries = std::fs::read_dir(&subdir)
            .map_err(|e| format!("Failed to read {subdir_name} dir: {e}"))?;

        for entry in entries {
            let entry = entry.map_err(|e| format!("Dir entry error: {e}"))?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }

            let rel = format!(
                "{}/{}",
                subdir_name,
                path.file_name().unwrap().to_string_lossy()
            );

            let json = match std::fs::read_to_string(&path) {
                Ok(j) => j,
                Err(e) => {
                    eprintln!("[Migration] Failed to read {rel}: {e}");
                    audit.log("MIGRATE_SKIP", &format!("{rel} (read error)"));
                    continue;
                }
            };

            let encrypted: EncryptedSecret = match serde_json::from_str(&json) {
                Ok(e) => e,
                Err(e) => {
                    eprintln!("[Migration] Invalid JSON in {rel}: {e}");
                    audit.log("MIGRATE_SKIP", &format!("{rel} (invalid JSON)"));
                    continue;
                }
            };

            // Decrypt with old key — if this fails, the file was likely already
            // migrated in a partial prior run
            let plaintext = match decrypt_secret(old_key, &encrypted) {
                Ok(p) => p,
                Err(_) => {
                    audit.log(
                        "MIGRATE_SKIP",
                        &format!("{rel} (already migrated or corrupted)"),
                    );
                    continue;
                }
            };

            // Re-encrypt with new key
            let new_encrypted = encrypt_secret(new_key, &plaintext)?;
            let new_json = serde_json::to_string_pretty(&new_encrypted)
                .map_err(|e| format!("Serialize failed: {e}"))?;
            std::fs::write(&path, &new_json).map_err(|e| format!("Failed to write {rel}: {e}"))?;
            set_owner_only_file(&path)?;

            audit.log("MIGRATE", &rel);
            migrated += 1;
        }
    }

    Ok(migrated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::secrets::{
        derive_secrets_key_v1, derive_secrets_key_v2, derive_secrets_key_v3, encrypt_secret,
    };
    use std::fs;

    fn test_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("peace_migration_test_{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn migrate_roundtrip() {
        let dir = test_dir("roundtrip");
        let seller_dir = dir.join("seller");
        fs::create_dir_all(&seller_dir).unwrap();

        let old_key = derive_secrets_key_v1("test mnemonic").unwrap();
        let new_key = derive_secrets_key_v2("test mnemonic", &[42u8; 16]).unwrap();

        // Write a secret encrypted with old key
        let plaintext = b"secret_data_abc";
        let encrypted = encrypt_secret(&old_key, plaintext).unwrap();
        let json = serde_json::to_string_pretty(&encrypted).unwrap();
        fs::write(seller_dir.join("token1.json"), &json).unwrap();

        let audit = AuditLog::new(&dir);
        let count = migrate_secrets(&dir, &old_key, &new_key, &audit).unwrap();
        assert_eq!(count, 1);

        // Verify new key can decrypt
        let new_json = fs::read_to_string(seller_dir.join("token1.json")).unwrap();
        let new_encrypted: EncryptedSecret = serde_json::from_str(&new_json).unwrap();
        let decrypted = decrypt_secret(&new_key, &new_encrypted).unwrap();
        assert_eq!(decrypted, plaintext);

        // Verify old key can no longer decrypt
        assert!(decrypt_secret(&old_key, &new_encrypted).is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn migrate_empty_dir() {
        let dir = test_dir("empty");
        let audit = AuditLog::new(&dir);
        let key1 = [1u8; 32];
        let key2 = [2u8; 32];
        let count = migrate_secrets(&dir, &key1, &key2, &audit).unwrap();
        assert_eq!(count, 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn migrate_idempotent() {
        let dir = test_dir("idempotent");
        let seller_dir = dir.join("seller");
        fs::create_dir_all(&seller_dir).unwrap();

        let old_key = derive_secrets_key_v1("test mnemonic").unwrap();
        let new_key = derive_secrets_key_v2("test mnemonic", &[42u8; 16]).unwrap();

        // Write secret with old key
        let plaintext = b"secret_data";
        let encrypted = encrypt_secret(&old_key, plaintext).unwrap();
        let json = serde_json::to_string_pretty(&encrypted).unwrap();
        fs::write(seller_dir.join("token1.json"), &json).unwrap();

        let audit = AuditLog::new(&dir);

        // First migration succeeds
        let count = migrate_secrets(&dir, &old_key, &new_key, &audit).unwrap();
        assert_eq!(count, 1);

        // Second migration skips (file already encrypted with new key)
        let count = migrate_secrets(&dir, &old_key, &new_key, &audit).unwrap();
        assert_eq!(count, 0);

        // Data still readable with new key
        let json = fs::read_to_string(seller_dir.join("token1.json")).unwrap();
        let enc: EncryptedSecret = serde_json::from_str(&json).unwrap();
        let dec = decrypt_secret(&new_key, &enc).unwrap();
        assert_eq!(dec, plaintext);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn migrate_multiple_subdirs() {
        let dir = test_dir("multi");
        let old_key = derive_secrets_key_v1("test").unwrap();
        let new_key = derive_secrets_key_v2("test", &[99u8; 16]).unwrap();

        for subdir in &["seller", "bid", "iagon"] {
            let sub = dir.join(subdir);
            fs::create_dir_all(&sub).unwrap();
            let enc = encrypt_secret(&old_key, b"data").unwrap();
            let json = serde_json::to_string_pretty(&enc).unwrap();
            fs::write(sub.join("file.json"), &json).unwrap();
        }

        let audit = AuditLog::new(&dir);
        let count = migrate_secrets(&dir, &old_key, &new_key, &audit).unwrap();
        assert_eq!(count, 3);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn migrate_v2_to_v3() {
        let dir = test_dir("v2_to_v3");
        let seller_dir = dir.join("seller");
        fs::create_dir_all(&seller_dir).unwrap();

        let salt = [55u8; 16];
        let v2_key = derive_secrets_key_v2("test mnemonic v2v3", &salt).unwrap();
        let v3_key = derive_secrets_key_v3("test mnemonic v2v3", &[77u8; 16]).unwrap();

        // Write a secret encrypted with v2 key
        let plaintext = b"v2_secret_data";
        let encrypted = encrypt_secret(&v2_key, plaintext).unwrap();
        let json = serde_json::to_string_pretty(&encrypted).unwrap();
        fs::write(seller_dir.join("token_v2.json"), &json).unwrap();

        let audit = AuditLog::new(&dir);
        let count = migrate_secrets(&dir, &v2_key, &v3_key, &audit).unwrap();
        assert_eq!(count, 1);

        // Verify v3 key can decrypt
        let new_json = fs::read_to_string(seller_dir.join("token_v2.json")).unwrap();
        let new_encrypted: EncryptedSecret = serde_json::from_str(&new_json).unwrap();
        let decrypted = decrypt_secret(&v3_key, &new_encrypted).unwrap();
        assert_eq!(decrypted, plaintext);

        // Verify v2 key can no longer decrypt
        assert!(decrypt_secret(&v2_key, &new_encrypted).is_err());

        let _ = fs::remove_dir_all(&dir);
    }
}
