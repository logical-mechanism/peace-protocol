use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Emitter;

/// Shared flag the frontend toggles to cancel an in-flight download.
/// `download_update` resets it to `false` at start and polls inside the chunk
/// loop; `cancel_update_download` flips it to `true`.
pub struct DownloadCancelFlag(pub Arc<AtomicBool>);

impl Default for DownloadCancelFlag {
    fn default() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }
}

/// Sentinel returned by `download_update` when the user cancelled. The
/// frontend matches on this exact string to distinguish a cancel from a real
/// error and avoid showing an error toast.
pub const CANCELLED_SENTINEL: &str = "cancelled";

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
    pub bytes_per_sec: f64,
}

/// Rolling window over (timestamp, cumulative_bytes) samples used to estimate
/// the download rate. Old samples (>1s) are pruned before each rate query so
/// the result reflects the most recent throughput, not the all-run average.
const RATE_WINDOW: Duration = Duration::from_secs(1);

struct RateTracker {
    samples: Vec<(Instant, u64)>,
}

impl RateTracker {
    fn new() -> Self {
        Self {
            samples: Vec::new(),
        }
    }

    fn record(&mut self, now: Instant, cumulative: u64) {
        self.samples.push((now, cumulative));
        self.prune(now);
    }

    fn prune(&mut self, now: Instant) {
        if let Some(cutoff) = now.checked_sub(RATE_WINDOW) {
            self.samples.retain(|(t, _)| *t >= cutoff);
        }
    }

    fn rate_bytes_per_sec(&self) -> f64 {
        if self.samples.len() < 2 {
            return 0.0;
        }
        let (t0, b0) = self.samples.first().copied().unwrap();
        let (t1, b1) = self.samples.last().copied().unwrap();
        let elapsed = t1.duration_since(t0).as_secs_f64();
        if elapsed <= 0.0 {
            return 0.0;
        }
        let delta = b1.saturating_sub(b0) as f64;
        delta / elapsed
    }
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
///
/// `expected_size` is the asset size from the GitHub release JSON. We prefer
/// it over `Content-Length` because GitHub's redirect to the asset CDN can
/// strip or misreport the header, leaving percent stuck at 0.
#[tauri::command]
pub async fn download_update(
    download_url: String,
    expected_size: Option<u64>,
    cancel_flag: tauri::State<'_, DownloadCancelFlag>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    // Security: only allow downloads from the project's GitHub repo
    if !is_valid_download_url(&download_url) {
        return Err("Invalid download URL: must be from the project repository".to_string());
    }

    // Reset cancellation flag at start of each download. If the user clicked
    // Cancel during a previous (already-finished) download, that signal must
    // not pre-cancel this one.
    let flag = cancel_flag.0.clone();
    flag.store(false, Ordering::SeqCst);

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

    let total_bytes = expected_size
        .or_else(|| response.content_length())
        .unwrap_or(0);
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
    let mut last_emit = Instant::now();
    let mut rate = RateTracker::new();

    while let Some(chunk) = stream.next().await {
        if flag.load(Ordering::Relaxed) {
            // Drop the file handle before deleting so the OS doesn't keep it
            // alive on Windows. Best-effort tmp cleanup — ignore failure.
            drop(file);
            let _ = tokio::fs::remove_file(&tmp_path).await;
            return Err(CANCELLED_SENTINEL.to_string());
        }
        let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write error: {e}"))?;
        downloaded += chunk.len() as u64;
        rate.record(Instant::now(), downloaded);

        // Throttle progress events to ~10/sec
        if last_emit.elapsed() > Duration::from_millis(100) {
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
                    bytes_per_sec: rate.rate_bytes_per_sec(),
                },
            );
            last_emit = Instant::now();
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
            bytes_per_sec: 0.0,
        },
    );

    Ok(final_path.to_string_lossy().into())
}

/// Signals an in-flight `download_update` to abort at its next chunk
/// boundary. Idempotent — flipping the flag while no download is running is a
/// no-op (the next download resets it). Returns immediately; the frontend
/// observes the cancellation when `download_update` returns
/// `Err(CANCELLED_SENTINEL)`.
#[tauri::command]
pub fn cancel_update_download(cancel_flag: tauri::State<'_, DownloadCancelFlag>) {
    cancel_flag.0.store(true, Ordering::SeqCst);
}

/// Resolves the directory containing the running AppImage.
fn get_appimage_dir() -> Option<PathBuf> {
    // APPIMAGE env var is set by the AppImage runtime
    std::env::var("APPIMAGE")
        .ok()
        .and_then(|p| Path::new(&p).parent().map(|d| d.to_path_buf()))
}

