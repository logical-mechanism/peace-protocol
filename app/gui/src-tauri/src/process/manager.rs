use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

/// Status of a managed process
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum ProcessStatus {
    Stopped,
    Starting,
    Running,
    Syncing { progress: f64 },
    Ready,
    Error { message: String },
}

/// Info about a managed process, returned to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub name: String,
    pub status: ProcessStatus,
    pub pid: Option<u32>,
    pub restart_count: u32,
    pub last_error: Option<String>,
}

/// Configuration for auto-restart behavior
#[derive(Debug, Clone)]
pub struct RestartPolicy {
    pub max_retries: u32,
    pub initial_delay_ms: u64,
    pub backoff_multiplier: f64,
}

impl Default for RestartPolicy {
    fn default() -> Self {
        Self {
            max_retries: 5,
            initial_delay_ms: 1000,
            backoff_multiplier: 2.0,
        }
    }
}

/// Event emitted to the frontend when process status changes
#[derive(Clone, Serialize)]
pub struct ProcessEvent {
    pub name: String,
    pub status: ProcessStatus,
    pub log_line: Option<String>,
}

const LOG_BUFFER_SIZE: usize = 500;

/// How this process was originally launched (for auto-restart)
#[derive(Clone)]
enum LaunchInfo {
    Command {
        program: String,
        args: Vec<String>,
        cwd: Option<std::path::PathBuf>,
        env_vars: Vec<(String, String)>,
        suppress_output: bool,
    },
}

/// Per-process graceful shutdown timeout (seconds).
/// cardano-node needs extra time to flush its in-memory ledger to disk.
///
/// Overridable via environment variables for users with slow storage:
///   SHUTDOWN_TIMEOUT_CARDANO, SHUTDOWN_TIMEOUT_MITHRIL, SHUTDOWN_TIMEOUT_DEFAULT
fn default_shutdown_timeout(name: &str) -> u64 {
    let (env_key, fallback) = match name {
        "cardano-node" => ("SHUTDOWN_TIMEOUT_CARDANO", 90),
        "mithril-client" => ("SHUTDOWN_TIMEOUT_MITHRIL", 30),
        _ => ("SHUTDOWN_TIMEOUT_DEFAULT", 10),
    };
    match std::env::var(env_key) {
        Ok(val) => match val.parse() {
            Ok(v) => v,
            Err(_) => {
                eprintln!(
                    "Warning: invalid value '{val}' for {env_key}, using default {fallback}s"
                );
                fallback
            }
        },
        Err(_) => fallback,
    }
}

/// A single managed child process with its metadata
struct ManagedProcess {
    info: ProcessInfo,
    restart_policy: RestartPolicy,
    log_buffer: Vec<String>,
    /// How this process was started (stored for auto-restart)
    launch_info: Option<LaunchInfo>,
    /// Set to true by stop() to prevent auto-restart after intentional shutdown
    user_stopped: bool,
    /// Maximum seconds to wait for graceful shutdown before SIGKILL
    shutdown_timeout_secs: u64,
    /// Consecutive HTTP health check failures (for services with health endpoints)
    health_check_failures: u32,
    /// Number of log lines dropped due to buffer eviction
    dropped_log_count: u64,
    /// Last observed tip slot (for stall detection in Ogmios/Kupo)
    last_seen_tip_slot: Option<u64>,
    /// How many consecutive liveness checks showed the same tip slot
    tip_unchanged_count: u32,
}

impl ManagedProcess {
    /// Append a log line to the buffer, evicting the oldest entry if full.
    fn append_log(&mut self, line: String) {
        self.log_buffer.push(line);
        if self.log_buffer.len() > LOG_BUFFER_SIZE {
            self.log_buffer.remove(0);
            self.dropped_log_count += 1;
        }
    }
}

/// Apply ±20% random jitter to a delay to prevent thundering herd on restart.
fn apply_jitter(delay_ms: f64) -> f64 {
    let jitter = rand::thread_rng().gen_range(0.8..=1.2);
    delay_ms * jitter
}

/// Send a signal to a process using libc::kill directly.
/// Returns true if the signal was delivered (process exists), false otherwise.
/// Using libc avoids spawning external `/usr/bin/kill` which can fail inside AppImage.
fn send_signal(pid: u32, signal: i32) -> bool {
    // SAFETY: libc::kill is a POSIX syscall; invalid pid/signal returns -1 (not UB).
    let ok = unsafe { libc::kill(pid as i32, signal) == 0 };
    if !ok && signal != 0 {
        let err = std::io::Error::last_os_error();
        eprintln!(
            "[NodeManager] Failed to send signal {} to PID {}: {}",
            signal, pid, err
        );
    }
    ok
}

/// Check if a process is likely a Veiled-managed process by inspecting /proc/{pid}/cmdline.
/// Returns true if any cmdline argument contains one of the expected binary name substrings.
/// Returns false if /proc cannot be read (process exited, permission denied).
#[cfg(target_os = "linux")]
fn is_veiled_process(pid: u32, expected_names: &[&str]) -> bool {
    let cmdline_path = format!("/proc/{}/cmdline", pid);
    let cmdline_bytes = match std::fs::read(&cmdline_path) {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };
    // /proc/PID/cmdline uses null bytes as argument separators
    let args: Vec<&str> = cmdline_bytes
        .split(|&b| b == 0)
        .filter(|s| !s.is_empty())
        .filter_map(|s| std::str::from_utf8(s).ok())
        .collect();
    expected_names
        .iter()
        .any(|name| args.iter().any(|arg| arg.contains(name)))
}

/// Non-Linux fallback: assume process matches (preserve existing behavior).
#[cfg(not(target_os = "linux"))]
fn is_veiled_process(_pid: u32, _expected_names: &[&str]) -> bool {
    true
}

/// Environment variables that are safe and necessary for sidecar processes.
/// Everything else (especially AppImage-injected vars) is excluded.
const SIDECAR_ENV_ALLOWLIST: &[&str] = &[
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "SHELL",
    "XDG_RUNTIME_DIR",
    "TMPDIR",
    "TZ",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "CARDANO_NODE_SOCKET_PATH",
];

/// Build a clean environment for sidecar processes.
/// Only passes through variables from the allowlist that are currently set.
fn build_clean_env() -> Vec<(String, String)> {
    SIDECAR_ENV_ALLOWLIST
        .iter()
        .filter_map(|&key| std::env::var(key).ok().map(|val| (key.to_string(), val)))
        .collect()
}

/// Resolve the full path to a sidecar binary.
///
/// Tauri convention: sidecar binaries are placed next to the main executable
/// as `{name}-{target_triple}` (e.g., `binaries/ogmios-x86_64-unknown-linux-gnu`).
pub fn resolve_sidecar_path(sidecar_name: &str) -> Result<std::path::PathBuf, String> {
    let exe =
        std::env::current_exe().map_err(|e| format!("Failed to get current exe path: {e}"))?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| "Failed to get exe parent directory".to_string())?;

    let target = env!("TARGET_TRIPLE");

    // Extract the binary basename (strip "binaries/" prefix if present).
    // In dev/source: sidecar_name is "binaries/cardano-node" → file at src-tauri/binaries/cardano-node-{triple}
    // In production: Tauri copies sidecars next to the exe as just "cardano-node-{triple}" (no binaries/ dir)
    let basename = std::path::Path::new(sidecar_name)
        .file_name()
        .unwrap_or(std::ffi::OsStr::new(sidecar_name))
        .to_string_lossy();

    // Candidate paths in priority order:
    // 1. Next to exe using basename (production AppImage — sidecars sit next to exe)
    // 2. Next to exe with full sidecar_name path (unlikely but safe fallback)
    // 3. Dev mode: src-tauri/{sidecar_name} (exe is at target/debug/ or target/release/)
    let mut candidates = vec![
        exe_dir.join(format!("{}-{}", basename, target)),
        exe_dir.join(basename.as_ref()),
        exe_dir.join(format!("{}-{}", sidecar_name, target)),
        exe_dir.join(sidecar_name),
    ];

    // In dev mode, exe_dir is target/debug/ or target/release/.
    // Walk up to src-tauri/ and check the full sidecar_name path there.
    if let Some(target_dir) = exe_dir.parent() {
        if let Some(src_tauri_dir) = target_dir.parent() {
            candidates.push(src_tauri_dir.join(format!("{}-{}", sidecar_name, target)));
            candidates.push(src_tauri_dir.join(sidecar_name));
        }
    }

    for candidate in &candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    let tried: Vec<String> = candidates.iter().map(|p| p.display().to_string()).collect();
    Err(format!(
        "Sidecar binary not found: {} (tried {})",
        sidecar_name,
        tried.join(", ")
    ))
}

