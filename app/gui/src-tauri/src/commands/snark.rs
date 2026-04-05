use crate::process::manager::{spawn_clean_sidecar, NodeManager};
use crate::MaxCores;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

/// Managed state holding the app-specific temp directory.
/// Created at startup, wiped on each launch to clean up crash orphans.
pub struct AppTmpDir(pub PathBuf);

/// Serialization lock for SNARK sidecar invocations.
/// Prevents concurrent snark binary spawns that would compete for disk I/O
/// on shared setup files (pk.bin, ccs.bin).
/// Wrapped in Arc so the cleanup task can check if a prove is in progress.
pub struct SnarkLock(pub std::sync::Arc<tokio::sync::Mutex<()>>);

/// Write a JSON object to a temporary file for passing secrets to the snark sidecar.
/// Returns the NamedTempFile (must be kept alive until the sidecar reads it).
/// Files are created in the app-specific temp directory, not the OS temp dir.
fn write_secrets_file(
    tmp_dir: &std::path::Path,
    secrets: serde_json::Value,
) -> Result<tempfile::NamedTempFile, String> {
    let file = tempfile::Builder::new()
        .prefix("veiled-snark-")
        .tempfile_in(tmp_dir)
        .map_err(|e| format!("Failed to create secrets temp file: {e}"))?;

    // Restrict to owner-only before writing secret material
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(file.path(), std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Failed to set temp file permissions: {e}"))?;
    }

    serde_json::to_writer(&file, &secrets)
        .map_err(|e| format!("Failed to write secrets temp file: {e}"))?;
    Ok(file)
}

/// Secret scalars for SNARK proof generation, passed from frontend as a single object.
#[derive(Debug, Deserialize)]
pub struct SnarkProveSecrets {
    pub a: String,
    pub r: String,
    pub v: String,
    pub w0: String,
    pub w1: String,
}

/// Result of a SNARK proof generation
#[derive(Debug, Clone, Serialize)]
pub struct SnarkProofResult {
    #[serde(rename = "proofJson")]
    pub proof_json: String,
    #[serde(rename = "publicJson")]
    pub public_json: String,
}

/// Progress event for setup decompression
#[derive(Clone, Serialize)]
pub struct SnarkSetupProgress {
    pub stage: String,
    pub message: String,
    pub percent: f64,
}

/// Get the snark setup directory (app_data_dir/snark/)
fn setup_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?
        .join("snark");
    Ok(dir)
}

/// Spawn the snark sidecar, collect stdout, and return it on successful exit.
/// Returns an error if the process exits with a non-zero code.
async fn run_snark(app: &tauri::AppHandle, args: Vec<String>) -> Result<String, String> {
    let max_cores = app.state::<MaxCores>().0;
    let mut command = spawn_clean_sidecar("binaries/snark", &args, max_cores)?;

    let child = command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn snark: {e}"))?;

    // Register the PID with NodeManager so the process is killed on app shutdown.
    let pid = child.id().unwrap_or(0);
    let manager = app.state::<NodeManager>();
    manager.set_snark_pid(pid);

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("Failed to wait for snark: {e}"))?;

    manager.clear_snark_pid(pid);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "snark exited with code {:?}: {}",
            output.status.code(),
            stderr
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Check if the SNARK setup files (pk.bin + ccs.bin) exist in the app data directory.
#[tauri::command]
pub async fn snark_check_setup(app: tauri::AppHandle) -> Result<bool, String> {
    let dir = setup_dir(&app)?;
    let pk = dir.join("pk.bin");
    let ccs = dir.join("ccs.bin");
    let vk = dir.join("vk.bin");
    Ok(pk.exists() && ccs.exists() && vk.exists())
}

