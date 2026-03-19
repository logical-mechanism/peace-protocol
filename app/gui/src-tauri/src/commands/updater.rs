use std::path::{Path, PathBuf};
use tauri::Emitter;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub download_url: String,
    pub release_notes: String,
    pub published_at: String,
    pub download_size: Option<u64>,
}

#[derive(serde::Serialize, Clone)]
pub struct DownloadProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: f64,
}

/// Returns the current app version (compiled from Cargo.toml).
#[tauri::command]
pub fn get_current_version() -> Result<String, String> {
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

/// Checks GitHub releases for a newer version.
#[tauri::command]
pub async fn check_for_update() -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let response = client
        .get("https://api.github.com/repos/logical-mechanism/peace-protocol/releases/latest")
        .header("User-Agent", format!("Veiled/{current}"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Failed to check for updates: {e}"))?;

    if response.status() == reqwest::StatusCode::FORBIDDEN
        || response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
    {
        return Err("GitHub API rate limit reached. Try again later.".to_string());
    }

    if !response.status().is_success() {
        return Err(format!("GitHub API returned status {}", response.status()));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse release data: {e}"))?;

    let tag = json["tag_name"]
        .as_str()
        .ok_or("Missing tag_name in release")?;
    let latest_version = tag.strip_prefix('v').unwrap_or(tag);

    let release_notes = json["body"].as_str().unwrap_or("").to_string();
    let published_at = json["published_at"].as_str().unwrap_or("").to_string();

    // Find the AppImage asset
    let assets = json["assets"]
        .as_array()
        .ok_or("Missing assets in release")?;

    let appimage_asset = assets
        .iter()
        .find(|a| {
            a["name"]
                .as_str()
                .map(|n| n.contains("amd64") && n.ends_with(".AppImage"))
                .unwrap_or(false)
        })
        .ok_or("No AppImage asset found in release")?;

    let download_url = appimage_asset["browser_download_url"]
        .as_str()
        .ok_or("Missing download URL for AppImage asset")?
        .to_string();

    let download_size = appimage_asset["size"].as_u64();

    let update_available = is_newer(latest_version, current);

    Ok(UpdateInfo {
        current_version: current.to_string(),
        latest_version: latest_version.to_string(),
        update_available,
        download_url,
        release_notes,
        published_at,
        download_size,
    })
}

/// Downloads the update AppImage with streaming progress events.
#[tauri::command]
pub async fn download_update(
    download_url: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    // Security: only allow downloads from the project's GitHub repo
    if !download_url.starts_with("https://github.com/logical-mechanism/") {
        return Err("Invalid download URL: must be from the project repository".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let response = client
        .get(&download_url)
        .header(
            "User-Agent",
            format!("Veiled/{}", env!("CARGO_PKG_VERSION")),
        )
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    let total_bytes = response.content_length().unwrap_or(0);
    let filename = download_url
        .rsplit('/')
        .next()
        .unwrap_or("Veiled_update.AppImage");

    let save_dir = get_appimage_dir().unwrap_or_else(|| {
        std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/tmp"))
    });

    // Ensure directory exists
    std::fs::create_dir_all(&save_dir)
        .map_err(|e| format!("Cannot create download directory: {e}"))?;

    let final_path = save_dir.join(filename);
    let tmp_path = save_dir.join(format!(".{filename}.download"));

    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| format!("Cannot create download file: {e}"))?;

    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write error: {e}"))?;
        downloaded += chunk.len() as u64;

        // Throttle progress events to ~10/sec
        if last_emit.elapsed() > std::time::Duration::from_millis(100) {
            let percent = if total_bytes > 0 {
                (downloaded as f64 / total_bytes as f64) * 100.0
            } else {
                0.0
            };
            let _ = app_handle.emit(
                "update-download-progress",
                DownloadProgress {
                    downloaded_bytes: downloaded,
                    total_bytes,
                    percent,
                },
            );
            last_emit = std::time::Instant::now();
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Flush error: {e}"))?;
    drop(file);

    // Rename temp file to final name
    tokio::fs::rename(&tmp_path, &final_path)
        .await
        .map_err(|e| format!("Failed to finalize download: {e}"))?;

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        std::fs::set_permissions(&final_path, perms)
            .map_err(|e| format!("Failed to set executable permission: {e}"))?;
    }

    // Emit final 100% progress
    let _ = app_handle.emit(
        "update-download-progress",
        DownloadProgress {
            downloaded_bytes: downloaded,
            total_bytes: downloaded,
            percent: 100.0,
        },
    );

    Ok(final_path.to_string_lossy().into())
}

/// Resolves the directory containing the running AppImage.
fn get_appimage_dir() -> Option<PathBuf> {
    // APPIMAGE env var is set by the AppImage runtime
    std::env::var("APPIMAGE")
        .ok()
        .and_then(|p| Path::new(&p).parent().map(|d| d.to_path_buf()))
}

/// Returns true if `latest` is a newer semver than `current`.
fn is_newer(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> {
        v.split('.')
            .filter_map(|part| part.parse::<u32>().ok())
            .collect()
    };
    let l = parse(latest);
    let c = parse(current);
    for i in 0..3 {
        let lv = l.get(i).copied().unwrap_or(0);
        let cv = c.get(i).copied().unwrap_or(0);
        if lv > cv {
            return true;
        }
        if lv < cv {
            return false;
        }
    }
    false
}