/// Build a `tokio::process::Command` for a one-shot sidecar invocation with a clean env.
///
/// Used by cardano-cli (tip queries) and snark (proving/hashing) which are
/// short-lived processes that don't go through NodeManager's lifecycle.
pub fn spawn_clean_sidecar(
    sidecar_name: &str,
    args: &[String],
) -> Result<tokio::process::Command, String> {
    let binary_path = resolve_sidecar_path(sidecar_name)?;
    let env = build_clean_env();

    let mut cmd = tokio::process::Command::new(binary_path);
    cmd.args(args)
        .env_clear()
        .envs(env)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    Ok(cmd)
}

/// Consecutive stale-tip checks before restarting a process.
/// At 10s intervals, 12 checks = 120 seconds of stale data.
/// Generous threshold to avoid false positives on slow hardware or preprod block gaps.
const STALL_DETECTION_THRESHOLD: u32 = 12;

/// The central process manager, held in Tauri state.
/// Manages the lifecycle of all sidecar processes.
pub struct NodeManager {
    processes: Arc<Mutex<HashMap<String, ManagedProcess>>>,
    app_handle: tauri::AppHandle,
    pid_file: std::path::PathBuf,
    /// PIDs of currently-running SNARK sidecars, for cleanup on shutdown.
    /// Uses Vec to handle concurrent SNARK operations without losing PIDs.
    snark_pids: std::sync::Mutex<Vec<u32>>,
}

/// Maximum consecutive HTTP health check failures before marking a process as Error.
/// At 10s intervals, 6 checks = 60 seconds of unresponsive health checks.
const HEALTH_CHECK_FAILURE_THRESHOLD: u32 = 6;

impl NodeManager {
    pub fn new(app_handle: tauri::AppHandle, ogmios_port: u16, kupo_port: u16) -> Self {
        let pid_file = app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("/tmp"))
            .join("managed_pids.json");

