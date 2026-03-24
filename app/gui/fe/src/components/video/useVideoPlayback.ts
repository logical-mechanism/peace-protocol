import { useState, useRef, useCallback, useEffect } from 'react';
import { SPEED_OPTIONS, STALL_TIMEOUT_MS, CLICK_DEBOUNCE_MS, SKIP_SECONDS } from './videoConstants';
import type { VideoPlaybackResult } from './videoTypes';

export function useVideoPlayback(opts: { src: string }): VideoPlaybackResult {
  const { src } = opts;

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [pipSupported] = useState(() =>
    typeof document !== 'undefined' &&
    'pictureInPictureEnabled' in document &&
    (document as Document & { pictureInPictureEnabled: boolean }).pictureInPictureEnabled,
  );
  const [showCaptions, setShowCaptions] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset playback state when src changes (React "adjusting state during render" pattern)
  const [prevSrc, setPrevSrc] = useState(src);
  if (prevSrc !== src) {
    setPrevSrc(src);
    setPlaybackRate(1.0);
    setError(null);
    setLoading(true);
  }

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const isPlayingRef = useRef(false);
  const isSeekingRef = useRef(false);
  const vizTimeRef = useRef(0);
  const lastDrawTimeRef = useRef(0);
  const stalledTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track PiP state via video element events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onEnterPip = () => setIsPip(true);
    const onLeavePip = () => setIsPip(false);
    video.addEventListener('enterpictureinpicture', onEnterPip);
    video.addEventListener('leavepictureinpicture', onLeavePip);
    return () => {
      video.removeEventListener('enterpictureinpicture', onEnterPip);
      video.removeEventListener('leavepictureinpicture', onLeavePip);
    };
  }, []);

  // Cleanup media element when src changes
  useEffect(() => {
    const videoEl = videoRef.current;
    return () => {
      if (videoEl) {
        videoEl.pause();
      }
      if (stalledTimerRef.current) {
        clearTimeout(stalledTimerRef.current);
        stalledTimerRef.current = null;
      }
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
    };
  }, [src]);

  // Sync loop property
  useEffect(() => {
    if (videoRef.current) videoRef.current.loop = isLooping;
  }, [isLooping]);

  // --- Actions ---

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play(); else video.pause();
  }, []);

  const handleVideoClick = useCallback(() => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      handlePlayPause();
    }, CLICK_DEBOUNCE_MS);
  }, [handlePlayPause]);

  const cancelClickTimer = useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }, []);

  const handleSkipBack = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, video.currentTime - SKIP_SECONDS);
  }, []);

  const handleSkipForward = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(video.duration || 0, video.currentTime + SKIP_SECONDS);
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (videoRef.current) {
      videoRef.current.volume = v;
      videoRef.current.muted = v === 0;
    }
    setIsMuted(v === 0);
  }, []);

  const adjustVolume = useCallback((delta: number) => {
    setVolume(prev => {
      const v = Math.max(0, Math.min(1, prev + delta));
      if (videoRef.current) {
        videoRef.current.volume = v;
        videoRef.current.muted = v === 0;
      }
      setIsMuted(v === 0);
      return v;
    });
  }, []);

  const handleMuteToggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const newMuted = !isMuted;
    video.muted = newMuted;
    setIsMuted(newMuted);
  }, [isMuted]);

  const handleSpeedChange = useCallback(() => {
    const idx = SPEED_OPTIONS.indexOf(playbackRate as typeof SPEED_OPTIONS[number]);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    setPlaybackRate(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  }, [playbackRate]);

  const handleCaptionToggle = useCallback(() => {
    setShowCaptions(prev => {
      const next = !prev;
      const video = videoRef.current;
      if (video && video.textTracks.length > 0) {
        video.textTracks[0].mode = next ? 'showing' : 'hidden';
      }
      return next;
    });
  }, []);

  const handlePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('PiP not available:', err);
    }
  }, []);

  const updateCurrentTime = useCallback((t: number) => {
    setCurrentTime(t);
  }, []);

  const handleToggleLoop = useCallback(() => {
    setIsLooping(prev => {
      const next = !prev;
      if (videoRef.current) videoRef.current.loop = next;
      return next;
    });
  }, []);

  // --- Event handlers for <video> element ---

  const onLoadedMetadata = useCallback(() => {
    setLoading(false);
    if (videoRef.current) {
      const d = videoRef.current.duration;
      if (!isFinite(d) || d <= 0) {
        setError('This file contains no playable video data.');
        return;
      }
      setDuration(d);
    }
  }, []);

  const onError = useCallback(() => {
    setLoading(false);
    const mediaError = videoRef.current?.error;
    const detail = mediaError?.message || `error code ${mediaError?.code ?? 'unknown'}`;
    setError(`Playback failed: ${detail}`);
  }, []);

  const onTimeUpdate = useCallback(() => {
    const t = videoRef.current?.currentTime ?? 0;
    setCurrentTime(t);
    vizTimeRef.current = t;
  }, []);

  const onDurationChange = useCallback(() => {
    const d = videoRef.current?.duration ?? 0;
    if (isFinite(d) && d > 0) setDuration(d);
  }, []);

  const onCanPlay = useCallback(() => setLoading(false), []);
  const onWaiting = useCallback(() => setLoading(true), []);

  const onPlaying = useCallback(() => {
    setLoading(false);
    if (stalledTimerRef.current) {
      clearTimeout(stalledTimerRef.current);
      stalledTimerRef.current = null;
    }
  }, []);

  const onPlay = useCallback(() => {
    setIsPlaying(true);
    isPlayingRef.current = true;
    vizTimeRef.current = videoRef.current?.currentTime ?? 0;
    lastDrawTimeRef.current = performance.now();
  }, []);

  const onPause = useCallback(() => {
    setIsPlaying(false);
    isPlayingRef.current = false;
  }, []);

  const onEnded = useCallback(() => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    if (!isLooping && videoRef.current) {
      videoRef.current.currentTime = 0;
      vizTimeRef.current = 0;
    }
  }, [isLooping]);

  const onSeeked = useCallback(() => {
    const t = videoRef.current?.currentTime ?? 0;
    vizTimeRef.current = t;
  }, []);

  const onStalled = useCallback(() => {
    if (videoRef.current && videoRef.current.readyState < 2) {
      setLoading(true);
      if (stalledTimerRef.current) clearTimeout(stalledTimerRef.current);
      stalledTimerRef.current = setTimeout(() => {
        if (videoRef.current && videoRef.current.readyState < 2) {
          setLoading(false);
          setError('Video playback stalled. Your system may be missing required GStreamer plugins.');
        }
        stalledTimerRef.current = null;
      }, STALL_TIMEOUT_MS);
    }
  }, []);

  return {
    videoRef,
    isPlayingRef,
    isSeekingRef,
    vizTimeRef,
    lastDrawTimeRef,
    stalledTimerRef,
    state: {
      isPlaying,
      currentTime,
      duration,
      volume,
      isMuted,
      playbackRate,
      isLooping,
      isPip,
      pipSupported,
      showCaptions,
      loading,
      error,
    },
    actions: {
      handlePlayPause,
      handleVideoClick,
      handleSkipBack,
      handleSkipForward,
      handleVolumeChange,
      adjustVolume,
      handleMuteToggle,
      handleSpeedChange,
      handleToggleLoop,
      handleCaptionToggle,
      handlePip,
      cancelClickTimer,
      updateCurrentTime,
    },
    eventHandlers: {
      onLoadedMetadata,
      onError,
      onTimeUpdate,
      onDurationChange,
      onCanPlay,
      onWaiting,
      onPlaying,
      onPlay,
      onPause,
      onEnded,
      onSeeked,
      onStalled,
    },
  };
}
