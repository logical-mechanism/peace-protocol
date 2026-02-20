use serde::Serialize;
use std::path::{Path, PathBuf};

/// Managed state holding the base directory for cached images.
pub struct MediaDir(pub PathBuf);

/// Managed state holding the base directory for purchased/decrypted content.
pub struct ContentDir(pub PathBuf);

/// Valid content categories (must match fe/src/config/categories.ts).
const VALID_CATEGORIES: &[&str] = &["text", "document", "audio", "image", "video", "other"];

/// Create all category subdirectories under the content root.
pub fn ensure_content_dirs(base: &Path) -> Result<(), String> {
    for category in VALID_CATEGORIES {
        let dir = base.join(category);
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create content/{category} directory: {e}"))?;
    }
    Ok(())
}

/// Maximum download size: 10 MB.
const MAX_DOWNLOAD_BYTES: usize = 10 * 1024 * 1024;

#[derive(Serialize, Clone)]
pub struct ImageResult {
    pub base64: String,
    pub content_type: String,
}

#[derive(Serialize)]
pub struct ImageCacheStatus {
    pub cached: Vec<String>,
    pub banned: Vec<String>,
}

// ── Helpers ─────────────────────────────────────────────────────────────

fn detect_content_type(bytes: &[u8]) -> &'static str {
    if bytes.len() >= 4 && bytes[..4] == [0x89, 0x50, 0x4E, 0x47] {
        return "image/png";
    }
    if bytes.len() >= 3 && bytes[..3] == [0xFF, 0xD8, 0xFF] {
        return "image/jpeg";
    }
    if bytes.len() >= 4 && &bytes[..4] == b"GIF8" {
        return "image/gif";
    }
    if bytes.len() > 11 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return "image/webp";
    }
    "image/png" // fallback
}

fn img_path(dir: &Path, token_name: &str) -> PathBuf {
    dir.join(format!("{}.img", token_name))
}

fn banned_path(dir: &Path, token_name: &str) -> PathBuf {
    dir.join(format!("{}.banned", token_name))
}

fn validate_token_name(token_name: &str) -> Result<(), String> {
    if token_name.is_empty() || token_name.len() > 128 {
        return Err("Invalid token name".to_string());
    }
    // Only allow hex characters (token names are hex-encoded on-chain)
    if !token_name.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Token name must be hex characters only".to_string());
    }
    Ok(())
}

fn read_image_result(dir: &Path, token_name: &str) -> Result<Option<ImageResult>, String> {
    let path = img_path(dir, token_name);
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read cached image: {e}"))?;
    if bytes.is_empty() {
        return Ok(None);
    }
    let content_type = detect_content_type(&bytes).to_string();
    use base64::Engine;
    let base64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(Some(ImageResult {
        base64,
        content_type,
    }))
}

// ── Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn download_image(
    state: tauri::State<'_, MediaDir>,
    token_name: String,
    url: String,
) -> Result<ImageResult, String> {
    validate_token_name(&token_name)?;

    // Validate URL
    let parsed: reqwest::Url = url.parse().map_err(|_| "Invalid URL format".to_string())?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err("URL must use http:// or https://".to_string());
    }

    // Download with timeout and size limit
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    if bytes.len() > MAX_DOWNLOAD_BYTES {
        return Err(format!(
            "Image too large: {} bytes (max {} bytes)",
            bytes.len(),
            MAX_DOWNLOAD_BYTES
        ));
    }

    if bytes.is_empty() {
        return Err("Downloaded file is empty".to_string());
    }

    // Save to disk
    let path = img_path(&state.0, &token_name);
    std::fs::write(&path, &bytes).map_err(|e| format!("Failed to save image: {e}"))?;

    // Remove any existing ban marker (downloading a new image clears the ban)
    let ban = banned_path(&state.0, &token_name);
    if ban.exists() {
        let _ = std::fs::remove_file(&ban);
    }

    // Return base64
    let content_type = detect_content_type(&bytes).to_string();
    use base64::Engine;
    let base64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    Ok(ImageResult {
        base64,
        content_type,
    })
}

