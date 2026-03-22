use std::fs::File;
use std::io::BufReader;
use std::sync::Mutex;
use std::time::Duration;

use rodio::Source;
use serde::Serialize;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

// ── Managed state ───────────────────────────────────────────────────────────
//
// rodio::OutputStream is !Send (tied to the audio device thread), so we keep
// it on a dedicated background thread and communicate via the OutputStreamHandle
// (which IS Send + Sync).  The Sink is also Send + Sync.

pub struct AudioPlayback {
    inner: Mutex<Option<AudioInner>>,
}

struct AudioInner {
    // OutputStreamHandle is Send + Sync; the OutputStream itself lives on
    // a background thread spawned by rodio.
    _handle: rodio::OutputStreamHandle,
    sink: rodio::Sink,
    duration_secs: f64,
    file_path: String,
    loop_enabled: bool,
    // Keep the stream alive via a join handle — dropping it stops audio.
    _keep_alive: std::sync::Arc<KeepAlive>,
}

/// Prevents the OutputStream from being dropped (which would stop audio).
/// The OutputStream lives on a background thread; this keeps it alive.
struct KeepAlive {
    _stream: Mutex<Option<rodio::OutputStream>>,
}

// SAFETY: OutputStream is only accessed on the thread that created it.
// We never read/write it from other threads — we just prevent it from dropping.
unsafe impl Send for KeepAlive {}
unsafe impl Sync for KeepAlive {}

impl AudioPlayback {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

// ── Response types ──────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct AudioStatus {
    pub loaded: bool,
    pub playing: bool,
    pub finished: bool,
    pub position_secs: f64,
    pub duration_secs: f64,
    pub volume: f32,
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/// Quick duration probe via symphonia (used when rodio returns 0 for VBR MP3s).
fn probe_duration(path: &str) -> Option<f64> {
    let file = File::open(path).ok()?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .ok()?;
    let track = probed.format.default_track()?;
    let n_frames = track.codec_params.n_frames?;
    let sample_rate = track.codec_params.sample_rate? as f64;
    Some(n_frames as f64 / sample_rate)
}

// ── Commands ────────────────────────────────────────────────────────────────

/// Start playing an audio file. Stops any current playback first.
/// Returns the duration in seconds (0 if unknown).
#[tauri::command]
pub fn audio_play(
    state: tauri::State<'_, AudioPlayback>,
    path: String,
    volume: f32,
) -> Result<f64, String> {
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;

    // Stop existing playback
    if let Some(prev) = guard.take() {
        prev.sink.stop();
    }

    let (stream, stream_handle) =
        rodio::OutputStream::try_default().map_err(|e| format!("Audio output error: {e}"))?;

    // Wrap OutputStream so it stays alive but doesn't need to be Send
    let keep_alive = std::sync::Arc::new(KeepAlive {
        _stream: Mutex::new(Some(stream)),
    });

    let file = File::open(&path).map_err(|e| format!("Cannot open file: {e}"))?;
    let source = rodio::Decoder::new(BufReader::new(file))
        .map_err(|e| format!("Cannot decode audio: {e}"))?;

    let mut duration_secs = source.total_duration().map_or(0.0, |d| d.as_secs_f64());

    // Fallback: use symphonia to probe duration for VBR MP3s where rodio returns 0
    if duration_secs == 0.0 {
        if let Some(dur) = probe_duration(&path) {
            duration_secs = dur;
        }
    }

    let sink =
        rodio::Sink::try_new(&stream_handle).map_err(|e| format!("Audio sink error: {e}"))?;
    sink.set_volume(volume.clamp(0.0, 1.0));
    sink.append(source);

    *guard = Some(AudioInner {
        _handle: stream_handle,
        sink,
        duration_secs,
        file_path: path,
        loop_enabled: false,
        _keep_alive: keep_alive,
    });

    Ok(duration_secs)
}

/// Pause playback (keeps position).
#[tauri::command]
pub fn audio_pause(state: tauri::State<'_, AudioPlayback>) -> Result<(), String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    if let Some(inner) = guard.as_ref() {
        inner.sink.pause();
    }
    Ok(())
}

/// Resume paused playback.
#[tauri::command]
pub fn audio_resume(state: tauri::State<'_, AudioPlayback>) -> Result<(), String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    if let Some(inner) = guard.as_ref() {
        inner.sink.play();
    }
    Ok(())
}

/// Stop playback and release resources.
#[tauri::command]
pub fn audio_stop(state: tauri::State<'_, AudioPlayback>) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    if let Some(inner) = guard.take() {
        inner.sink.stop();
    }
    Ok(())
}

/// Seek to a position in seconds.
#[tauri::command]
pub fn audio_seek(
    state: tauri::State<'_, AudioPlayback>,
    position_secs: f64,
) -> Result<(), String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    if let Some(inner) = guard.as_ref() {
        let pos = Duration::from_secs_f64(position_secs.max(0.0));
        inner
            .sink
            .try_seek(pos)
            .map_err(|e| format!("Seek failed: {e}"))?;
    }
    Ok(())
}

/// Set playback volume (0.0 – 1.0).
#[tauri::command]
pub fn audio_set_volume(state: tauri::State<'_, AudioPlayback>, volume: f32) -> Result<(), String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    if let Some(inner) = guard.as_ref() {
        inner.sink.set_volume(volume.clamp(0.0, 1.0));
    }
    Ok(())
}

/// Set playback speed (0.25 – 4.0).
#[tauri::command]
pub fn audio_set_speed(state: tauri::State<'_, AudioPlayback>, speed: f32) -> Result<(), String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    if let Some(inner) = guard.as_ref() {
        inner.sink.set_speed(speed.clamp(0.25, 4.0));
    }
    Ok(())
}

/// Enable or disable loop mode.
#[tauri::command]
pub fn audio_set_loop(state: tauri::State<'_, AudioPlayback>, enabled: bool) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    if let Some(inner) = guard.as_mut() {
        inner.loop_enabled = enabled;
    }
    Ok(())
}

/// Get current playback status (position, playing, volume, etc.).
/// Called by the frontend on a polling interval.
/// When loop is enabled and the sink empties, this re-opens the file
/// and appends it to the sink — no IPC round trip for gapless looping.
#[tauri::command]
pub fn audio_get_status(state: tauri::State<'_, AudioPlayback>) -> Result<AudioStatus, String> {
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    Ok(match guard.as_mut() {
        Some(inner) => {
            let sink_empty = inner.sink.empty();
            let is_playing = !inner.sink.is_paused() && !sink_empty;
            let finished = sink_empty && !inner.sink.is_paused();

            // Rust-side loop: re-open file when track ends with loop enabled
            if finished && inner.loop_enabled {
                if let Ok(file) = File::open(&inner.file_path) {
                    if let Ok(source) = rodio::Decoder::new(BufReader::new(file)) {
                        inner.sink.append(source);
                        inner.sink.play();
                        return Ok(AudioStatus {
                            loaded: true,
                            playing: true,
                            finished: false,
                            position_secs: 0.0,
                            duration_secs: inner.duration_secs,
                            volume: inner.sink.volume(),
                        });
                    }
                }
            }

            AudioStatus {
                loaded: true,
                playing: is_playing,
                finished,
                position_secs: inner.sink.get_pos().as_secs_f64(),
                duration_secs: inner.duration_secs,
                volume: inner.sink.volume(),
            }
        }
        None => AudioStatus {
            loaded: false,
            playing: false,
            finished: false,
            position_secs: 0.0,
            duration_secs: 0.0,
            volume: 0.0,
        },
    })
}