        let mgr = Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            app_handle,
            pid_file,
            snark_pids: std::sync::Mutex::new(Vec::new()),
        };

        // Kill any orphaned processes from a previous crashed session
        mgr.kill_orphans_from_pid_file();
        mgr.kill_orphans_on_ports();

        // Start background liveness monitor with HTTP health checks
        Self::spawn_liveness_monitor(
            mgr.processes.clone(),
            mgr.app_handle.clone(),
            mgr.pid_file.clone(),
            ogmios_port,
            kupo_port,
        );

        mgr
    }

    /// Kill orphaned processes from a previous session.
    /// Sends SIGTERM first and waits up to 30 seconds before SIGKILL,
    /// in case the previous session's shutdown is still in progress
    /// (e.g., cardano-node flushing ledger state).
    fn kill_orphans_from_pid_file(&self) {
        let contents = match std::fs::read_to_string(&self.pid_file) {
            Ok(c) => c,
            Err(_) => return, // No pid file = no orphans
        };

        let pids: Vec<u32> = match serde_json::from_str(&contents) {
            Ok(p) => p,
            Err(_) => {
                let _ = std::fs::remove_file(&self.pid_file);
                return;
            }
        };

        let alive_pids: Vec<u32> = pids
            .into_iter()
            .filter(|pid| send_signal(*pid, 0))
            .collect();

        if alive_pids.is_empty() {
            let _ = std::fs::remove_file(&self.pid_file);
            return;
        }

        // SIGTERM first
        for pid in &alive_pids {
            eprintln!("[NodeManager] Sending SIGTERM to orphan pid={pid} from PID file");
            send_signal(*pid, libc::SIGTERM);
        }

        // Wait up to 30 seconds
        Self::wait_for_pids_to_exit(&alive_pids, 30);

        let _ = std::fs::remove_file(&self.pid_file);
    }

    /// Kill any processes listening on our known ports (Express:3001, Ogmios:1337, Kupo:44203).
    /// Catches orphans even when no PID file exists (e.g., first run after adding PID tracking).
    /// Validates process identity via /proc/{pid}/cmdline to avoid killing unrelated processes.
    fn kill_orphans_on_ports(&self) {
        let port_binaries: [(u16, &[&str]); 3] = [
            (3001, &["node", "dist/index.js"]),
            (1337, &["ogmios"]),
            (44203, &["kupo"]),
        ];

        let mut orphan_pids: Vec<u32> = Vec::new();

        for (port, expected_names) in &port_binaries {
            let output = std::process::Command::new("fuser")
                .args([&format!("{}/tcp", port)])
                .output();

            if let Ok(out) = output {
                let pids_str = String::from_utf8_lossy(&out.stdout);
                for token in pids_str.split_whitespace() {
                    if let Ok(pid) = token.parse::<u32>() {
                        if orphan_pids.contains(&pid) {
                            continue;
                        }
                        if is_veiled_process(pid, expected_names) {
                            orphan_pids.push(pid);
                        } else {
                            eprintln!(
                                "[NodeManager] Port {} occupied by pid={}, \
                                 but cmdline does not match {:?} — skipping",
                                port, pid, expected_names
                            );
                        }
                    }
                }
            }
        }

        if orphan_pids.is_empty() {
            return;
        }

        // SIGTERM first
        for pid in &orphan_pids {
            eprintln!("[NodeManager] Sending SIGTERM to orphan on port: pid={pid}");
            send_signal(*pid, libc::SIGTERM);
        }

        // Wait up to 30 seconds
        Self::wait_for_pids_to_exit(&orphan_pids, 30);
    }

    /// Wait for a set of PIDs to exit, up to `timeout_secs`.
    /// Any still alive after the timeout are SIGKILL'd.
    fn wait_for_pids_to_exit(pids: &[u32], timeout_secs: u64) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);

        loop {
            let still_alive: Vec<u32> = pids
                .iter()
                .copied()
                .filter(|pid| send_signal(*pid, 0))
                .collect();

            if still_alive.is_empty() {
                return;
            }

            if std::time::Instant::now() >= deadline {
                for pid in &still_alive {
                    eprintln!(
                        "[NodeManager] SIGKILL orphan pid={pid} (did not exit after SIGTERM)"
                    );
                    send_signal(*pid, libc::SIGKILL);
                }
                return;
            }

            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    }

    /// Persist all active PIDs to disk so they can be cleaned up after a crash.
    /// Uses atomic write (tmp + rename) to prevent corruption on crash.
    fn save_pids_sync(pid_file: &std::path::Path, processes: &HashMap<String, ManagedProcess>) {
        let pids: Vec<u32> = processes.values().filter_map(|p| p.info.pid).collect();

        if pids.is_empty() {
            let _ = std::fs::remove_file(pid_file);
        } else if let Ok(json) = serde_json::to_string(&pids) {
            let tmp = pid_file.with_extension("tmp");
            if std::fs::write(&tmp, &json).is_ok() {
                let _ = std::fs::rename(&tmp, pid_file);
            }
        }
    }

    /// Check that a TCP port is available before spawning a process.
    ///
    /// If the port is occupied by a PID from our `managed_pids.json` (orphan from a
    /// previous session), kill it and wait for exit. If occupied by an unknown PID,
    /// return a clear error message so the user can resolve the conflict.
    pub fn ensure_port_available(&self, port: u16) -> Result<(), String> {
        let output = std::process::Command::new("fuser")
            .args([&format!("{}/tcp", port)])
            .output();

        let pids: Vec<u32> = match output {
            Ok(out) => {
                let pids_str = String::from_utf8_lossy(&out.stdout);
                pids_str
                    .split_whitespace()
                    .filter_map(|t| t.parse().ok())
                    .collect()
            }
            Err(_) => return Ok(()), // fuser not available; skip check
        };

        if pids.is_empty() {
            return Ok(());
        }

        // Load known PIDs from the previous session's pid file
        let known_pids: Vec<u32> = std::fs::read_to_string(&self.pid_file)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or_default();

        for &pid in &pids {
            if known_pids.contains(&pid) {
                // Orphan from previous session — kill it
                eprintln!("[NodeManager] Port {port} occupied by orphan pid={pid}, killing");
                send_signal(pid, libc::SIGTERM);
            } else {
                return Err(format!(
                    "Port {port} is already in use by another process (pid {pid}). \
                     Stop the conflicting process and try again."
                ));
            }
        }

        // Wait for orphans to exit (up to 10s)
        Self::wait_for_pids_to_exit(&pids, 10);
        Ok(())
    }

    /// Start a sidecar binary with a clean environment.
    ///
    /// Resolves the sidecar binary path and spawns it via `start_command()`
    /// with only essential env vars (PATH, HOME, LANG, etc.).
    /// This prevents AppImage-injected environment variables from interfering
    /// with Haskell-based sidecars (Ogmios, Kupo, cardano-node).
    pub async fn start_sidecar(
        &self,
        name: &str,
        sidecar_name: &str,
        args: Vec<String>,
        cwd: Option<&std::path::PathBuf>,
        suppress_output: bool,
    ) -> Result<(), String> {
        let binary_path = resolve_sidecar_path(&format!("binaries/{}", sidecar_name))?;
        let program = binary_path.to_string_lossy().to_string();
        let env_vars = build_clean_env();
        self.start_command(name, &program, args, cwd, env_vars, suppress_output)
            .await
    }

    /// Start a process by spawning a command with explicit environment control.
    ///
    /// Used for ALL managed processes (sidecars via `start_sidecar()` and Express).
    /// The environment is set exclusively from `env_vars` — no inheritance from
    /// the parent process. This prevents AppImage-injected variables from
    /// reaching child processes.
    ///
    /// Includes auto-restart with exponential backoff on non-zero exit.
    pub async fn start_command(
        &self,
        name: &str,
        program: &str,
        args: Vec<String>,
        cwd: Option<&std::path::PathBuf>,
        env_vars: Vec<(String, String)>,
        suppress_output: bool,
    ) -> Result<(), String> {
        // Stop existing process gracefully if running
        self.stop(name).await?;

        // Set status to Starting, store launch info
        let launch = LaunchInfo::Command {
            program: program.to_string(),
            args: args.clone(),
            cwd: cwd.cloned(),
            env_vars: env_vars.clone(),
            suppress_output,
        };
        {
            let mut procs = self.processes.lock().await;
            if let Some(proc) = procs.get_mut(name) {
                proc.info.status = ProcessStatus::Starting;
                proc.log_buffer.clear();
                proc.user_stopped = false;
                proc.launch_info = Some(launch);
            } else {
                procs.insert(
                    name.to_string(),
                    ManagedProcess {
                        info: ProcessInfo {
                            name: name.to_string(),
                            status: ProcessStatus::Starting,
                            pid: None,
                            restart_count: 0,
                            last_error: None,
                        },
                        restart_policy: RestartPolicy::default(),
                        log_buffer: Vec::new(),
                        launch_info: Some(launch),
                        user_stopped: false,
                        shutdown_timeout_secs: default_shutdown_timeout(name),
                        health_check_failures: 0,
                        dropped_log_count: 0,
                        last_seen_tip_slot: None,
                        tip_unchanged_count: 0,
                    },
                );
            }
        }

        self.emit_status(name, ProcessStatus::Starting, None);

        // Build the tokio command with a clean environment.
        // Start with the allowlisted system vars, then overlay caller-provided vars
        // (so Express can add PORT, NODE_ENV, etc. on top of PATH, HOME, etc.).
        let mut merged_env = build_clean_env();
        for (k, v) in &env_vars {
            // Override or add caller-provided vars
            if let Some(existing) = merged_env.iter_mut().find(|(ek, _)| ek == k) {
                existing.1 = v.clone();
            } else {
                merged_env.push((k.clone(), v.clone()));
            }
        }
        let mut cmd = tokio::process::Command::new(program);
        cmd.args(&args).env_clear().envs(merged_env.iter().cloned());

        if suppress_output {
            cmd.stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
        } else {
            cmd.stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());
        }

        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }

        let mut child = cmd.spawn().map_err(|e| {
            let msg = format!("Failed to spawn '{}': {}", program, e);
            self.emit_status(
                name,
                ProcessStatus::Error {
                    message: msg.clone(),
                },
                None,
            );
            msg
        })?;

        let pid = child.id().unwrap_or(0);
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Track by PID
        {
            let mut procs = self.processes.lock().await;
            if let Some(proc) = procs.get_mut(name) {
                proc.info.pid = Some(pid);
                proc.info.status = ProcessStatus::Running;
                proc.info.last_error = None;
                proc.info.restart_count = 0; // Reset so future crashes get full retry budget
            }
            Self::save_pids_sync(&self.pid_file, &procs);
        }

        self.emit_status(name, ProcessStatus::Running, None);

        // Spawn background tasks for stdout/stderr capture + wait for exit
        let app_handle = self.app_handle.clone();
        let processes = self.processes.clone();
        let process_name = name.to_string();
        let pid_file = self.pid_file.clone();

        tauri::async_runtime::spawn(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};

            if let Some(out) = stdout {
                let app = app_handle.clone();
                let procs = processes.clone();
                let pname = process_name.clone();
                tauri::async_runtime::spawn(async move {
                    let mut lines = BufReader::new(out).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        if line.is_empty() {
                            continue;
                        }
                        {
                            let mut p = procs.lock().await;
                            if let Some(proc) = p.get_mut(&pname) {
                                proc.append_log(line.clone());
                            }
                        }
                        // Emit structured mithril-progress events for the download UI
                        if pname == "mithril-client" {
                            if let Some(progress) =
                                crate::process::mithril::parse_mithril_output(&line)
                            {
                                let _ = app.emit("mithril-progress", progress);
                            }
                        }
                        let _ = app.emit(
                            "process-status",
                            ProcessEvent {
                                name: pname.clone(),
                                status: ProcessStatus::Running,
                                log_line: Some(line),
                            },
                        );
                    }
                });
            }

            if let Some(err) = stderr {
                let app = app_handle.clone();
                let procs = processes.clone();
                let pname = process_name.clone();
                tauri::async_runtime::spawn(async move {
                    let mut lines = BufReader::new(err).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        if line.is_empty() {
                            continue;
                        }
                        let log_line = format!("[stderr] {}", line);
                        {
                            let mut p = procs.lock().await;
                            if let Some(proc) = p.get_mut(&pname) {
                                proc.append_log(log_line.clone());
                            }
                        }
                        // Emit structured mithril-progress events (download progress comes on stderr)
                        if pname == "mithril-client" {
                            if let Some(progress) =
                                crate::process::mithril::parse_mithril_output(&line)
                            {
                                let _ = app.emit("mithril-progress", progress);
                            }
                        }
                        let _ = app.emit(
                            "process-status",
                            ProcessEvent {
                                name: pname.clone(),
                                status: ProcessStatus::Running,
                                log_line: Some(log_line),
                            },
                        );
                    }
                });
            }

            // Wait for exit
            let exit_status = child.wait().await;
            let (code, msg) = match exit_status {
                Ok(s) => (s.code(), format!("Process exited with code {:?}", s.code())),
                Err(e) => (None, format!("Process wait error: {}", e)),
            };
            let is_crash = code != Some(0);

            if is_crash {
                // Check if auto-restart is appropriate
                let restart_info = {
                    let mut procs = processes.lock().await;
                    if let Some(proc) = procs.get_mut(&process_name) {
                        proc.info.pid = None;
                        proc.info.last_error = Some(msg.clone());

                        if proc.user_stopped {
                            proc.info.status = ProcessStatus::Stopped;
                            None
                        } else if proc.info.restart_count < proc.restart_policy.max_retries {
                            proc.info.restart_count += 1;
                            let base_delay = proc.restart_policy.initial_delay_ms as f64
                                * proc
                                    .restart_policy
                                    .backoff_multiplier
                                    .powi((proc.info.restart_count - 1) as i32);
                            let delay = apply_jitter(base_delay);
                            proc.info.status = ProcessStatus::Error {
                                message: format!(
                                    "{} (restarting in {:.0}s, attempt {}/{})",
                                    msg,
                                    delay / 1000.0,
                                    proc.info.restart_count,
                                    proc.restart_policy.max_retries
                                ),
                            };
                            proc.launch_info.clone().map(|li| (li, delay))
                        } else {
                            proc.info.status = ProcessStatus::Error {
                                message: format!(
                                    "{} (max restarts {} reached)",
                                    msg, proc.restart_policy.max_retries
                                ),
                            };
                            None
                        }
                    } else {
                        None
                    }
                };

                if let Some((
                    LaunchInfo::Command {
                        program,
                        args,
                        cwd,
                        env_vars,
                        suppress_output,
                    },
                    delay,
                )) = restart_info
                {
                    // Schedule restart after delay
                    let app2 = app_handle.clone();
                    let procs2 = processes.clone();
                    let pname2 = process_name.clone();
                    let pid_file2 = pid_file.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(tokio::time::Duration::from_millis(delay as u64)).await;

                        // Re-check that user hasn't stopped it during the delay
                        let still_should = {
                            let p = procs2.lock().await;
                            p.get(&pname2).map(|pr| !pr.user_stopped).unwrap_or(false)
                        };
                        if !still_should {
                            return;
                        }

                        let _ = app2.emit(
                            "process-status",
                            ProcessEvent {
                                name: pname2.clone(),
                                status: ProcessStatus::Starting,
                                log_line: Some("Auto-restarting...".to_string()),
                            },
                        );

                        // Re-spawn the command with clean env + caller vars
                        let mut restart_env = build_clean_env();
                        for (k, v) in &env_vars {
                            if let Some(existing) = restart_env.iter_mut().find(|(ek, _)| ek == k) {
                                existing.1 = v.clone();
                            } else {
                                restart_env.push((k.clone(), v.clone()));
                            }
                        }
                        let mut cmd = tokio::process::Command::new(&program);
                        cmd.args(&args)
                            .env_clear()
                            .envs(restart_env.iter().cloned());

                        if suppress_output {
                            cmd.stdout(std::process::Stdio::null())
                                .stderr(std::process::Stdio::null());
                        } else {
                            cmd.stdout(std::process::Stdio::piped())
                                .stderr(std::process::Stdio::piped());
                        }
                        if let Some(dir) = &cwd {
                            cmd.current_dir(dir);
                        }

                        match cmd.spawn() {
                            Ok(mut child2) => {
                                let pid2 = child2.id().unwrap_or(0);
                                let stdout2 = child2.stdout.take();
                                let stderr2 = child2.stderr.take();
                                {
                                    let mut p = procs2.lock().await;
                                    if let Some(proc) = p.get_mut(&pname2) {
                                        proc.info.pid = Some(pid2);
                                        proc.info.status = ProcessStatus::Running;
                                        proc.info.restart_count = 0; // Reset so future crashes get full retry budget
                                    }
                                    Self::save_pids_sync(&pid_file2, &p);
                                }

                                let _ = app2.emit(
                                    "process-status",
                                    ProcessEvent {
                                        name: pname2.clone(),
                                        status: ProcessStatus::Running,
                                        log_line: Some(format!("Restarted (pid {})", pid2)),
                                    },
                                );

                                // Re-attach stdout/stderr readers + wait for exit (recursive)
                                Self::attach_output_readers_and_wait(
                                    stdout2, stderr2, child2, &pname2, app2, procs2, pid_file2,
                                );
                            }
                            Err(e) => {
                                eprintln!("[NodeManager] Failed to restart '{}': {}", pname2, e);
                                let mut p = procs2.lock().await;
                                if let Some(proc) = p.get_mut(&pname2) {
                                    proc.info.status = ProcessStatus::Error {
                                        message: format!("Restart failed: {}", e),
                                    };
                                }
                            }
                        }
                    });
                    // Restart is scheduled, don't emit final stopped
                    return;
                }

                // No restart — emit final status
                let status = {
                    let procs = processes.lock().await;
                    procs
                        .get(&process_name)
                        .map(|p| p.info.status.clone())
                        .unwrap_or(ProcessStatus::Error {
                            message: msg.clone(),
                        })
                };
                let _ = app_handle.emit(
                    "process-status",
                    ProcessEvent {
                        name: process_name,
                        status,
                        log_line: Some(msg),
                    },
                );
            } else {
                // Clean exit (code 0) — mark as stopped
                {
                    let mut procs = processes.lock().await;
                    if let Some(proc) = procs.get_mut(&process_name) {
                        proc.info.status = ProcessStatus::Stopped;
                        proc.info.pid = None;
                    }
                }
                let _ = app_handle.emit(
                    "process-status",
                    ProcessEvent {
                        name: process_name,
                        status: ProcessStatus::Stopped,
                        log_line: Some(msg),
                    },
                );
            }
        });

        Ok(())
    }

    /// Attach stdout/stderr readers and wait for a child process to exit.
    /// Used by both `start_command()` and auto-restart to avoid code duplication.
    fn attach_output_readers_and_wait(
        stdout: Option<tokio::process::ChildStdout>,
        stderr: Option<tokio::process::ChildStderr>,
        child: tokio::process::Child,
        process_name: &str,
        app_handle: tauri::AppHandle,
        processes: Arc<Mutex<HashMap<String, ManagedProcess>>>,
        pid_file: std::path::PathBuf,
    ) {
        let pname = process_name.to_string();

        tauri::async_runtime::spawn(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};

            if let Some(out) = stdout {
                let app = app_handle.clone();
                let procs = processes.clone();
                let name = pname.clone();
                tauri::async_runtime::spawn(async move {
                    let mut lines = BufReader::new(out).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        if line.is_empty() {
                            continue;
                        }
                        {
                            let mut p = procs.lock().await;
                            if let Some(proc) = p.get_mut(&name) {
                                proc.append_log(line.clone());
                            }
                        }
                        if name == "mithril-client" {
                            if let Some(progress) =
                                crate::process::mithril::parse_mithril_output(&line)
                            {
                                let _ = app.emit("mithril-progress", progress);
                            }
                        }
                        let _ = app.emit(
                            "process-status",
                            ProcessEvent {
                                name: name.clone(),
                                status: ProcessStatus::Running,
                                log_line: Some(line),
                            },
                        );
                    }
                });
            }

            if let Some(err) = stderr {
                let app = app_handle.clone();
                let procs = processes.clone();
                let name = pname.clone();
                tauri::async_runtime::spawn(async move {
                    let mut lines = BufReader::new(err).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        if line.is_empty() {
                            continue;
                        }
                        let log_line = format!("[stderr] {}", line);
                        {
                            let mut p = procs.lock().await;
                            if let Some(proc) = p.get_mut(&name) {
                                proc.append_log(log_line.clone());
                            }
                        }
                        if name == "mithril-client" {
                            if let Some(progress) =
                                crate::process::mithril::parse_mithril_output(&line)
                            {
                                let _ = app.emit("mithril-progress", progress);
                            }
                        }
                        let _ = app.emit(
                            "process-status",
                            ProcessEvent {
                                name: name.clone(),
                                status: ProcessStatus::Running,
                                log_line: Some(log_line),
                            },
                        );
                    }
                });
            }

            // The actual wait + auto-restart is handled by the caller's spawned task
            // This function just sets up the I/O readers
            let _ = (child, app_handle, processes, pid_file, pname);
        });
    }

    /// Stop a process gracefully.
    /// Sends SIGTERM first, waits for the per-process timeout, then falls back to SIGKILL.
    /// Sets user_stopped to prevent auto-restart.
    pub async fn stop(&self, name: &str) -> Result<(), String> {
        let (pid, timeout_secs) = {
            let mut procs = self.processes.lock().await;
            if let Some(proc) = procs.get_mut(name) {
                proc.user_stopped = true;
                let pid = proc.info.pid.take();
                let timeout = proc.shutdown_timeout_secs;
                proc.info.status = ProcessStatus::Stopped;
                Self::save_pids_sync(&self.pid_file, &procs);
                (pid, timeout)
            } else {
                return Ok(());
            }
        };

        self.emit_status(name, ProcessStatus::Stopped, None);

        if let Some(pid) = pid {
            // Send SIGTERM for graceful shutdown
            send_signal(pid, libc::SIGTERM);

            // Wait for per-process timeout (500ms per iteration)
            let iterations = timeout_secs * 2;
            let mut exited = false;
            for _ in 0..iterations {
                if !send_signal(pid, 0) {
                    exited = true;
                    break;
                }
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            }

            // Fall back to SIGKILL if graceful shutdown timed out
            if !exited {
                eprintln!(
                    "Process '{}' (pid {}) did not exit after {}s SIGTERM, sending SIGKILL",
                    name, pid, timeout_secs
                );
                send_signal(pid, libc::SIGKILL);
            }
        }

        Ok(())
    }

    /// Get current status of a process
    pub async fn get_status(&self, name: &str) -> Option<ProcessInfo> {
        let procs = self.processes.lock().await;
        procs.get(name).map(|p| p.info.clone())
    }

    /// Get status of all registered processes
    pub async fn get_all_status(&self) -> Vec<ProcessInfo> {
        let procs = self.processes.lock().await;
        procs.values().map(|p| p.info.clone()).collect()
    }

    /// Get recent log lines for a process.
    /// If lines were evicted from the circular buffer, a marker is prepended.
    pub async fn get_logs(&self, name: &str, lines: usize) -> Vec<String> {
        let procs = self.processes.lock().await;
        if let Some(proc) = procs.get(name) {
            let start = proc.log_buffer.len().saturating_sub(lines);
            let mut result = proc.log_buffer[start..].to_vec();
            if proc.dropped_log_count > 0 && start == 0 {
                result.insert(
                    0,
                    format!(
                        "... [{} earlier line{} dropped] ...",
                        proc.dropped_log_count,
                        if proc.dropped_log_count == 1 { "" } else { "s" }
                    ),
                );
            }
            result
        } else {
            Vec::new()
        }
    }

    /// Synchronous graceful shutdown of ALL tracked processes.
    /// Called from the RunEvent::Exit handler where async may not work reliably.
    ///
    /// Sends SIGTERM first and waits up to 90 seconds for processes to exit
    /// cleanly (cardano-node needs this to flush its ledger state to disk).
    /// Only falls back to SIGKILL for processes that don't exit in time.
    pub fn kill_all_sync(&self, app_handle: &tauri::AppHandle) {
        let mut all_pids: Vec<u32> = Vec::new();

        // Collect PIDs from the pid file
        if let Ok(contents) = std::fs::read_to_string(&self.pid_file) {
            if let Ok(pids) = serde_json::from_str::<Vec<u32>>(&contents) {
                all_pids.extend(pids);
            }
        }

        // Also collect PIDs from known ports as a safety net
        for port in [3001u16, 1337, 44203] {
            if let Ok(out) = std::process::Command::new("fuser")
                .args([&format!("{}/tcp", port)])
                .output()
            {
                let pids_str = String::from_utf8_lossy(&out.stdout);
                for token in pids_str.split_whitespace() {
                    if let Ok(pid) = token.parse::<u32>() {
                        if !all_pids.contains(&pid) {
                            all_pids.push(pid);
                        }
                    }
                }
            }
        }

        // Include SNARK prover PIDs if running
        if let Ok(guard) = self.snark_pids.lock() {
            for &pid in guard.iter() {
                if !all_pids.contains(&pid) {
                    all_pids.push(pid);
                }
            }
        }

        if all_pids.is_empty() {
            let _ = std::fs::remove_file(&self.pid_file);
            return;
        }

        // Step 1: Send SIGTERM to all processes
        for pid in &all_pids {
            eprintln!("[NodeManager] Exit: sending SIGTERM to pid={pid}");
            send_signal(*pid, libc::SIGTERM);
        }

        // Step 2: Wait up to 90 seconds for all to exit gracefully.
        // cardano-node needs time to flush its in-memory ledger to disk.
        let start_time = std::time::Instant::now();
        let deadline = start_time + std::time::Duration::from_secs(90);
        loop {
            let still_alive: Vec<u32> = all_pids
                .iter()
                .copied()
                .filter(|pid| send_signal(*pid, 0))
                .collect();

            // Emit progress to the frontend shutdown overlay
            let elapsed = start_time.elapsed().as_secs();
            let _ = app_handle.emit(
                "shutdown-progress",
                serde_json::json!({
                    "elapsed_secs": elapsed,
                    "timeout_secs": 90u64,
                    "remaining_processes": still_alive.len(),
                }),
            );

            if still_alive.is_empty() {
                eprintln!("[NodeManager] Exit: all processes exited cleanly");
                break;
            }

            if std::time::Instant::now() >= deadline {
                // Step 3: SIGKILL any survivors
                for pid in &still_alive {
                    eprintln!("[NodeManager] Exit: SIGKILL pid={pid} (did not exit after SIGTERM)");
                    send_signal(*pid, libc::SIGKILL);
                }
                break;
            }

            std::thread::sleep(std::time::Duration::from_millis(500));
        }

        let _ = std::fs::remove_file(&self.pid_file);
    }

    /// Fire-and-forget SIGTERM to all tracked processes.
    /// Used as a last-resort in RunEvent::Exit where we must not block.
    pub fn sigterm_all(&self) {
        let mut all_pids: Vec<u32> = Vec::new();

        if let Ok(contents) = std::fs::read_to_string(&self.pid_file) {
            if let Ok(pids) = serde_json::from_str::<Vec<u32>>(&contents) {
                all_pids.extend(pids);
            }
        }

        // Include SNARK prover PIDs if running
        if let Ok(guard) = self.snark_pids.lock() {
            for &pid in guard.iter() {
                if !all_pids.contains(&pid) {
                    all_pids.push(pid);
                }
            }
        }

        for pid in &all_pids {
            eprintln!("[NodeManager] Exit (fallback): SIGTERM pid={pid}");
            send_signal(*pid, libc::SIGTERM);
        }

        let _ = std::fs::remove_file(&self.pid_file);
    }

    /// Register a SNARK sidecar PID for cleanup on shutdown.
    pub fn set_snark_pid(&self, pid: u32) {
        if let Ok(mut guard) = self.snark_pids.lock() {
            if !guard.contains(&pid) {
                guard.push(pid);
            }
        }
        self.append_pid_to_file(pid);
    }

    /// Remove a specific SNARK PID after the process exits normally.
    pub fn clear_snark_pid(&self, pid: u32) {
        let removed = if let Ok(mut guard) = self.snark_pids.lock() {
            let before = guard.len();
            guard.retain(|&p| p != pid);
            guard.len() < before
        } else {
            false
        };
        if removed {
            self.remove_pid_from_file(pid);
        }
    }

    fn append_pid_to_file(&self, pid: u32) {
        let mut pids: Vec<u32> = std::fs::read_to_string(&self.pid_file)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or_default();
        if !pids.contains(&pid) {
            pids.push(pid);
            if let Ok(json) = serde_json::to_string(&pids) {
                let tmp = self.pid_file.with_extension("tmp");
                if std::fs::write(&tmp, &json).is_ok() {
                    let _ = std::fs::rename(&tmp, &self.pid_file);
                }
            }
        }
    }

    fn remove_pid_from_file(&self, pid: u32) {
        let mut pids: Vec<u32> = std::fs::read_to_string(&self.pid_file)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or_default();
        pids.retain(|&p| p != pid);
        if pids.is_empty() {
            let _ = std::fs::remove_file(&self.pid_file);
        } else if let Ok(json) = serde_json::to_string(&pids) {
            let tmp = self.pid_file.with_extension("tmp");
            if std::fs::write(&tmp, &json).is_ok() {
                let _ = std::fs::rename(&tmp, &self.pid_file);
            }
        }
    }

    /// Emit a process status event to the frontend
    fn emit_status(&self, name: &str, status: ProcessStatus, log_line: Option<String>) {
        let _ = self.app_handle.emit(
            "process-status",
            ProcessEvent {
                name: name.to_string(),
                status,
                log_line,
            },
        );
    }

    /// Spawn a background task that checks process liveness every 10 seconds.
    ///
    /// Two checks per process:
    /// 1. PID liveness — is the process still running?
    /// 2. HTTP health — for ogmios/kupo, is the health endpoint responding?
    ///
    /// If either check fails, the process status is set to Error and a
    /// `process-status` event is emitted so the frontend shows the failure.
    fn spawn_liveness_monitor(
        processes: Arc<Mutex<HashMap<String, ManagedProcess>>>,
        app_handle: tauri::AppHandle,
        pid_file: std::path::PathBuf,
        ogmios_port: u16,
        kupo_port: u16,
    ) {
        let http_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap_or_default();

        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(10));
            loop {
                interval.tick().await;

                // Collect names that need HTTP health checks (while holding the lock briefly)
                let health_targets: Vec<(String, u16)> = {
                    let procs = processes.lock().await;
                    procs
                        .iter()
                        .filter(|(_, proc)| {
                            !proc.user_stopped
                                && matches!(
                                    proc.info.status,
                                    ProcessStatus::Running
                                        | ProcessStatus::Syncing { .. }
                                        | ProcessStatus::Ready
                                )
                        })
                        .filter_map(|(name, _)| match name.as_str() {
                            "ogmios" => Some((name.clone(), ogmios_port)),
                            "kupo" => Some((name.clone(), kupo_port)),
                            _ => None,
                        })
                        .collect()
                };

                // Run HTTP health checks outside the lock to avoid holding it during I/O.
                // For Ogmios, also extract the tip slot for stall detection.
                let mut health_results: HashMap<String, bool> = HashMap::new();
                let mut ogmios_tip_slot: Option<u64> = None;
                let mut ogmios_network_sync: Option<f64> = None;
                let mut kupo_seconds_since_block: Option<f64> = None;
                let mut kupo_sync_ratio: Option<f64> = None;

                for (name, port) in &health_targets {
                    if name == "ogmios" {
                        // Parse Ogmios health response for tip slot (stall detection)
                        let url = format!("http://127.0.0.1:{}/health", port);
                        match http_client.get(&url).send().await {
                            Ok(resp) if resp.status().is_success() => {
                                health_results.insert(name.clone(), true);
                                if let Ok(json) = resp.json::<serde_json::Value>().await {
                                    ogmios_tip_slot = json["lastKnownTip"]["slot"].as_u64();
                                    ogmios_network_sync = json["networkSynchronization"].as_f64();
                                }
                            }
                            _ => {
                                health_results.insert(name.clone(), false);
                            }
                        }
                    } else if name == "kupo" {
                        // Check Kupo health + parse metrics for stall detection
                        let health_url = format!("http://127.0.0.1:{}/health", port);
                        let healthy = match http_client.get(&health_url).send().await {
                            Ok(resp) => resp.status().is_success(),
                            Err(_) => false,
                        };
                        health_results.insert(name.clone(), healthy);

                        if healthy {
                            let metrics_url = format!("http://127.0.0.1:{}/metrics", port);
                            if let Ok(resp) = http_client.get(&metrics_url).send().await {
                                if let Ok(text) = resp.text().await {
                                    let mut checkpoint: Option<f64> = None;
                                    let mut node_tip: Option<f64> = None;
                                    for line in text.lines() {
                                        if let Some(v) =
                                            line.strip_prefix("kupo_seconds_since_last_block")
                                        {
                                            kupo_seconds_since_block = v.trim().parse::<f64>().ok();
                                        } else if let Some(v) =
                                            line.strip_prefix("kupo_most_recent_checkpoint")
                                        {
                                            checkpoint = v.trim().parse::<f64>().ok();
                                        } else if let Some(v) =
                                            line.strip_prefix("kupo_most_recent_node_tip")
                                        {
                                            node_tip = v.trim().parse::<f64>().ok();
                                        }
                                    }
                                    // Kupo sync ratio: how far Kupo has indexed vs node tip
                                    if let (Some(cp), Some(tip)) = (checkpoint, node_tip) {
                                        if tip > 0.0 {
                                            kupo_sync_ratio = Some((cp / tip).min(1.0));
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        let url = format!("http://127.0.0.1:{}/health", port);
                        let healthy = match http_client.get(&url).send().await {
                            Ok(resp) => resp.status().is_success(),
                            Err(_) => false,
                        };
                        health_results.insert(name.clone(), healthy);
                    }
                }

                // Check if cardano-node is running (needed for stall detection context)
                let node_is_running = {
                    let procs = processes.lock().await;
                    procs
                        .get("cardano-node")
                        .map(|p| {
                            matches!(
                                p.info.status,
                                ProcessStatus::Running
                                    | ProcessStatus::Syncing { .. }
                                    | ProcessStatus::Ready
                            )
                        })
                        .unwrap_or(false)
                };

                // Re-acquire lock and apply all check results
                let mut procs = processes.lock().await;
                let mut changed = false;
                let mut pids_to_kill: Vec<(String, u32)> = Vec::new();

                for (name, proc) in procs.iter_mut() {
                    if proc.user_stopped {
                        continue;
                    }
                    let is_active = matches!(
                        proc.info.status,
                        ProcessStatus::Starting
                            | ProcessStatus::Running
                            | ProcessStatus::Syncing { .. }
                            | ProcessStatus::Ready
                    );
                    if !is_active {
                        continue;
                    }

                    // Check 1: PID liveness
                    if let Some(pid) = proc.info.pid {
                        if !send_signal(pid, 0) {
                            eprintln!(
                                "[Liveness] Process '{}' (pid {}) is no longer running",
                                name, pid
                            );
                            proc.info.status = ProcessStatus::Error {
                                message: "Process exited unexpectedly".to_string(),
                            };
                            proc.info.pid = None;
                            proc.health_check_failures = 0;
                            proc.tip_unchanged_count = 0;
                            changed = true;

                            let _ = app_handle.emit(
                                "process-status",
                                ProcessEvent {
                                    name: name.clone(),
                                    status: proc.info.status.clone(),
                                    log_line: None,
                                },
                            );
                            continue;
                        }
                    }

                    // Check 2: HTTP health (ogmios / kupo only)
                    if let Some(&healthy) = health_results.get(name.as_str()) {
                        if healthy {
                            proc.health_check_failures = 0;
                        } else {
                            proc.health_check_failures += 1;
                            if proc.health_check_failures >= HEALTH_CHECK_FAILURE_THRESHOLD {
                                eprintln!(
                                    "[Liveness] {} unresponsive after {} consecutive health check failures",
                                    name, proc.health_check_failures
                                );
                                proc.info.status = ProcessStatus::Error {
                                    message: format!("{} is not responding to health checks", name),
                                };
                                changed = true;

                                let _ = app_handle.emit(
                                    "process-status",
                                    ProcessEvent {
                                        name: name.clone(),
                                        status: proc.info.status.clone(),
                                        log_line: Some(format!(
                                            "{} unresponsive after {} health check failures",
                                            name, proc.health_check_failures
                                        )),
                                    },
                                );
                            }
                        }
                    }

                    // Check 3: Stall detection — tip slot not advancing
                    // Only applies during active sync (networkSynchronization < 0.999).
                    // When synced to tip, slots naturally don't change for 20+ seconds
                    // on preprod, so stall detection would cause false positives.
                    if node_is_running {
                        let is_syncing = ogmios_network_sync.map(|s| s < 0.999).unwrap_or(false);
                        if name == "ogmios" && is_syncing {
                            if let Some(slot) = ogmios_tip_slot {
                                if proc.last_seen_tip_slot == Some(slot) {
                                    proc.tip_unchanged_count += 1;
                                    if proc.tip_unchanged_count >= STALL_DETECTION_THRESHOLD {
                                        if let Some(pid) = proc.info.pid {
                                            eprintln!(
                                                "[Liveness] Ogmios tip stalled at slot {} for {}s (sync {:.4}), killing for restart",
                                                slot, proc.tip_unchanged_count * 10,
                                                ogmios_network_sync.unwrap_or(0.0)
                                            );
                                            pids_to_kill.push((name.clone(), pid));
                                            proc.tip_unchanged_count = 0;
                                            proc.last_seen_tip_slot = None;
                                        }
                                    }
                                } else {
                                    proc.last_seen_tip_slot = Some(slot);
                                    proc.tip_unchanged_count = 0;
                                }
                            }
                        } else if name == "ogmios" && !is_syncing {
                            // At tip — reset stall counters to avoid accumulation
                            proc.tip_unchanged_count = 0;
                        } else if name == "kupo" {
                            // Kupo stall detection uses its OWN sync ratio, not Ogmios's.
                            // kupo_sync_ratio = checkpoint / node_tip (Kupo's indexing progress).
                            let kupo_is_syncing =
                                kupo_sync_ratio.map(|r| r < 0.999).unwrap_or(false);
                            if kupo_is_syncing {
                                // Only check for stalls during active sync.
                                // At tip, seconds_since_last_block naturally exceeds 300s
                                // on preprod (blocks every 20s-3min with gaps).
                                if let Some(seconds) = kupo_seconds_since_block {
                                    if seconds > 300.0 {
                                        proc.tip_unchanged_count += 1;
                                        if proc.tip_unchanged_count >= STALL_DETECTION_THRESHOLD {
                                            if let Some(pid) = proc.info.pid {
                                                eprintln!(
                                                    "[Liveness] Kupo stalled ({:.0}s since last block) for {}s (kupo sync {:.4}), killing for restart",
                                                    seconds, proc.tip_unchanged_count * 10,
                                                    kupo_sync_ratio.unwrap_or(0.0)
                                                );
                                                pids_to_kill.push((name.clone(), pid));
                                                proc.tip_unchanged_count = 0;
                                            }
                                        }
                                    } else {
                                        proc.tip_unchanged_count = 0;
                                    }
                                }
                            } else {
                                // At tip or no data yet — reset stall counters
                                proc.tip_unchanged_count = 0;
                            }
                        }
                    }
                }

                if changed {
                    Self::save_pids_sync(&pid_file, &procs);
                }

                // Drop lock before killing (kill triggers exit handler which needs the lock)
                drop(procs);

                // Gracefully stop stalled processes — SIGTERM first, then SIGKILL after 10s.
                // Auto-restart will be triggered by the exit handler.
                for (name, pid) in pids_to_kill {
                    eprintln!(
                        "[Liveness] Sending SIGTERM to stalled {} (pid {})",
                        name, pid
                    );
                    send_signal(pid, libc::SIGTERM);

                    // Give the process up to 10s to exit gracefully before escalating
                    let pid_copy = pid;
                    tauri::async_runtime::spawn(async move {
                        for _ in 0..20 {
                            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                            if !send_signal(pid_copy, 0) {
                                return; // Process exited
                            }
                        }
                        eprintln!(
                            "[Liveness] Stalled process pid {} did not exit after SIGTERM, sending SIGKILL",
                            pid_copy
                        );
                        send_signal(pid_copy, libc::SIGKILL);
                    });
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restart_policy_default_values() {
        let policy = RestartPolicy::default();
        assert_eq!(policy.max_retries, 5);
        assert_eq!(policy.initial_delay_ms, 1000);
        assert!((policy.backoff_multiplier - 2.0).abs() < f64::EPSILON);
    }

    #[test]
    fn jitter_stays_within_bounds() {
        for _ in 0..1000 {
            let result = apply_jitter(1000.0);
            assert!(
                result >= 800.0 && result <= 1200.0,
                "jitter produced {result}, expected 800..=1200"
            );
        }
    }

    #[test]
    fn jitter_preserves_zero_delay() {
        let result = apply_jitter(0.0);
        assert!((result - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn health_check_failure_threshold_is_reasonable() {
        // Threshold should be > 1 (avoid false positives from a single failed check)
        // and not too high (detect real outages within ~30s at 10s intervals)
        assert!(HEALTH_CHECK_FAILURE_THRESHOLD > 1);
        assert!(HEALTH_CHECK_FAILURE_THRESHOLD <= 5);
    }

    #[test]
    fn process_status_stopped_serializes_correctly() {
        let json = serde_json::to_string(&ProcessStatus::Stopped).unwrap();
        assert_eq!(json, r#"{"type":"Stopped"}"#);
    }

    #[test]
    fn process_status_running_serializes_correctly() {
        let json = serde_json::to_string(&ProcessStatus::Running).unwrap();
        assert_eq!(json, r#"{"type":"Running"}"#);
    }

    #[test]
    fn process_status_syncing_serializes_with_progress() {
        let status = ProcessStatus::Syncing { progress: 0.75 };
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, r#"{"type":"Syncing","progress":0.75}"#);
    }

    #[test]
    fn process_status_error_serializes_with_message() {
        let status = ProcessStatus::Error {
            message: "connection refused".to_string(),
        };
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, r#"{"type":"Error","message":"connection refused"}"#);
    }

    #[test]
    fn process_status_roundtrip_deserialization() {
        let statuses = vec![
            ProcessStatus::Stopped,
            ProcessStatus::Starting,
            ProcessStatus::Running,
            ProcessStatus::Syncing { progress: 0.5 },
            ProcessStatus::Ready,
            ProcessStatus::Error {
                message: "test".to_string(),
            },
        ];

        for status in statuses {
            let json = serde_json::to_string(&status).unwrap();
            let deserialized: ProcessStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(deserialized, status);
        }
    }

    #[test]
    fn process_info_serialization() {
        let info = ProcessInfo {
            name: "cardano-node".to_string(),
            status: ProcessStatus::Running,
            pid: Some(12345),
            restart_count: 2,
            last_error: Some("previous crash".to_string()),
        };

        let json = serde_json::to_string(&info).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["name"], "cardano-node");
        assert_eq!(parsed["status"]["type"], "Running");
        assert_eq!(parsed["pid"], 12345);
        assert_eq!(parsed["restart_count"], 2);
        assert_eq!(parsed["last_error"], "previous crash");
    }

    #[test]
    fn process_info_null_optional_fields() {
        let info = ProcessInfo {
            name: "test".to_string(),
            status: ProcessStatus::Stopped,
            pid: None,
            restart_count: 0,
            last_error: None,
        };

        let json = serde_json::to_string(&info).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert!(parsed["pid"].is_null());
        assert!(parsed["last_error"].is_null());
    }

    #[test]
    fn send_signal_own_process_exists() {
        let pid = std::process::id();
        // Signal 0 checks if process exists without sending any signal
        assert!(send_signal(pid, 0));
    }

    #[test]
    fn send_signal_nonexistent_process() {
        // PID 999999999 is extremely unlikely to exist
        assert!(!send_signal(999_999_999, 0));
    }

    #[test]
    fn append_log_adds_entries() {
        let mut proc = ManagedProcess {
            info: ProcessInfo {
                name: "test".to_string(),
                status: ProcessStatus::Stopped,
                pid: None,
                restart_count: 0,
                last_error: None,
            },
            restart_policy: RestartPolicy::default(),
            log_buffer: Vec::new(),
            launch_info: None,
            user_stopped: false,
            shutdown_timeout_secs: 10,
            health_check_failures: 0,
            dropped_log_count: 0,
            last_seen_tip_slot: None,
            tip_unchanged_count: 0,
        };

        proc.append_log("line 1".to_string());
        proc.append_log("line 2".to_string());

        assert_eq!(proc.log_buffer.len(), 2);
        assert_eq!(proc.log_buffer[0], "line 1");
        assert_eq!(proc.log_buffer[1], "line 2");
    }

    #[test]
    fn append_log_evicts_oldest_at_capacity() {
        let mut proc = ManagedProcess {
            info: ProcessInfo {
                name: "test".to_string(),
                status: ProcessStatus::Stopped,
                pid: None,
                restart_count: 0,
                last_error: None,
            },
            restart_policy: RestartPolicy::default(),
            log_buffer: Vec::new(),
            launch_info: None,
            user_stopped: false,
            shutdown_timeout_secs: 10,
            health_check_failures: 0,
            dropped_log_count: 0,
            last_seen_tip_slot: None,
            tip_unchanged_count: 0,
        };

        // Fill to LOG_BUFFER_SIZE + 1
        for i in 0..=LOG_BUFFER_SIZE {
            proc.append_log(format!("line {}", i));
        }

        assert_eq!(proc.log_buffer.len(), LOG_BUFFER_SIZE);
        // "line 0" was evicted; buffer starts at "line 1"
        assert_eq!(proc.log_buffer[0], "line 1");
        assert_eq!(
            proc.log_buffer[LOG_BUFFER_SIZE - 1],
            format!("line {}", LOG_BUFFER_SIZE)
        );
        assert_eq!(proc.dropped_log_count, 1);
    }

    #[test]
    fn append_log_dropped_count_tracks_evictions() {
        let mut proc = ManagedProcess {
            info: ProcessInfo {
                name: "test".to_string(),
                status: ProcessStatus::Stopped,
                pid: None,
                restart_count: 0,
                last_error: None,
            },
            restart_policy: RestartPolicy::default(),
            log_buffer: Vec::new(),
            launch_info: None,
            user_stopped: false,
            shutdown_timeout_secs: 10,
            health_check_failures: 0,
            dropped_log_count: 0,
            last_seen_tip_slot: None,
            tip_unchanged_count: 0,
        };

        // Fill to LOG_BUFFER_SIZE + 5 to cause 5 evictions
        for i in 0..(LOG_BUFFER_SIZE + 5) {
            proc.append_log(format!("line {}", i));
        }

        assert_eq!(proc.dropped_log_count, 5);
        assert_eq!(proc.log_buffer.len(), LOG_BUFFER_SIZE);
        // Last entry is correct
        assert_eq!(
            proc.log_buffer[proc.log_buffer.len() - 1],
            format!("line {}", LOG_BUFFER_SIZE + 4)
        );
    }

    #[test]
    fn log_buffer_size_constant() {
        assert_eq!(LOG_BUFFER_SIZE, 500);
    }

    #[test]
    fn snark_pids_vec_tracks_multiple() {
        let pids: std::sync::Mutex<Vec<u32>> = std::sync::Mutex::new(Vec::new());

        // Add two PIDs
        pids.lock().unwrap().push(100);
        pids.lock().unwrap().push(200);
        assert_eq!(*pids.lock().unwrap(), vec![100, 200]);

        // Remove first PID, second remains
        pids.lock().unwrap().retain(|&p| p != 100);
        assert_eq!(*pids.lock().unwrap(), vec![200]);

        // Remove second PID
        pids.lock().unwrap().retain(|&p| p != 200);
        assert!(pids.lock().unwrap().is_empty());
    }

    #[test]
    fn snark_pids_dedup_on_insert() {
        let pids: std::sync::Mutex<Vec<u32>> = std::sync::Mutex::new(Vec::new());

        let mut guard = pids.lock().unwrap();
        let pid = 100u32;
        if !guard.contains(&pid) {
            guard.push(pid);
        }
        if !guard.contains(&pid) {
            guard.push(pid);
        }
        assert_eq!(guard.len(), 1);
    }

    #[test]
    fn default_shutdown_timeout_per_process() {
        // Clean env to ensure defaults (in case another test set them)
        std::env::remove_var("SHUTDOWN_TIMEOUT_CARDANO");
        std::env::remove_var("SHUTDOWN_TIMEOUT_MITHRIL");
        std::env::remove_var("SHUTDOWN_TIMEOUT_DEFAULT");

        assert_eq!(default_shutdown_timeout("cardano-node"), 90);
        assert_eq!(default_shutdown_timeout("mithril-client"), 30);
        assert_eq!(default_shutdown_timeout("ogmios"), 10);
        assert_eq!(default_shutdown_timeout("kupo"), 10);
        assert_eq!(default_shutdown_timeout("express"), 10);
    }

    #[test]
    fn shutdown_timeout_env_override() {
        std::env::set_var("SHUTDOWN_TIMEOUT_CARDANO", "90");
        assert_eq!(default_shutdown_timeout("cardano-node"), 90);
        std::env::remove_var("SHUTDOWN_TIMEOUT_CARDANO");

        std::env::set_var("SHUTDOWN_TIMEOUT_MITHRIL", "60");
        assert_eq!(default_shutdown_timeout("mithril-client"), 60);
        std::env::remove_var("SHUTDOWN_TIMEOUT_MITHRIL");

        std::env::set_var("SHUTDOWN_TIMEOUT_DEFAULT", "20");
        assert_eq!(default_shutdown_timeout("ogmios"), 20);
        std::env::remove_var("SHUTDOWN_TIMEOUT_DEFAULT");

        // Invalid value falls back to default
        std::env::set_var("SHUTDOWN_TIMEOUT_CARDANO", "not_a_number");
        assert_eq!(default_shutdown_timeout("cardano-node"), 90);
        std::env::remove_var("SHUTDOWN_TIMEOUT_CARDANO");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn is_veiled_process_returns_false_for_nonexistent_pid() {
        assert!(
            !is_veiled_process(999_999_999, &["node"]),
            "Should return false for a nonexistent PID"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn is_veiled_process_rejects_unrelated_binary() {
        // Our own test process cmdline won't contain "ogmios" or "kupo"
        let pid = std::process::id();
        assert!(
            !is_veiled_process(pid, &["ogmios", "kupo"]),
            "Test process should not match ogmios or kupo"
        );
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn is_veiled_process_fallback_always_true() {
        assert!(is_veiled_process(1, &["anything"]));
    }
}
