use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
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
    Sidecar {
        sidecar_name: String,
        args: Vec<String>,
    },
    Command {
        _program: String,
        _args: Vec<String>,
        _cwd: Option<std::path::PathBuf>,
        _env_vars: Vec<(String, String)>,
    },
}

/// Per-process graceful shutdown timeout.
/// cardano-node needs extra time to flush its in-memory ledger to disk.
fn default_shutdown_timeout(name: &str) -> u64 {
    match name {
        "cardano-node" => 45,
        "mithril-client" => 30,
        _ => 10, // express, ogmios, kupo
    }
}

/// A single managed child process with its metadata
struct ManagedProcess {
    child: Option<CommandChild>,
    info: ProcessInfo,
    restart_policy: RestartPolicy,
    log_buffer: Vec<String>,
    /// How this process was started (stored for auto-restart)
    launch_info: Option<LaunchInfo>,
    /// Set to true by stop() to prevent auto-restart after intentional shutdown
    user_stopped: bool,
    /// Maximum seconds to wait for graceful shutdown before SIGKILL
    shutdown_timeout_secs: u64,
}

impl ManagedProcess {
    /// Append a log line to the buffer, evicting the oldest entry if full.
    fn append_log(&mut self, line: String) {
        self.log_buffer.push(line);
        if self.log_buffer.len() > LOG_BUFFER_SIZE {
            self.log_buffer.remove(0);
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
    unsafe { libc::kill(pid as i32, signal) == 0 }
}

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

impl NodeManager {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
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

        // Start background liveness monitor
        Self::spawn_liveness_monitor(
            mgr.processes.clone(),
            mgr.app_handle.clone(),
            mgr.pid_file.clone(),
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

    /// Kill any processes listening on our known ports (Express:3001, Ogmios:1337, Kupo:1442).
    /// Catches orphans even when no PID file exists (e.g., first run after adding PID tracking).
    fn kill_orphans_on_ports(&self) {
        let mut orphan_pids: Vec<u32> = Vec::new();

        for port in [3001u16, 1337, 1442] {
            let output = std::process::Command::new("fuser")
                .args([&format!("{}/tcp", port)])
                .output();

            if let Ok(out) = output {
                let pids_str = String::from_utf8_lossy(&out.stdout);
                for token in pids_str.split_whitespace() {
                    if let Ok(pid) = token.parse::<u32>() {
                        if !orphan_pids.contains(&pid) {
                            orphan_pids.push(pid);
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

    /// Start a process by spawning the sidecar binary.
    /// If the process is already running, stops it gracefully first.
    pub async fn start(
        &self,
        name: &str,
        sidecar_name: &str,
        args: Vec<String>,
    ) -> Result<(), String> {
        // Stop existing process gracefully if running
        self.stop(name).await?;

        // Set status to Starting, store launch info, clear user_stopped
        {
            let mut procs = self.processes.lock().await;
            if let Some(proc) = procs.get_mut(name) {
                proc.info.status = ProcessStatus::Starting;
                proc.log_buffer.clear();
                proc.user_stopped = false;
                proc.launch_info = Some(LaunchInfo::Sidecar {
                    sidecar_name: sidecar_name.to_string(),
                    args: args.clone(),
                });
            } else {
                // Auto-register if not already registered
                procs.insert(
                    name.to_string(),
                    ManagedProcess {
                        child: None,
                        info: ProcessInfo {
                            name: name.to_string(),
                            status: ProcessStatus::Starting,
                            pid: None,
                            restart_count: 0,
                            last_error: None,
                        },
                        restart_policy: RestartPolicy::default(),
                        log_buffer: Vec::new(),
                        launch_info: Some(LaunchInfo::Sidecar {
                            sidecar_name: sidecar_name.to_string(),
                            args: args.clone(),
                        }),
                        user_stopped: false,
                        shutdown_timeout_secs: default_shutdown_timeout(name),
                    },
                );
            }
        }

        self.emit_status(name, ProcessStatus::Starting, None);

        // Spawn the sidecar
        let shell = self.app_handle.shell();
        let command = shell.sidecar(sidecar_name).map_err(|e| {
            let msg = format!("Failed to create sidecar command '{}': {}", sidecar_name, e);
            self.emit_status(
                name,
                ProcessStatus::Error {
                    message: msg.clone(),
                },
                None,
            );
            msg
        })?;

        let command = command.args(args);

        let (mut rx, child) = command.spawn().map_err(|e| {
            let msg = format!("Failed to spawn '{}': {}", sidecar_name, e);
            self.emit_status(
                name,
                ProcessStatus::Error {
                    message: msg.clone(),
                },
                None,
            );
            msg
        })?;

        let pid = child.pid();

        // Store the child handle
        {
            let mut procs = self.processes.lock().await;
            if let Some(proc) = procs.get_mut(name) {
                proc.child = Some(child);
                proc.info.pid = Some(pid);
                proc.info.status = ProcessStatus::Running;
                proc.info.last_error = None;
            }
            Self::save_pids_sync(&self.pid_file, &procs);
        }

        self.emit_status(name, ProcessStatus::Running, None);

        // Spawn a background task to read stdout/stderr
        let app_handle = self.app_handle.clone();
        let process_name = name.to_string();
        let processes = self.processes.clone();

        tauri::async_runtime::spawn(async move {
            use tauri_plugin_shell::process::CommandEvent;

            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(data) => {
                        let line = String::from_utf8_lossy(&data).trim().to_string();
                        if line.is_empty() {
                            continue;
                        }

                        // Append to log buffer
                        {
                            let mut procs = processes.lock().await;
                            if let Some(proc) = procs.get_mut(&process_name) {
                                proc.append_log(line.clone());
                            }
                        }

                        // Emit structured mithril-progress events for the download UI
                        if process_name == "mithril-client" {
                            if let Some(progress) =
                                crate::process::mithril::parse_mithril_output(&line)
                            {
                                let _ = app_handle.emit("mithril-progress", progress);
                            }
                        }

                        let _ = app_handle.emit(
                            "process-status",
                            ProcessEvent {
                                name: process_name.clone(),
                                status: ProcessStatus::Running,
                                log_line: Some(line),
                            },
                        );
                    }
                    CommandEvent::Stderr(data) => {
                        let line = String::from_utf8_lossy(&data).trim().to_string();
                        if line.is_empty() {
                            continue;
                        }

                        // Append to log buffer
                        {
                            let mut procs = processes.lock().await;
                            if let Some(proc) = procs.get_mut(&process_name) {
                                proc.append_log(format!("[stderr] {}", line));
                            }
                        }

                        let _ = app_handle.emit(
                            "process-status",
                            ProcessEvent {
                                name: process_name.clone(),
                                status: ProcessStatus::Running,
                                log_line: Some(format!("[stderr] {}", line)),
                            },
                        );
                    }
                    CommandEvent::Error(err) => {
                        let msg = format!("Process error: {}", err);
                        {
                            let mut procs = processes.lock().await;
                            if let Some(proc) = procs.get_mut(&process_name) {
                                proc.info.status = ProcessStatus::Error {
                                    message: msg.clone(),
                                };
                                proc.info.last_error = Some(msg.clone());
                                proc.child = None;
                            }
                        }

                        let _ = app_handle.emit(
                            "process-status",
                            ProcessEvent {
                                name: process_name.clone(),
                                status: ProcessStatus::Error { message: msg },
                                log_line: None,
                            },
                        );
                        break;
                    }
                    CommandEvent::Terminated(payload) => {
                        let msg = format!(
                            "Process exited with code {:?}, signal {:?}",
                            payload.code, payload.signal
                        );
                        let is_crash = payload.code != Some(0);

                        // Check if auto-restart is appropriate
                        let should_restart = if is_crash {
                            let mut procs = processes.lock().await;
                            if let Some(proc) = procs.get_mut(&process_name) {
                                proc.child = None;
                                proc.info.pid = None;
                                proc.info.last_error = Some(msg.clone());

                                if proc.user_stopped {
                                    // User intentionally stopped — do not restart
                                    proc.info.status = ProcessStatus::Stopped;
                                    false
                                } else if proc.info.restart_count < proc.restart_policy.max_retries
                                {
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
                                    // Return delay for restart
                                    let launch = proc.launch_info.clone();
                                    drop(procs);

                                    // Schedule restart after delay
                                    if let Some(LaunchInfo::Sidecar { sidecar_name, args }) = launch
                                    {
                                        let app2 = app_handle.clone();
                                        let procs2 = processes.clone();
                                        let pname2 = process_name.clone();
                                        tauri::async_runtime::spawn(async move {
                                            tokio::time::sleep(tokio::time::Duration::from_millis(
                                                delay as u64,
                                            ))
                                            .await;

                                            // Re-check that user hasn't stopped it during the delay
                                            let still_should = {
                                                let p = procs2.lock().await;
                                                p.get(&pname2)
                                                    .map(|pr| !pr.user_stopped)
                                                    .unwrap_or(false)
                                            };
                                            if !still_should {
                                                return;
                                            }

                                            let _ = app2.emit(
                                                "process-status",
                                                ProcessEvent {
                                                    name: pname2.clone(),
                                                    status: ProcessStatus::Starting,
                                                    log_line: Some(
                                                        "Auto-restarting...".to_string(),
                                                    ),
                                                },
                                            );

                                            let shell = app2.shell();
                                            if let Ok(cmd) = shell.sidecar(&sidecar_name) {
                                                if let Ok((mut rx2, child2)) =
                                                    cmd.args(&args).spawn()
                                                {
                                                    let pid2 = child2.pid();
                                                    {
                                                        let mut p = procs2.lock().await;
                                                        if let Some(proc) = p.get_mut(&pname2) {
                                                            proc.child = Some(child2);
                                                            proc.info.pid = Some(pid2);
                                                            proc.info.status =
                                                                ProcessStatus::Running;
                                                        }
                                                    }

                                                    let _ = app2.emit(
                                                        "process-status",
                                                        ProcessEvent {
                                                            name: pname2.clone(),
                                                            status: ProcessStatus::Running,
                                                            log_line: Some(format!(
                                                                "Restarted (pid {})",
                                                                pid2
                                                            )),
                                                        },
                                                    );

                                                    // Re-attach stdout/stderr reader
                                                    let app3 = app2.clone();
                                                    let procs3 = procs2.clone();
                                                    let pname3 = pname2.clone();
                                                    tauri::async_runtime::spawn(async move {
                                                        while let Some(ev) = rx2.recv().await {
                                                            match ev {
                                                                CommandEvent::Stdout(data) => {
                                                                    let line =
                                                                        String::from_utf8_lossy(
                                                                            &data,
                                                                        )
                                                                        .trim()
                                                                        .to_string();
                                                                    if line.is_empty() {
                                                                        continue;
                                                                    }
                                                                    {
                                                                        let mut p =
                                                                            procs3.lock().await;
                                                                        if let Some(proc) =
                                                                            p.get_mut(&pname3)
                                                                        {
                                                                            proc.append_log(
                                                                                line.clone(),
                                                                            );
                                                                        }
                                                                    }
                                                                    // Emit structured mithril-progress events for the download UI
                                                                    if pname3 == "mithril-client" {
                                                                        if let Some(progress) = crate::process::mithril::parse_mithril_output(&line) {
                                                                            let _ = app3.emit("mithril-progress", progress);
                                                                        }
                                                                    }
                                                                    let _ = app3.emit("process-status", ProcessEvent {
                                                                        name: pname3.clone(),
                                                                        status: ProcessStatus::Running,
                                                                        log_line: Some(line),
                                                                    });
                                                                }
                                                                CommandEvent::Stderr(data) => {
                                                                    let line =
                                                                        String::from_utf8_lossy(
                                                                            &data,
                                                                        )
                                                                        .trim()
                                                                        .to_string();
                                                                    if line.is_empty() {
                                                                        continue;
                                                                    }
                                                                    let log_line = format!(
                                                                        "[stderr] {}",
                                                                        line
                                                                    );
                                                                    {
                                                                        let mut p =
                                                                            procs3.lock().await;
                                                                        if let Some(proc) =
                                                                            p.get_mut(&pname3)
                                                                        {
                                                                            proc.append_log(
                                                                                log_line.clone(),
                                                                            );
                                                                        }
                                                                    }
                                                                    let _ = app3.emit("process-status", ProcessEvent {
                                                                        name: pname3.clone(),
                                                                        status: ProcessStatus::Running,
                                                                        log_line: Some(log_line),
                                                                    });
                                                                }
                                                                CommandEvent::Terminated(_)
                                                                | CommandEvent::Error(_) => break,
                                                                _ => {}
                                                            }
                                                        }
                                                    });
                                                }
                                            }
                                        });
                                    }

                                    true
                                } else {
                                    proc.info.status = ProcessStatus::Error {
                                        message: format!(
                                            "{} (max restarts {} reached)",
                                            msg, proc.restart_policy.max_retries
                                        ),
                                    };
                                    false
                                }
                            } else {
                                false
                            }
                        } else {
                            // Clean exit (code 0) — just mark as stopped
                            let mut procs = processes.lock().await;
                            if let Some(proc) = procs.get_mut(&process_name) {
                                proc.info.status = ProcessStatus::Stopped;
                                proc.child = None;
                                proc.info.pid = None;
                            }
                            false
                        };

                        let status = if is_crash && !should_restart {
                            let procs = processes.lock().await;
                            procs
                                .get(&process_name)
                                .map(|p| p.info.status.clone())
                                .unwrap_or(ProcessStatus::Error {
                                    message: msg.clone(),
                                })
                        } else if !is_crash {
                            ProcessStatus::Stopped
                        } else {
                            // Restart is scheduled, don't emit final stopped
                            break;
                        };

                        let _ = app_handle.emit(
                            "process-status",
                            ProcessEvent {
                                name: process_name.clone(),
                                status,
                                log_line: Some(msg),
                            },
                        );
                        break;
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    /// Start a process by spawning an arbitrary command (not a sidecar).
    /// Used for the Express backend which is a Node.js app, not a bundled binary.
    /// Supports custom working directory and environment variables.
    pub async fn start_command(
        &self,
        name: &str,
        program: &str,
        args: Vec<String>,
        cwd: Option<&std::path::PathBuf>,
        env_vars: Vec<(String, String)>,
    ) -> Result<(), String> {
        // Stop existing process gracefully if running
        self.stop(name).await?;

        // Set status to Starting, store launch info
        let launch = LaunchInfo::Command {
            _program: program.to_string(),
            _args: args.clone(),
            _cwd: cwd.cloned(),
            _env_vars: env_vars.clone(),
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
                        child: None,
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
                    },
                );
            }
        }

        self.emit_status(name, ProcessStatus::Starting, None);

        // Build the tokio command
        let mut cmd = tokio::process::Command::new(program);
        cmd.args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        // Inherit minimal env so `node` works, then overlay our vars
        if let Ok(path) = std::env::var("PATH") {
            cmd.env("PATH", path);
        }
        if let Ok(home) = std::env::var("HOME") {
            cmd.env("HOME", home);
        }

        for (key, val) in &env_vars {
            cmd.env(key, val);
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

        // Track by PID (no CommandChild for tokio processes)
        {
            let mut procs = self.processes.lock().await;
            if let Some(proc) = procs.get_mut(name) {
                proc.info.pid = Some(pid);
                proc.info.status = ProcessStatus::Running;
                proc.info.last_error = None;
            }
            Self::save_pids_sync(&self.pid_file, &procs);
        }

        self.emit_status(name, ProcessStatus::Running, None);

        // Spawn background tasks for stdout/stderr capture + wait for exit
        let app_handle = self.app_handle.clone();
        let processes = self.processes.clone();
        let process_name = name.to_string();

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
            let status = if code == Some(0) {
                ProcessStatus::Stopped
            } else {
                ProcessStatus::Error {
                    message: msg.clone(),
                }
            };
            {
                let mut p = processes.lock().await;
                if let Some(proc) = p.get_mut(&process_name) {
                    proc.info.status = status.clone();
                    proc.info.pid = None;
                    if code != Some(0) {
                        proc.info.last_error = Some(msg.clone());
                    }
                }
            }
            let _ = app_handle.emit(
                "process-status",
                ProcessEvent {
                    name: process_name,
                    status,
                    log_line: Some(msg),
                },
            );
        });

        Ok(())
    }

    /// Stop a process gracefully.
    /// Sends SIGTERM first, waits for the per-process timeout, then falls back to SIGKILL.
    /// Sets user_stopped to prevent auto-restart.
    pub async fn stop(&self, name: &str) -> Result<(), String> {
        let (child, pid, timeout_secs) = {
            let mut procs = self.processes.lock().await;
            if let Some(proc) = procs.get_mut(name) {
                proc.user_stopped = true;
                let child = proc.child.take();
                let pid = proc.info.pid.take();
                let timeout = proc.shutdown_timeout_secs;
                proc.info.status = ProcessStatus::Stopped;
                Self::save_pids_sync(&self.pid_file, &procs);
                (child, pid, timeout)
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
                if let Some(child) = child {
                    let _ = child.kill();
                }
            }
        } else if let Some(child) = child {
            // No PID available, fall back to kill
            let _ = child.kill();
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

    /// Get recent log lines for a process
    pub async fn get_logs(&self, name: &str, lines: usize) -> Vec<String> {
        let procs = self.processes.lock().await;
        if let Some(proc) = procs.get(name) {
            let start = proc.log_buffer.len().saturating_sub(lines);
            proc.log_buffer[start..].to_vec()
        } else {
            Vec::new()
        }
    }

    /// Synchronous graceful shutdown of ALL tracked processes.
    /// Called from the RunEvent::Exit handler where async may not work reliably.
    ///
    /// Sends SIGTERM first and waits up to 30 seconds for processes to exit
    /// cleanly (cardano-node needs this to flush its ledger state to disk).
    /// Only falls back to SIGKILL for processes that don't exit in time.
    pub fn kill_all_sync(&self) {
        let mut all_pids: Vec<u32> = Vec::new();

        // Collect PIDs from the pid file
        if let Ok(contents) = std::fs::read_to_string(&self.pid_file) {
            if let Ok(pids) = serde_json::from_str::<Vec<u32>>(&contents) {
                all_pids.extend(pids);
            }
        }

        // Also collect PIDs from known ports as a safety net
        for port in [3001u16, 1337, 1442] {
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

        // Step 2: Wait up to 30 seconds for all to exit gracefully.
        // cardano-node needs time to flush its in-memory ledger to disk.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            let still_alive: Vec<u32> = all_pids
                .iter()
                .copied()
                .filter(|pid| send_signal(*pid, 0))
                .collect();

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

    /// Spawn a background task that checks process liveness every 30 seconds.
    ///
    /// If a process's PID is no longer running (and wasn't intentionally stopped),
    /// its status is set to Error and a `process-status` event is emitted so the
    /// frontend shows the failure. Does not auto-restart — the UI shows the error
    /// state and the user can choose to restart.
    fn spawn_liveness_monitor(
        processes: Arc<Mutex<HashMap<String, ManagedProcess>>>,
        app_handle: tauri::AppHandle,
        pid_file: std::path::PathBuf,
    ) {
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
            loop {
                interval.tick().await;

                let mut procs = processes.lock().await;
                let mut changed = false;

                for (name, proc) in procs.iter_mut() {
                    // Skip processes that were intentionally stopped or are already in
                    // a terminal state (Stopped / Error).
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

                    // Check if the PID is still alive
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
                            changed = true;

                            let _ = app_handle.emit(
                                "process-status",
                                ProcessEvent {
                                    name: name.clone(),
                                    status: proc.info.status.clone(),
                                    log_line: None,
                                },
                            );
                        }
                    }
                }

                if changed {
                    Self::save_pids_sync(&pid_file, &procs);
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
            child: None,
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
            child: None,
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
        };

        // Fill to LOG_BUFFER_SIZE + 1
        for i in 0..=LOG_BUFFER_SIZE {
            proc.append_log(format!("line {}", i));
        }

        assert_eq!(proc.log_buffer.len(), LOG_BUFFER_SIZE);
        // First entry should be "line 1" (line 0 was evicted)
        assert_eq!(proc.log_buffer[0], "line 1");
        assert_eq!(
            proc.log_buffer[LOG_BUFFER_SIZE - 1],
            format!("line {}", LOG_BUFFER_SIZE)
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
        assert_eq!(default_shutdown_timeout("cardano-node"), 45);
        assert_eq!(default_shutdown_timeout("mithril-client"), 30);
        assert_eq!(default_shutdown_timeout("ogmios"), 10);
        assert_eq!(default_shutdown_timeout("kupo"), 10);
        assert_eq!(default_shutdown_timeout("express"), 10);
    }
}
