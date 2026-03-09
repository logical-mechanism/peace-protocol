use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

/// Maximum audit log size before rotation (1 MiB).
const MAX_LOG_SIZE: u64 = 1_048_576;

/// Append-only audit logger for secrets directory operations.
///
/// Logs every read/write/delete on secrets with timestamp and operation type
/// (never the secret content). Silently skips on any I/O error — never crashes
/// the app for a logging failure.
pub struct AuditLog {
    path: PathBuf,
    /// Mutex protects concurrent writes from different Tauri command handlers.
    lock: Mutex<()>,
}

impl AuditLog {
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            path: app_data_dir.join("secrets_audit.log"),
            lock: Mutex::new(()),
        }
    }

    /// Log an operation.
    ///
    /// Format: `{unix_timestamp} | {op} | {target}\n`
    ///
    /// Operations: READ, WRITE, DELETE, LIST, MIGRATE, MIGRATE_SKIP
    pub fn log(&self, op: &str, target: &str) {
        let _guard = match self.lock.lock() {
            Ok(g) => g,
            Err(_) => return, // poisoned — silently skip
        };

        // Rotate if needed
        if let Ok(meta) = std::fs::metadata(&self.path) {
            if meta.len() >= MAX_LOG_SIZE {
                let rotated = self.path.with_extension("log.1");
                let _ = std::fs::rename(&self.path, &rotated);
            }
        }

        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs().to_string())
            .unwrap_or_else(|_| "0".to_string());

        let line = format!("{timestamp} | {op} | {target}\n");

        let mut file = match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
        {
            Ok(f) => f,
            Err(_) => return, // silently skip
        };
        let _ = file.write_all(line.as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("peace_audit_test_{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn creates_log_file() {
        let dir = test_dir("creates");
        let log = AuditLog::new(&dir);
        log.log("WRITE", "seller/abc.json");
        assert!(dir.join("secrets_audit.log").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn appends_entries() {
        let dir = test_dir("appends");
        let log = AuditLog::new(&dir);
        log.log("WRITE", "seller/abc.json");
        log.log("READ", "seller/abc.json");
        log.log("DELETE", "seller/abc.json");

        let contents = fs::read_to_string(dir.join("secrets_audit.log")).unwrap();
        let lines: Vec<&str> = contents.lines().collect();
        assert_eq!(lines.len(), 3);
        assert!(lines[0].contains("| WRITE |"));
        assert!(lines[1].contains("| READ |"));
        assert!(lines[2].contains("| DELETE |"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotates_at_limit() {
        let dir = test_dir("rotates");
        let log = AuditLog::new(&dir);
        let log_path = dir.join("secrets_audit.log");

        // Write a file just over the limit
        let big = "x".repeat(MAX_LOG_SIZE as usize + 1);
        fs::write(&log_path, &big).unwrap();

        // Next log entry triggers rotation
        log.log("WRITE", "test.json");

        assert!(dir.join("secrets_audit.log.1").exists());
        // New log has only the new entry
        let contents = fs::read_to_string(&log_path).unwrap();
        assert!(contents.contains("| WRITE |"));
        assert!(contents.len() < 200);
        let _ = fs::remove_dir_all(&dir);
    }
}
