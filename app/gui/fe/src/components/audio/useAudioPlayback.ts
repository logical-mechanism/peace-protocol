import { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SPEED_OPTIONS } from './audioConstants';
import { getMimeType } from './audioUtils';
import {
  getAudioVolume, setAudioVolume as persistVolume,
  getAudioMuted, setAudioMuted as persistMuted,
  getAudioSpeed, setAudioSpeed as persistSpeed,
} from '../../services/audioPreferences';

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
  const [volume, setVolume] = useState(() => getAudioVolume());
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(() => getAudioSpeed());
  const [isMuted, setIsMuted] = useState(() => getAudioMuted());
  const [playError, setPlayError] = useState<string | null>(null);

  const isPlayingRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollIntervalRef = useRef(1000); // start slow; switch to 100ms when playing
  const volumeBeforeMuteRef = useRef(getAudioVolume());
  const isLoopingRef = useRef(false);
  const volumeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speedDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setPlayError(null);

      try {
        const path = await invoke<string>('get_library_content_path', { tokenName, category });
        if (cancelled) return;

        const dur = await invoke<number>('audio_play', { path, volume });
        if (cancelled) { invoke('audio_stop').catch(() => {}); return; }

        // Immediately pause — we load but don't auto-play
        await invoke('audio_pause');

        // Apply persisted preferences
        if (getAudioMuted()) {
          invoke('audio_set_volume', { volume: 0.0 }).catch(() => {});
        }
        const savedSpeed = getAudioSpeed();
        if (savedSpeed !== 1.0) {
          invoke('audio_set_speed', { speed: savedSpeed }).catch(() => {});
        }

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
      if (volumeDebounceRef.current) clearTimeout(volumeDebounceRef.current);
      if (speedDebounceRef.current) clearTimeout(speedDebounceRef.current);
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
    persistVolume(clamped);
    persistMuted(false);
    if (volumeDebounceRef.current) clearTimeout(volumeDebounceRef.current);
    volumeDebounceRef.current = setTimeout(() => {
      invoke('audio_set_volume', { volume: clamped }).catch(() => {});
    }, 50);
  }, []);

  const toggleMute = useCallback(() => {
    if (isMuted) {
      // Unmute — restore previous volume
      setIsMuted(false);
      persistMuted(false);
      invoke('audio_set_volume', { volume: volumeBeforeMuteRef.current }).catch(() => {});
      setVolume(volumeBeforeMuteRef.current);
    } else {
      // Mute — save current volume and set to 0
      volumeBeforeMuteRef.current = volume;
      setIsMuted(true);
      persistMuted(true);
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
    persistSpeed(next);
    invoke('audio_set_speed', { speed: next }).catch(() => {});
  }, [playbackRate]);

  const setSpeed = useCallback((speed: number) => {
    const clamped = Math.round(Math.max(0.5, Math.min(2.0, speed)) * 20) / 20; // clamp + snap to 0.05
    setPlaybackRate(clamped);
    persistSpeed(clamped);
    if (speedDebounceRef.current) clearTimeout(speedDebounceRef.current);
    speedDebounceRef.current = setTimeout(() => {
      invoke('audio_set_speed', { speed: clamped }).catch(() => {});
    }, 50);
  }, []);

  const clearPlayError = useCallback(() => setPlayError(null), []);

  const mimeType = getMimeType(fileExtension);

  return {
    mimeType,
    state: {
      isReady, isPlaying, currentTime,
      duration: effectiveDuration,
      error, playError, isLooping, isMuted, volume, playbackRate,
    },
    actions: { play, pause, stop, skipBack, skipForward, seek, setVolume: handleSetVolume, toggleMute, toggleLoop, cycleSpeed, setSpeed, clearPlayError },
  };
}
