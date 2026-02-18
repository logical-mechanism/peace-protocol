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
        program: String,
        args: Vec<String>,
        cwd: Option<std::path::PathBuf>,
        env_vars: Vec<(String, String)>,
    },
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
}

/// The central process manager, held in Tauri state.
/// Manages the lifecycle of all sidecar processes.
pub struct NodeManager {
    processes: Arc<Mutex<HashMap<String, ManagedProcess>>>,
    app_handle: tauri::AppHandle,
    pid_file: std::path::PathBuf,
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
        };

        // Kill any orphaned processes from a previous crashed session
        mgr.kill_orphans_from_pid_file();
        mgr.kill_orphans_on_ports();
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
            .filter(|pid| {
                std::process::Command::new("kill")
                    .args(["-0", &pid.to_string()])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
            })
            .collect();

        if alive_pids.is_empty() {
            let _ = std::fs::remove_file(&self.pid_file);
            return;
        }

        // SIGTERM first
        for pid in &alive_pids {
            eprintln!("[NodeManager] Sending SIGTERM to orphan pid={pid} from PID file");
            let _ = std::process::Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .output();
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
            let _ = std::process::Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .output();
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
                .filter(|pid| {
                    std::process::Command::new("kill")
                        .args(["-0", &pid.to_string()])
                        .output()
                        .map(|o| o.status.success())
                        .unwrap_or(false)
                })
                .collect();

            if still_alive.is_empty() {
                return;
            }

            if std::time::Instant::now() >= deadline {
                for pid in &still_alive {
                    eprintln!("[NodeManager] SIGKILL orphan pid={pid} (did not exit after SIGTERM)");
                    let _ = std::process::Command::new("kill")
                        .args(["-9", &pid.to_string()])
                        .output();
                }
                return;
            }

            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    }

    /// Persist all active PIDs to disk so they can be cleaned up after a crash.
    fn save_pids_sync(pid_file: &std::path::Path, processes: &HashMap<String, ManagedProcess>) {
        let pids: Vec<u32> = processes
            .values()
            .filter_map(|p| p.info.pid)
            .collect();

        if pids.is_empty() {
            let _ = std::fs::remove_file(pid_file);
        } else {
            if let Ok(json) = serde_json::to_string(&pids) {
                let _ = std::fs::write(pid_file, json);
            }
        }
    }

    /// Register a process slot without starting it
    pub async fn register(&self, name: &str, restart_policy: RestartPolicy) {
        let mut procs = self.processes.lock().await;
        procs.insert(
            name.to_string(),
            ManagedProcess {
                child: None,
                info: ProcessInfo {
                    name: name.to_string(),
                    status: ProcessStatus::Stopped,
                    pid: None,
                    restart_count: 0,
                    last_error: None,
                },
                restart_policy,
                log_buffer: Vec::new(),
                launch_info: None,
                user_stopped: false,
            },
        );
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
                                proc.log_buffer.push(line.clone());
                                if proc.log_buffer.len() > LOG_BUFFER_SIZE {
                                    proc.log_buffer.remove(0);
                                }
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
                                proc.log_buffer.push(format!("[stderr] {}", line));
                                if proc.log_buffer.len() > LOG_BUFFER_SIZE {
                                    proc.log_buffer.remove(0);
                                }
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
                                    let delay = proc.restart_policy.initial_delay_ms as f64
                                        * proc
                                            .restart_policy
                                            .backoff_multiplier
                                            .powi((proc.info.restart_count - 1) as i32);
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
                                    if let Some(LaunchInfo::Sidecar {
                                        sidecar_name,
                                        args,
                                    }) = launch
                                    {
                                        let app2 = app_handle.clone();
                                        let procs2 = processes.clone();
                                        let pname2 = process_name.clone();
                                        tauri::async_runtime::spawn(async move {
                                            tokio::time::sleep(
                                                tokio::time::Duration::from_millis(delay as u64),
                                            )
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
                                                                    let line = String::from_utf8_lossy(&data).trim().to_string();
                                                                    if line.is_empty() { continue; }
                                                                    {
                                                                        let mut p = procs3.lock().await;
                                                                        if let Some(proc) = p.get_mut(&pname3) {
                                                                            proc.log_buffer.push(line.clone());
                                                                            if proc.log_buffer.len() > LOG_BUFFER_SIZE {
                                                                                proc.log_buffer.remove(0);
                                                                            }
                                                                        }
                                                                    }
                                                                    let _ = app3.emit("process-status", ProcessEvent {
                                                                        name: pname3.clone(),
                                                                        status: ProcessStatus::Running,
                                                                        log_line: Some(line),
                                                                    });
                                                                }
                                                                CommandEvent::Stderr(data) => {
                                                                    let line = String::from_utf8_lossy(&data).trim().to_string();
                                                                    if line.is_empty() { continue; }
                                                                    let log_line = format!("[stderr] {}", line);
                                                                    {
                                                                        let mut p = procs3.lock().await;
                                                                        if let Some(proc) = p.get_mut(&pname3) {
                                                                            proc.log_buffer.push(log_line.clone());
                                                                            if proc.log_buffer.len() > LOG_BUFFER_SIZE {
                                                                                proc.log_buffer.remove(0);
                                                                            }
                                                                        }
                                                                    }
                                                                    let _ = app3.emit("process-status", ProcessEvent {
                                                                        name: pname3.clone(),
                                                                        status: ProcessStatus::Running,
                                                                        log_line: Some(log_line),
                                                                    });
                                                                }
                                                                CommandEvent::Terminated(_) | CommandEvent::Error(_) => break,
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
            program: program.to_string(),
            args: args.clone(),
            cwd: cwd.cloned(),
            env_vars: env_vars.clone(),
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
            self.emit_status(name, ProcessStatus::Error { message: msg.clone() }, None);
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
                        if line.is_empty() { continue; }
                        {
                            let mut p = procs.lock().await;
                            if let Some(proc) = p.get_mut(&pname) {
                                proc.log_buffer.push(line.clone());
                                if proc.log_buffer.len() > LOG_BUFFER_SIZE {
                                    proc.log_buffer.remove(0);
                                }
                            }
                        }
                        let _ = app.emit("process-status", ProcessEvent {
                            name: pname.clone(),
                            status: ProcessStatus::Running,
                            log_line: Some(line),
                        });
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
                        if line.is_empty() { continue; }
                        let log_line = format!("[stderr] {}", line);
                        {
                            let mut p = procs.lock().await;
                            if let Some(proc) = p.get_mut(&pname) {
                                proc.log_buffer.push(log_line.clone());
                                if proc.log_buffer.len() > LOG_BUFFER_SIZE {
                                    proc.log_buffer.remove(0);
                                }
                            }
                        }
                        let _ = app.emit("process-status", ProcessEvent {
                            name: pname.clone(),
                            status: ProcessStatus::Running,
                            log_line: Some(log_line),
                        });
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
                ProcessStatus::Error { message: msg.clone() }
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
            let _ = app_handle.emit("process-status", ProcessEvent {
                name: process_name,
                status,
                log_line: Some(msg),
            });
        });

        Ok(())
    }

    /// Stop a process gracefully.
    /// Sends SIGTERM first, waits up to 30 seconds for exit, then falls back to SIGKILL.
    /// Sets user_stopped to prevent auto-restart.
    pub async fn stop(&self, name: &str) -> Result<(), String> {
        let (child, pid) = {
            let mut procs = self.processes.lock().await;
            if let Some(proc) = procs.get_mut(name) {
                proc.user_stopped = true;
                let child = proc.child.take();
                let pid = proc.info.pid.take();
                proc.info.status = ProcessStatus::Stopped;
                Self::save_pids_sync(&self.pid_file, &procs);
                (child, pid)
            } else {
                return Ok(());
            }
        };

        self.emit_status(name, ProcessStatus::Stopped, None);

        if let Some(pid) = pid {
            // Send SIGTERM for graceful shutdown
            let _ = std::process::Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .output();

            // Wait up to 30 seconds for the process to exit gracefully
            let mut exited = false;
            for _ in 0..60 {
                let alive = std::process::Command::new("kill")
                    .args(["-0", &pid.to_string()])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false);
                if !alive {
                    exited = true;
                    break;
                }
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            }

            // Fall back to SIGKILL if graceful shutdown timed out
            if !exited {
                eprintln!("Process '{}' (pid {}) did not exit after SIGTERM, sending SIGKILL", name, pid);
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

    /// Update the status of a process externally (e.g., from health checks)
    pub async fn set_status(&self, name: &str, status: ProcessStatus) {
        let mut procs = self.processes.lock().await;
        if let Some(proc) = procs.get_mut(name) {
            proc.info.status = status.clone();
        }
        drop(procs);
        self.emit_status(name, status, None);
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

    /// Stop ALL processes (called on app shutdown)
    pub async fn shutdown_all(&self) {
        // Stop in reverse dependency order: express, kupo, ogmios, cardano-node, mithril-client
        for name in &["express", "kupo", "ogmios", "cardano-node", "mithril-client"] {
            let _ = self.stop(name).await;
        }
        // Clean up PID file since all processes are stopped
        let _ = std::fs::remove_file(&self.pid_file);
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

        if all_pids.is_empty() {
            let _ = std::fs::remove_file(&self.pid_file);
            return;
        }

        // Step 1: Send SIGTERM to all processes
        for pid in &all_pids {
            eprintln!("[NodeManager] Exit: sending SIGTERM to pid={pid}");
            let _ = std::process::Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .output();
        }

        // Step 2: Wait up to 30 seconds for all to exit gracefully.
        // cardano-node needs time to flush its in-memory ledger to disk.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            let still_alive: Vec<u32> = all_pids
                .iter()
                .copied()
                .filter(|pid| {
                    std::process::Command::new("kill")
                        .args(["-0", &pid.to_string()])
                        .output()
                        .map(|o| o.status.success())
                        .unwrap_or(false)
                })
                .collect();

            if still_alive.is_empty() {
                eprintln!("[NodeManager] Exit: all processes exited cleanly");
                break;
            }

            if std::time::Instant::now() >= deadline {
                // Step 3: SIGKILL any survivors
                for pid in &still_alive {
                    eprintln!("[NodeManager] Exit: SIGKILL pid={pid} (did not exit after SIGTERM)");
                    let _ = std::process::Command::new("kill")
                        .args(["-9", &pid.to_string()])
                        .output();
                }
                break;
            }

            std::thread::sleep(std::time::Duration::from_millis(500));
        }

        let _ = std::fs::remove_file(&self.pid_file);
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
}