/// Validates that a download URL is from the project repository.
fn is_valid_download_url(url: &str) -> bool {
    url.starts_with("https://github.com/logical-mechanism/")
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_patch() {
        assert!(is_newer("0.4.3", "0.4.2"));
    }

    #[test]
    fn newer_minor() {
        assert!(is_newer("0.5.0", "0.4.9"));
    }

    #[test]
    fn newer_major() {
        assert!(is_newer("1.0.0", "0.99.99"));
    }

    #[test]
    fn same_version() {
        assert!(!is_newer("0.4.2", "0.4.2"));
    }

    #[test]
    fn older_version() {
        assert!(!is_newer("0.4.1", "0.4.2"));
    }

    #[test]
    fn double_digit_patch() {
        assert!(is_newer("0.4.10", "0.4.9"));
    }

    #[test]
    fn double_digit_not_lexicographic() {
        // "0.4.9" > "0.4.10" lexicographically, but numerically 10 > 9
        assert!(is_newer("0.4.10", "0.4.9"));
        assert!(!is_newer("0.4.9", "0.4.10"));
    }

    #[test]
    fn missing_patch() {
        assert!(is_newer("1.0", "0.4.2"));
        assert!(!is_newer("0.4", "0.4.2"));
    }

    #[test]
    fn valid_download_url() {
        assert!(is_valid_download_url(
            "https://github.com/logical-mechanism/peace-protocol/releases/download/v0.4.3/Veiled_0.4.3_amd64.AppImage"
        ));
    }

    #[test]
    fn invalid_download_url() {
        assert!(!is_valid_download_url("https://evil.com/malware.AppImage"));
        assert!(!is_valid_download_url(
            "https://github.com/other-org/repo/releases/download/v1.0/app.AppImage"
        ));
    }

    #[test]
    fn appimage_dir_without_env() {
        // When APPIMAGE is not set, should return None
        std::env::remove_var("APPIMAGE");
        assert!(get_appimage_dir().is_none());
    }

    #[test]
    fn appimage_dir_with_env() {
        std::env::set_var("APPIMAGE", "/home/user/Desktop/Veiled_0.4.2_amd64.AppImage");
        let dir = get_appimage_dir();
        assert_eq!(dir, Some(PathBuf::from("/home/user/Desktop")));
        std::env::remove_var("APPIMAGE");
    }

    #[test]
    fn rate_tracker_empty() {
        let r = RateTracker::new();
        assert_eq!(r.rate_bytes_per_sec(), 0.0);
    }

    #[test]
    fn rate_tracker_single_sample() {
        let mut r = RateTracker::new();
        r.record(Instant::now(), 1_000);
        assert_eq!(r.rate_bytes_per_sec(), 0.0);
    }

    #[test]
    fn rate_tracker_computes_bytes_per_sec_over_window() {
        let mut r = RateTracker::new();
        let t0 = Instant::now();
        r.record(t0, 0);
        r.record(t0 + Duration::from_millis(500), 500_000);
        r.record(t0 + Duration::from_millis(1_000), 1_000_000);
        // Over the 1s window, downloaded 1_000_000 bytes → 1 MB/s.
        assert!((r.rate_bytes_per_sec() - 1_000_000.0).abs() < 1.0);
    }

    #[test]
    fn rate_tracker_prunes_old_samples() {
        let mut r = RateTracker::new();
        let t0 = Instant::now();
        // 5 seconds of slow download history that should be discarded.
        r.record(t0, 0);
        r.record(t0 + Duration::from_secs(1), 100);
        r.record(t0 + Duration::from_secs(2), 200);
        r.record(t0 + Duration::from_secs(3), 300);
        r.record(t0 + Duration::from_secs(4), 400);
        // A burst in the last second: jumps to 2_000_400 bytes.
        r.record(t0 + Duration::from_secs(5), 2_000_400);
        // The old slow window must not drag the rate down — recent burst dominates.
        let rate = r.rate_bytes_per_sec();
        assert!(
            rate > 1_500_000.0,
            "expected rolling rate to reflect recent burst, got {rate}"
        );
    }

    #[test]
    fn cancel_flag_default_is_false_and_shared_across_clones() {
        let flag = DownloadCancelFlag::default();
        assert!(!flag.0.load(Ordering::SeqCst));
        let cloned = flag.0.clone();
        cloned.store(true, Ordering::SeqCst);
        // Both Arc clones observe the same atomic — the cancel command can
        // flip the flag and `download_update`'s loop sees it.
        assert!(flag.0.load(Ordering::SeqCst));
    }

    #[test]
    fn rate_tracker_zero_elapsed_returns_zero() {
        let mut r = RateTracker::new();
        let t = Instant::now();
        // Multiple samples at the same instant — elapsed is zero.
        r.record(t, 0);
        r.record(t, 100);
        r.record(t, 200);
        assert_eq!(r.rate_bytes_per_sec(), 0.0);
    }
}
