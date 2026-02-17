use serde::Serialize;
use tauri::Manager;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

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
    let shell = app.shell();
    let command = shell
        .sidecar("snark")
        .map_err(|e| format!("Failed to create snark sidecar: {e}"))?;
    let command = command.args(args);

    let (mut rx, _child) = command
        .spawn()
        .map_err(|e| format!("Failed to spawn snark: {e}"))?;

    let mut stdout_lines = Vec::new();
    let mut stderr_lines = Vec::new();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(data) => {
                let line = String::from_utf8_lossy(&data).trim().to_string();
                if !line.is_empty() {
                    stdout_lines.push(line);
                }
            }
            CommandEvent::Stderr(data) => {
                let line = String::from_utf8_lossy(&data).trim().to_string();
                if !line.is_empty() {
                    stderr_lines.push(line);
                }
            }
            CommandEvent::Error(err) => {
                return Err(format!("snark process error: {err}"));
            }
            CommandEvent::Terminated(payload) => {
                if payload.code != Some(0) {
                    let stderr = stderr_lines.join("\n");
                    return Err(format!(
                        "snark exited with code {:?}: {}",
                        payload.code, stderr
                    ));
                }
                break;
            }
            _ => {}
        }
    }

    Ok(stdout_lines.join("\n"))
}

/// Check if the SNARK setup files (pk.bin + ccs.bin) exist in the app data directory.
#[tauri::command]
pub async fn snark_check_setup(app: tauri::AppHandle) -> Result<bool, String> {
    let dir = setup_dir(&app)?;
    let pk = dir.join("pk.bin");
    let ccs = dir.join("ccs.bin");
    Ok(pk.exists() && ccs.exists())
}

/// Decompress bundled .zst setup files to the app data directory.
/// Emits "snark-setup-progress" events for frontend progress tracking.
#[tauri::command]
pub async fn snark_decompress_setup(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Emitter;

    let dir = setup_dir(&app)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create snark setup dir: {e}"))?;

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
/// Spawns: snark hash -a <a>
/// Returns the hash hex string from stdout.
#[tauri::command]
pub async fn snark_gt_to_hash(app: tauri::AppHandle, a: String) -> Result<String, String> {
    let args = vec!["hash".to_string(), "-a".to_string(), a];
    let output = run_snark(&app, args).await?;
    Ok(output.trim().to_string())
}

/// Compute decryption hash.
/// Spawns: snark decrypt -g1b <g1b> -r1 <r1> -shared <shared> [-g2b <g2b>]
/// Returns the hash hex string from stdout.
#[tauri::command]
pub async fn snark_decrypt_to_hash(
    app: tauri::AppHandle,
    g1b: String,
    r1: String,
    shared: String,
    g2b: String,
) -> Result<String, String> {
    let mut args = vec![
        "decrypt".to_string(),
        "-g1b".to_string(),
        g1b,
        "-r1".to_string(),
        r1,
        "-shared".to_string(),
        shared,
    ];

    // Only pass -g2b if non-empty (constructor==0 branch)
    if !g2b.is_empty() {
        args.push("-g2b".to_string());
        args.push(g2b);
    }

    let output = run_snark(&app, args).await?;
    Ok(output.trim().to_string())
}

/// Generate a SNARK proof.
/// Spawns: snark prove -a <a> -r <r> -v <v> -w0 <w0> -w1 <w1> -setup <dir> -out <tmp>
/// Reads proof.json and public.json from the output directory.
/// Returns { proofJson, publicJson }.
#[tauri::command]
pub async fn snark_prove(
    app: tauri::AppHandle,
    a: String,
    r: String,
    v: String,
    w0: String,
    w1: String,
) -> Result<SnarkProofResult, String> {
    let snark_dir = setup_dir(&app)?;

    // Create a temporary directory for output files
    let tmp_dir = tempfile::tempdir()
        .map_err(|e| format!("Failed to create temp dir: {e}"))?;
    let out_dir = tmp_dir.path().to_string_lossy().to_string();

    let args = vec![
        "prove".to_string(),
        "-a".to_string(),
        a,
        "-r".to_string(),
        r,
        "-v".to_string(),
        v,
        "-w0".to_string(),
        w0,
        "-w1".to_string(),
        w1,
        "-setup".to_string(),
        snark_dir.to_string_lossy().to_string(),
        "-out".to_string(),
        out_dir.clone(),
    ];

    run_snark(&app, args).await?;

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
