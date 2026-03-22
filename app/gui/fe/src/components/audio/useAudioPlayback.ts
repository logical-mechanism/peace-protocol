import { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SPEED_OPTIONS } from './audioConstants';

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    '.opus': 'audio/opus',
  };
  return map[ext.toLowerCase()] || 'audio/mpeg';
}
export { getMimeType };

export function formatTime(seconds: number, unknownPlaceholder = false): string {
  if (!isFinite(seconds) || seconds < 0) return unknownPlaceholder ? '--:--' : '00:00';
  if (seconds === 0 && unknownPlaceholder) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function getConversionHint(ext: string): string | null {
  const hints: Record<string, string> = {
    '.flac': 'Try converting to MP3: ffmpeg -i file.flac -q:a 2 output.mp3',
    '.aac': 'Try converting to MP3: ffmpeg -i file.aac -c:a libmp3lame output.mp3',
    '.opus': 'Try converting to OGG: ffmpeg -i file.opus -c:a libvorbis output.ogg',
    '.m4a': 'Try converting to MP3: ffmpeg -i file.m4a -c:a libmp3lame output.mp3',
    '.wav': 'WAV is usually supported. The file may be corrupted or use an uncommon codec.',
    '.ogg': 'Try converting to MP3: ffmpeg -i file.ogg -c:a libmp3lame output.mp3',
    '.mp3': 'MP3 is widely supported. The file may be corrupted or use an uncommon bitrate.',
  };
  return hints[ext.toLowerCase()] ?? null;
}

// ── Rodio IPC types ─────────────────────────────────────────────────────

interface AudioStatus {
  loaded: boolean;
  playing: boolean;
  finished: boolean;
  position_secs: number;
  duration_secs: number;
  volume: number;
}

// ── Hook ────────────────────────────────────────────────────────────────

interface UseAudioPlaybackOptions {
  /** Token name for resolving the file path via Tauri IPC */
  tokenName: string;
  /** Category for resolving the file path via Tauri IPC */
  category: string;
  fileExtension: string;
  /** Waveform duration from symphonia (used when rodio can't determine duration, e.g. MP3) */
  waveformDuration?: number;
  onTimeUpdate?: (time: number, duration: number) => void;
  onSeeked?: () => void;
}

export function useAudioPlayback({ tokenName, category, fileExtension, waveformDuration, onTimeUpdate, onSeeked }: UseAudioPlaybackOptions) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.75);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);

  const isPlayingRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollIntervalRef = useRef(1000); // start slow; switch to 100ms when playing
  const volumeBeforeMuteRef = useRef(0.75);
  const isLoopingRef = useRef(false);

  // Stable refs for callbacks
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onSeekedRef = useRef(onSeeked);
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
    onSeekedRef.current = onSeeked;
  });

  // Use waveform duration as fallback (rodio returns 0 for MP3/VBR)
  const effectiveDuration = duration > 0 ? duration : (waveformDuration ?? 0);
  const effectiveDurationRef = useRef(effectiveDuration);
  useEffect(() => { effectiveDurationRef.current = effectiveDuration; });

  // ── Polling for playback status ────────────────────────────────────

  const pollCallback = useCallback(async () => {
    try {
      const status = await invoke<AudioStatus>('audio_get_status');
      if (!status.loaded) return;

      setCurrentTime(status.position_secs);
      if (status.duration_secs > 0) setDuration(status.duration_secs);
      onTimeUpdateRef.current?.(status.position_secs, status.duration_secs || effectiveDurationRef.current);

      // Track finished (Rust handles looping — if loop_enabled, it re-opens
      // the file server-side so `finished` stays false)
      if (status.finished && isPlayingRef.current) {
        isPlayingRef.current = false;
        setIsPlaying(false);
      }
      // Sync playing state from Rust (e.g., after Rust-side loop restart)
      if (status.playing && !isPlayingRef.current) {
        isPlayingRef.current = true;
        setIsPlaying(true);
      }
    } catch { /* ignore poll errors during teardown */ }
  }, []);

  const startPolling = useCallback((intervalMs = 1000) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollIntervalRef.current = intervalMs;
    pollRef.current = setInterval(pollCallback, intervalMs);
  }, [pollCallback]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /** Switch polling speed: 100ms when playing, 1000ms when paused */
  const setPollRate = useCallback((playing: boolean) => {
    const target = playing ? 100 : 1000;
    if (pollRef.current && pollIntervalRef.current !== target) {
      startPolling(target);
    }
  }, [startPolling]);

  // ── Load audio on mount / when file changes ───────────────────────

  useEffect(() => {
    let cancelled = false;

    // Stop any previous playback
    invoke('audio_stop').catch(() => {});
    stopPolling();

    // Reset state via ref — actual state updates happen in the async callback
    isPlayingRef.current = false;

    // Resolve file path via Tauri and tell rodio to load it
    (async () => {
      setIsReady(false);
      setError(null);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setPlaybackRate(1.0);
      setIsBuffering(false);
      setPlayError(null);

      try {
        const path = await invoke<string>('get_library_content_path', { tokenName, category });
        if (cancelled) return;

        const dur = await invoke<number>('audio_play', { path, volume });
        if (cancelled) { invoke('audio_stop').catch(() => {}); return; }

        // Immediately pause — we load but don't auto-play
        await invoke('audio_pause');

        if (dur > 0) setDuration(dur);
        setIsReady(true);
        startPolling();
      } catch (e) {
        if (cancelled) return;
        console.error('[AudioPlayer] rodio load failed:', e);
        setError(`Failed to load audio: ${e}`);
      }
    })();

    return () => {
      cancelled = true;
      stopPolling();
      invoke('audio_stop').catch(() => {});
    };
  }, [tokenName, category, startPolling, stopPolling]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Transport controls ────────────────────────────────────────────

  const play = useCallback(() => {
    if (!isReady) return;
    invoke('audio_resume').then(() => {
      isPlayingRef.current = true;
      setIsPlaying(true);
      setPlayError(null);
      setPollRate(true);
    }).catch(err => {
      console.error('Failed to play:', err);
      setPlayError('Failed to play audio. Try again or save the file to open with an external player.');
    });
  }, [isReady, setPollRate]);

  const pause = useCallback(() => {
    invoke('audio_pause').catch(() => {});
    isPlayingRef.current = false;
    setIsPlaying(false);
    setPollRate(false);
  }, [setPollRate]);

  const stop = useCallback(() => {
    invoke('audio_pause').catch(() => {});
    invoke('audio_seek', { positionSecs: 0.0 }).catch(() => {});
    isPlayingRef.current = false;
    setIsPlaying(false);
    setCurrentTime(0);
    setPollRate(false);
  }, [setPollRate]);

  const skipBack = useCallback(() => {
    if (!isReady) return;
    const newTime = Math.max(0, currentTime - 10);
    invoke('audio_seek', { positionSecs: newTime }).catch(() => {});
    setCurrentTime(newTime);
  }, [isReady, currentTime]);

  const skipForward = useCallback(() => {
    if (!isReady) return;
    const newTime = Math.min(effectiveDuration, currentTime + 10);
    invoke('audio_seek', { positionSecs: newTime }).catch(() => {});
    setCurrentTime(newTime);
  }, [isReady, currentTime, effectiveDuration]);

  const seek = useCallback((time: number) => {
    invoke('audio_seek', { positionSecs: time }).catch(() => {});
    setCurrentTime(time);
    onSeekedRef.current?.();
  }, []);

  const handleSetVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolume(clamped);
    setIsMuted(false);
    invoke('audio_set_volume', { volume: clamped }).catch(() => {});
  }, []);

  const toggleMute = useCallback(() => {
    if (isMuted) {
      // Unmute — restore previous volume
      setIsMuted(false);
      invoke('audio_set_volume', { volume: volumeBeforeMuteRef.current }).catch(() => {});
      setVolume(volumeBeforeMuteRef.current);
    } else {
      // Mute — save current volume and set to 0
      volumeBeforeMuteRef.current = volume;
      setIsMuted(true);
      invoke('audio_set_volume', { volume: 0.0 }).catch(() => {});
    }
  }, [isMuted, volume]);

  const toggleLoop = useCallback(() => {
    setIsLooping(prev => {
      const next = !prev;
      isLoopingRef.current = next;
      invoke('audio_set_loop', { enabled: next }).catch(() => {});
      return next;
    });
  }, []);

  const cycleSpeed = useCallback(() => {
    const idx = SPEED_OPTIONS.indexOf(playbackRate as typeof SPEED_OPTIONS[number]);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    setPlaybackRate(next);
    invoke('audio_set_speed', { speed: next }).catch(() => {});
  }, [playbackRate]);

  const clearPlayError = useCallback(() => setPlayError(null), []);

  const mimeType = getMimeType(fileExtension);

  return {
    mimeType,
    state: {
      isReady, isPlaying, currentTime,
      duration: effectiveDuration,
      error, isBuffering, playError, isLooping, isMuted, volume, playbackRate,
    },
    actions: { play, pause, stop, skipBack, skipForward, seek, setVolume: handleSetVolume, toggleMute, toggleLoop, cycleSpeed, clearPlayError },
  };
}