/// Decompress bundled .zst setup files to the app data directory.
/// Emits "snark-setup-progress" events for frontend progress tracking.
#[tauri::command]
pub async fn snark_decompress_setup(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Emitter;

    let dir = setup_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create snark setup dir: {e}"))?;

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource dir: {e}"))?;

    // In dev mode, resource_dir may point to target/debug; fall back to source tree
    let snark_resource_dir = if resource_dir.join("resources/snark").exists() {
        resource_dir.join("resources/snark")
    } else {
        // Dev fallback: look in src-tauri/resources/snark/
        let src_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        src_dir.join("resources/snark")
    };

    let files = [("pk.bin.zst", "pk.bin"), ("ccs.bin.zst", "ccs.bin")];

    for (i, (compressed_name, output_name)) in files.iter().enumerate() {
        let compressed_path = snark_resource_dir.join(compressed_name);
        let output_path = dir.join(output_name);

        // Skip if already decompressed
        if output_path.exists() {
            continue;
        }

        if !compressed_path.exists() {
            return Err(format!(
                "Compressed setup file not found: {}",
                compressed_path.display()
            ));
        }

        let _ = app.emit(
            "snark-setup-progress",
            SnarkSetupProgress {
                stage: "decompressing".to_string(),
                message: format!("Decompressing {}...", output_name),
                percent: (i as f64 / files.len() as f64) * 100.0,
            },
        );

        // Decompress in a blocking task to avoid blocking the async runtime
        let compressed = compressed_path.clone();
        let output = output_path.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let input_file = std::fs::File::open(&compressed)
                .map_err(|e| format!("Failed to open {}: {e}", compressed.display()))?;
            let decoder = zstd::Decoder::new(input_file)
                .map_err(|e| format!("Failed to create zstd decoder: {e}"))?;
            let mut reader = std::io::BufReader::new(decoder);
            let mut output_file = std::fs::File::create(&output)
                .map_err(|e| format!("Failed to create {}: {e}", output.display()))?;
            std::io::copy(&mut reader, &mut output_file)
                .map_err(|e| format!("Failed to decompress {}: {e}", compressed.display()))?;
            Ok(())
        })
        .await
        .map_err(|e| format!("Decompression task failed: {e}"))??;
    }

    // Copy vk.bin (small, not compressed — only ~2.7KB)
    let vk_output = dir.join("vk.bin");
    if !vk_output.exists() {
        let vk_source = snark_resource_dir.join("vk.bin");
        if !vk_source.exists() {
            return Err(format!(
                "vk.bin not found in resources: {}",
                vk_source.display()
            ));
        }
        std::fs::copy(&vk_source, &vk_output).map_err(|e| format!("Failed to copy vk.bin: {e}"))?;
    }

    let _ = app.emit(
        "snark-setup-progress",
        SnarkSetupProgress {
            stage: "complete".to_string(),
            message: "Setup files ready".to_string(),
            percent: 100.0,
        },
    );

    Ok(())
}

/// Compute GT hash from a secret scalar.
/// Writes secrets to a temp file and passes -input flag to the sidecar.
/// Returns the hash hex string from stdout.
#[tauri::command]
pub async fn snark_gt_to_hash(
    app: tauri::AppHandle,
    tmp_dir_state: tauri::State<'_, AppTmpDir>,
    lock: tauri::State<'_, SnarkLock>,
    a: String,
) -> Result<String, String> {
    let _guard = lock.0.lock().await;
    let secrets_file = write_secrets_file(&tmp_dir_state.0, serde_json::json!({ "a": a }))?;
    let args = vec![
        "hash".to_string(),
        "-input".to_string(),
        secrets_file.path().to_string_lossy().to_string(),
    ];
    let output = run_snark(&app, args).await?;
    drop(secrets_file);
    Ok(output.trim().to_string())
}

/// Compute decryption hash.
/// Writes secrets to a temp file and passes -input flag to the sidecar.
/// Returns the hash hex string from stdout.
#[tauri::command]
pub async fn snark_decrypt_to_hash(
    app: tauri::AppHandle,
    tmp_dir_state: tauri::State<'_, AppTmpDir>,
    lock: tauri::State<'_, SnarkLock>,
    g1b: String,
    r1: String,
    shared: String,
    g2b: String,
) -> Result<String, String> {
    let _guard = lock.0.lock().await;
    let secrets_file = write_secrets_file(
        &tmp_dir_state.0,
        serde_json::json!({
            "g1b": g1b,
            "r1": r1,
            "shared": shared,
            "g2b": g2b,
        }),
    )?;
    let args = vec![
        "decrypt".to_string(),
        "-input".to_string(),
        secrets_file.path().to_string_lossy().to_string(),
    ];
    let output = run_snark(&app, args).await?;
    drop(secrets_file);
    Ok(output.trim().to_string())
}

