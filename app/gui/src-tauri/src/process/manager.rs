use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Emitter;
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

/// A single managed child process with its metadata
struct ManagedProcess {
    child: Option<CommandChild>,
    info: ProcessInfo,
    #[allow(dead_code)]
    restart_policy: RestartPolicy,
    log_buffer: Vec<String>,
}

/// The central process manager, held in Tauri state.
/// Manages the lifecycle of all sidecar processes.
pub struct NodeManager {
    processes: Arc<Mutex<HashMap<String, ManagedProcess>>>,
    app_handle: tauri::AppHandle,
}

impl NodeManager {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            app_handle,
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

        // Set status to Starting
        {
            let mut procs = self.processes.lock().await;
            if let Some(proc) = procs.get_mut(name) {
                proc.info.status = ProcessStatus::Starting;
                proc.log_buffer.clear();
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
                        let status = if payload.code == Some(0) {
                            ProcessStatus::Stopped
                        } else {
                            ProcessStatus::Error {
                                message: msg.clone(),
                            }
                        };

                        {
                            let mut procs = processes.lock().await;
                            if let Some(proc) = procs.get_mut(&process_name) {
                                proc.info.status = status.clone();
                                proc.child = None;
                                proc.info.pid = None;
                                if payload.code != Some(0) {
                                    proc.info.last_error = Some(msg.clone());
                                }
                            }
                        }

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

    /// Stop a process gracefully.
    /// Sends SIGTERM first, waits up to 30 seconds for exit, then falls back to SIGKILL.
    pub async fn stop(&self, name: &str) -> Result<(), String> {
        let (child, pid) = {
            let mut procs = self.processes.lock().await;
            if let Some(proc) = procs.get_mut(name) {
                let child = proc.child.take();
                let pid = proc.info.pid.take();
                proc.info.status = ProcessStatus::Stopped;
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
        // Stop in reverse dependency order: kupo, ogmios, cardano-node, mithril-client
        for name in &["kupo", "ogmios", "cardano-node", "mithril-client"] {
            let _ = self.stop(name).await;
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
}