#[tauri::command]
pub fn get_cached_image(
    state: tauri::State<'_, MediaDir>,
    token_name: String,
) -> Result<Option<ImageResult>, String> {
    validate_token_name(&token_name)?;

    // If banned, return None (frontend will show banned.png)
    if banned_path(&state.0, &token_name).exists() {
        return Ok(None);
    }

    read_image_result(&state.0, &token_name)
}

#[tauri::command]
pub fn list_cached_images(state: tauri::State<'_, MediaDir>) -> Result<ImageCacheStatus, String> {
    let mut cached = Vec::new();
    let mut banned = Vec::new();

    let entries =
        std::fs::read_dir(&state.0).map_err(|e| format!("Failed to read media directory: {e}"))?;

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        if let Some(token) = name_str.strip_suffix(".img") {
            cached.push(token.to_string());
        } else if let Some(token) = name_str.strip_suffix(".banned") {
            banned.push(token.to_string());
        }
    }

    Ok(ImageCacheStatus { cached, banned })
}

#[tauri::command]
pub fn ban_image(state: tauri::State<'_, MediaDir>, token_name: String) -> Result<(), String> {
    validate_token_name(&token_name)?;

    // Create ban marker
    let ban = banned_path(&state.0, &token_name);
    std::fs::write(&ban, b"").map_err(|e| format!("Failed to create ban marker: {e}"))?;

    // Delete cached image to free disk space
    let img = img_path(&state.0, &token_name);
    if img.exists() {
        let _ = std::fs::remove_file(&img);
    }

    Ok(())
}

#[tauri::command]
pub fn unban_image(state: tauri::State<'_, MediaDir>, token_name: String) -> Result<(), String> {
    validate_token_name(&token_name)?;

    let ban = banned_path(&state.0, &token_name);
    if ban.exists() {
        std::fs::remove_file(&ban).map_err(|e| format!("Failed to remove ban marker: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
pub fn delete_cached_image(
    state: tauri::State<'_, MediaDir>,
    token_name: String,
) -> Result<(), String> {
    validate_token_name(&token_name)?;

    let img = img_path(&state.0, &token_name);
    if img.exists() {
        let _ = std::fs::remove_file(&img);
    }

    let ban = banned_path(&state.0, &token_name);
    if ban.exists() {
        let _ = std::fs::remove_file(&ban);
    }

    Ok(())
}

// ── Content commands (for future data layer) ──────────────────────────

fn validate_category(category: &str) -> Result<(), String> {
    if VALID_CATEGORIES.contains(&category) {
        Ok(())
    } else {
        Err(format!("Invalid category: {category}"))
    }
}

fn validate_file_name(file_name: &str) -> Result<(), String> {
    if file_name.is_empty() || file_name.len() > 255 {
        return Err("Invalid file name".to_string());
    }
    // Reject path traversal attempts
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return Err("File name must not contain path separators".to_string());
    }
    Ok(())
}

/// Save decrypted content to the appropriate category folder.
/// Returns the absolute path of the saved file.
#[tauri::command]
pub fn save_content(
    state: tauri::State<'_, ContentDir>,
    token_name: String,
    category: String,
    file_name: String,
    data: Vec<u8>,
) -> Result<String, String> {
    validate_token_name(&token_name)?;
    validate_category(&category)?;
    validate_file_name(&file_name)?;

    if data.is_empty() {
        return Err("Content data is empty".to_string());
    }

    // Create a subdirectory per token to avoid name collisions
    let token_dir = state.0.join(&category).join(&token_name);
    std::fs::create_dir_all(&token_dir)
        .map_err(|e| format!("Failed to create content directory: {e}"))?;

    let file_path = token_dir.join(&file_name);
    std::fs::write(&file_path, &data).map_err(|e| format!("Failed to save content: {e}"))?;

    file_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "File path contains invalid UTF-8".to_string())
}