/// Generate a SNARK proof.
/// Writes secrets to a temp file and passes -input flag to the sidecar.
/// Non-secret paths (-setup, -out) remain as CLI args.
/// Reads proof.json and public.json from the output directory.
/// Returns { proofJson, publicJson }.
#[tauri::command]
pub async fn snark_prove(
    app: tauri::AppHandle,
    tmp_dir_state: tauri::State<'_, AppTmpDir>,
    lock: tauri::State<'_, SnarkLock>,
    secrets: SnarkProveSecrets,
) -> Result<SnarkProofResult, String> {
    let _guard = lock.0.try_lock().map_err(|_| {
        "A SNARK proving operation is already in progress. Please wait for it to complete."
            .to_string()
    })?;
    let snark_dir = setup_dir(&app)?;

    // Verify setup files exist before spawning the sidecar
    if !snark_dir.join("pk.bin").exists() || !snark_dir.join("ccs.bin").exists() {
        return Err(
            "SNARK setup files not found. Please run setup first (Settings → SNARK Setup)."
                .to_string(),
        );
    }

    // Create a temporary directory for output files in the app temp dir
    let tmp_dir = tempfile::Builder::new()
        .prefix("veiled-proof-")
        .tempdir_in(&tmp_dir_state.0)
        .map_err(|e| format!("Failed to create temp dir: {e}"))?;
    let out_dir = tmp_dir.path().to_string_lossy().to_string();

    let secrets_file = write_secrets_file(
        &tmp_dir_state.0,
        serde_json::json!({
            "a": secrets.a,
            "r": secrets.r,
            "v": secrets.v,
            "w0": secrets.w0,
            "w1": secrets.w1,
        }),
    )?;

    let args = vec![
        "prove".to_string(),
        "-input".to_string(),
        secrets_file.path().to_string_lossy().to_string(),
        "-setup".to_string(),
        snark_dir.to_string_lossy().to_string(),
        "-out".to_string(),
        out_dir.clone(),
    ];

    run_snark(&app, args).await?;
    drop(secrets_file);

    // Read output files
    let proof_path = tmp_dir.path().join("proof.json");
    let public_path = tmp_dir.path().join("public.json");

    let proof_json = std::fs::read_to_string(&proof_path)
        .map_err(|e| format!("Failed to read proof.json: {e}"))?;
    let public_json = std::fs::read_to_string(&public_path)
        .map_err(|e| format!("Failed to read public.json: {e}"))?;

    Ok(SnarkProofResult {
        proof_json,
        public_json,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_tmp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("peace_snark_test_{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn secrets_temp_file_has_owner_only_permissions() {
        let tmp = test_tmp_dir("perms");
        let secrets = serde_json::json!({ "a": "test_secret" });
        let file = write_secrets_file(&tmp, secrets).unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = file.path().metadata().unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "Temp file should be owner read/write only");
        }

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn secrets_temp_file_contains_valid_json() {
        let tmp = test_tmp_dir("json");
        let secrets = serde_json::json!({ "a": "42", "r": "99" });
        let file = write_secrets_file(&tmp, secrets).unwrap();
        let contents = std::fs::read_to_string(file.path()).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
        assert_eq!(parsed["a"], "42");
        assert_eq!(parsed["r"], "99");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn secrets_temp_file_uses_prefix() {
        let tmp = test_tmp_dir("prefix");
        let file = write_secrets_file(&tmp, serde_json::json!({})).unwrap();
        let name = file
            .path()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert!(
            name.starts_with("veiled-snark-"),
            "Temp file should have veiled-snark- prefix, got: {name}"
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn secrets_temp_file_created_in_specified_dir() {
        let tmp = test_tmp_dir("indir");
        let file = write_secrets_file(&tmp, serde_json::json!({})).unwrap();
        assert_eq!(file.path().parent().unwrap(), tmp);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn cleanup_try_lock_fails_when_snark_locked() {
        // Simulate: prove holds the lock, cleanup task tries try_lock
        let rt = tauri::async_runtime::handle();
        rt.block_on(async {
            let mutex = std::sync::Arc::new(tokio::sync::Mutex::new(()));
            let _guard = mutex.lock().await;
            assert!(
                mutex.try_lock().is_err(),
                "try_lock should fail when a prove operation holds the lock"
            );
        });
    }

    #[test]
    fn cleanup_try_lock_succeeds_when_snark_unlocked() {
        // Simulate: no prove running, cleanup task tries try_lock
        let mutex = std::sync::Arc::new(tokio::sync::Mutex::new(()));
        assert!(
            mutex.try_lock().is_ok(),
            "try_lock should succeed when no prove operation is running"
        );
    }

    #[test]
    fn snark_prove_rejects_concurrent_operation() {
        // Simulate: try_lock used in snark_prove returns a clear error
        let rt = tauri::async_runtime::handle();
        rt.block_on(async {
            let mutex = std::sync::Arc::new(tokio::sync::Mutex::new(()));
            let _guard = mutex.lock().await;
            let result: Result<(), String> = mutex.try_lock().map(|_| ()).map_err(|_| {
                "A SNARK proving operation is already in progress. Please wait for it to complete."
                    .to_string()
            });
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("already in progress"));
        });
    }
}
