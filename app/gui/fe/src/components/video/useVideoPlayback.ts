import { useState, useRef, useCallback, useEffect } from 'react';
import { SPEED_OPTIONS, STALL_TIMEOUT_MS, CLICK_DEBOUNCE_MS, SKIP_SECONDS } from './videoConstants';
import { getVideoVolume, setVideoVolume, getVideoMuted, setVideoMuted, getVideoSpeed, setVideoSpeed } from '../../services/videoPreferences';
import { getResumePosition, setResumePosition, clearResumePosition, normalizeVideoKey } from '../../services/videoResumeStorage';
import type { VideoPlaybackResult } from './videoTypes';

const RESUME_SAVE_INTERVAL_MS = 5000;

export function useVideoPlayback(opts: { src: string }): VideoPlaybackResult {
  const { src } = opts;

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => getVideoVolume());
  const [isMuted, setIsMuted] = useState(() => getVideoMuted());
  const [playbackRate, setPlaybackRate] = useState(() => getVideoSpeed());
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
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [isEnded, setIsEnded] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);

  // Reset playback state when src changes (React "adjusting state during render" pattern)
  const [prevSrc, setPrevSrc] = useState(src);
  if (prevSrc !== src) {
    setPrevSrc(src);
    setPlaybackRate(getVideoSpeed());
    setError(null);
    setLoading(true);
    setBufferedEnd(0);
    setIsEnded(false);
    setResumedFrom(null);
  }

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const isPlayingRef = useRef(false);
  const isSeekingRef = useRef(false);
  const vizTimeRef = useRef(0);
  const stalledTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastResumeSaveRef = useRef(0);
  const resumeIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeSeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Reload media element when src changes (required when using <source> child element)
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.load();
    }
  }, [src]);

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
      if (resumeIndicatorTimerRef.current) {
        clearTimeout(resumeIndicatorTimerRef.current);
        resumeIndicatorTimerRef.current = null;
      }
      if (resumeSeekTimerRef.current) {
        clearTimeout(resumeSeekTimerRef.current);
        resumeSeekTimerRef.current = null;
      }
      if (waitingTimerRef.current) {
        clearTimeout(waitingTimerRef.current);
        waitingTimerRef.current = null;
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

  const handleStop = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
    vizTimeRef.current = 0;
    setCurrentTime(0);
    setIsEnded(false);
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

  const handleSkip = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const newTime = video.currentTime + seconds;
    video.currentTime = seconds < 0
      ? Math.max(0, newTime)
      : Math.min(video.duration || Infinity, newTime);
  }, []);

  const handleReplay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    clearResumePosition(normalizeVideoKey(src));
    setError(null);
    setLoading(true);
    video.load();
    // Play after the element resets — onLoadedMetadata will fire first
    const onReady = () => {
      video.removeEventListener('loadedmetadata', onReady);
      video.play().catch(() => {});
    };
    video.addEventListener('loadedmetadata', onReady);
  }, [src]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    setVideoVolume(v);
    if (videoRef.current) {
      videoRef.current.volume = v;
      videoRef.current.muted = v === 0;
    }
    const muted = v === 0;
    setIsMuted(muted);
    setVideoMuted(muted);
  }, []);

  const adjustVolume = useCallback((delta: number) => {
    setVolume(prev => {
      const v = Math.max(0, Math.min(1, prev + delta));
      setVideoVolume(v);
      if (videoRef.current) {
        videoRef.current.volume = v;
        videoRef.current.muted = v === 0;
      }
      const muted = v === 0;
      setIsMuted(muted);
      setVideoMuted(muted);
      return v;
    });
  }, []);

  const handleMuteToggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const newMuted = !isMuted;
    video.muted = newMuted;
    setIsMuted(newMuted);
    setVideoMuted(newMuted);
  }, [isMuted]);

  const handleSpeedChange = useCallback(() => {
    const idx = SPEED_OPTIONS.indexOf(playbackRate as typeof SPEED_OPTIONS[number]);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    setPlaybackRate(next);
    setVideoSpeed(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  }, [playbackRate]);

  const setSpeed = useCallback((speed: number) => {
    setPlaybackRate(speed);
    setVideoSpeed(speed);
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, []);

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

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || 0, time));
    setCurrentTime(video.currentTime);
    vizTimeRef.current = video.currentTime;
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
      // Apply persisted playback rate to the video element
      const storedSpeed = getVideoSpeed();
      if (storedSpeed !== 1.0) {
        videoRef.current.playbackRate = storedSpeed;
      }
      // Resume from last position if available
      const key = normalizeVideoKey(src);
      const resumeTime = getResumePosition(key);
      if (resumeTime !== null && resumeTime < d) {
        videoRef.current.currentTime = resumeTime;
        vizTimeRef.current = resumeTime;
        setResumedFrom(resumeTime);
        // Auto-clear the resume indicator after 2s
        if (resumeIndicatorTimerRef.current) clearTimeout(resumeIndicatorTimerRef.current);
        resumeIndicatorTimerRef.current = setTimeout(() => {
          setResumedFrom(null);
          resumeIndicatorTimerRef.current = null;
        }, 2000);
        // Fallback: if the resume seek doesn't complete within 3s, give up and start from 0
        if (resumeSeekTimerRef.current) clearTimeout(resumeSeekTimerRef.current);
        resumeSeekTimerRef.current = setTimeout(() => {
          resumeSeekTimerRef.current = null;
          const video = videoRef.current;
          if (video && video.readyState < 3) {
            console.warn('[VideoPlayer] Resume seek timed out, falling back to start');
            clearResumePosition(key);
            video.currentTime = 0;
            vizTimeRef.current = 0;
            setCurrentTime(0);
            setResumedFrom(null);
            setLoading(false);
            setError(null);
          }
        }, 3000);
      }
    }
  }, [src]);

  const onError = useCallback(() => {
    setLoading(false);
    const mediaError = videoRef.current?.error;
    const detail = mediaError?.message || `error code ${mediaError?.code ?? 'unknown'}`;
    setError(`Playback failed: ${detail}`);
  }, []);

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    const t = video?.currentTime ?? 0;
    setCurrentTime(t);
    vizTimeRef.current = t;
    // Throttled resume position save
    if (video && video.duration > 0) {
      const now = Date.now();
      if (now - lastResumeSaveRef.current >= RESUME_SAVE_INTERVAL_MS) {
        lastResumeSaveRef.current = now;
        setResumePosition(normalizeVideoKey(src), t, video.duration);
      }
    }
  }, [src]);

  const onDurationChange = useCallback(() => {
    const d = videoRef.current?.duration ?? 0;
    if (isFinite(d) && d > 0) setDuration(d);
  }, []);

  const onCanPlay = useCallback(() => {
    if (waitingTimerRef.current) {
      clearTimeout(waitingTimerRef.current);
      waitingTimerRef.current = null;
    }
    setLoading(false);
  }, []);

  const onWaiting = useCallback(() => {
    if (isSeekingRef.current) return;
    // Debounce: only show loading overlay if buffering persists for 300ms.
    // Brief rebuffering (e.g. pause→play) resolves before the timer fires.
    if (waitingTimerRef.current) clearTimeout(waitingTimerRef.current);
    waitingTimerRef.current = setTimeout(() => {
      waitingTimerRef.current = null;
      setLoading(true);
    }, 300);
  }, []);

  const onPlaying = useCallback(() => {
    if (waitingTimerRef.current) {
      clearTimeout(waitingTimerRef.current);
      waitingTimerRef.current = null;
    }
    setLoading(false);
    if (stalledTimerRef.current) {
      clearTimeout(stalledTimerRef.current);
      stalledTimerRef.current = null;
    }
    if (resumeSeekTimerRef.current) {
      clearTimeout(resumeSeekTimerRef.current);
      resumeSeekTimerRef.current = null;
    }
  }, []);

  const onPlay = useCallback(() => {
    setIsPlaying(true);
    isPlayingRef.current = true;
    setIsEnded(false);
    setResumedFrom(null);
    vizTimeRef.current = videoRef.current?.currentTime ?? 0;
  }, []);

  const onPause = useCallback(() => {
    setIsPlaying(false);
    isPlayingRef.current = false;
  }, []);

  const onEnded = useCallback(() => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    if (!isLooping && videoRef.current) {
      setIsEnded(true);
      clearResumePosition(normalizeVideoKey(src));
      videoRef.current.currentTime = 0;
      vizTimeRef.current = 0;
    }
  }, [isLooping, src]);

  const onSeeked = useCallback(() => {
    const t = videoRef.current?.currentTime ?? 0;
    vizTimeRef.current = t;
    if (waitingTimerRef.current) {
      clearTimeout(waitingTimerRef.current);
      waitingTimerRef.current = null;
    }
    setLoading(false);
    // Clear resume fallback timer — seek succeeded
    if (resumeSeekTimerRef.current) {
      clearTimeout(resumeSeekTimerRef.current);
      resumeSeekTimerRef.current = null;
    }
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

  const onProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.buffered.length) return;
    // Find the buffered range containing or nearest to current playback position
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) >= video.currentTime) {
        setBufferedEnd(video.buffered.end(i));
        return;
      }
    }
    // Fallback: use the last buffered range end
    setBufferedEnd(video.buffered.end(video.buffered.length - 1));
  }, []);

  return {
    videoRef,
    isPlayingRef,
    isSeekingRef,
    vizTimeRef,
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
      bufferedEnd,
      isEnded,
      isSeeking,
      resumedFrom,
    },
    actions: {
      handlePlayPause,
      handleStop,
      handleVideoClick,
      handleSkipBack,
      handleSkipForward,
      handleSkip,
      handleVolumeChange,
      adjustVolume,
      handleMuteToggle,
      handleSpeedChange,
      handleToggleLoop,
      handleCaptionToggle,
      handlePip,
      cancelClickTimer,
      updateCurrentTime,
      handleReplay,
      seekTo,
      setSpeed,
      setIsSeeking,
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
      onProgress,
    },
  };
}
