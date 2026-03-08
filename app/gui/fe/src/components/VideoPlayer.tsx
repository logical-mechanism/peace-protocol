import { useState, useEffect, useRef, useCallback } from 'react';
import { DelayedSpinner } from './LoadingSpinner';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface VideoPlayerProps {
  /** Direct URL to the video file (asset:// protocol from Tauri convertFileSrc). */
  src: string;
  mimeType: string;
  fileExtension: string;
  onExport?: () => void;
  /** Direct URL to the subtitle file (asset:// protocol), or null if none. */
  subtitleUrl?: string | null;
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function getConversionHint(ext: string): string | null {
  const hints: Record<string, string> = {
    '.mkv': 'Try converting with: ffmpeg -i file.mkv -c copy output.mp4',
    '.avi': 'Try converting with: ffmpeg -i file.avi -c copy output.mp4',
    '.webm': 'Try converting with: ffmpeg -i file.webm -c:v libx264 -c:a aac output.mp4',
    '.flv': 'Try converting with: ffmpeg -i file.flv -c copy output.mp4',
    '.wmv': 'Try converting with: ffmpeg -i file.wmv -c:v libx264 -c:a aac output.mp4',
    '.mov': 'Try converting with: ffmpeg -i file.mov -c copy output.mp4',
    '.ts': 'Try converting with: ffmpeg -i file.ts -c copy output.mp4',
    '.mp4': 'MP4 is widely supported. The file may be corrupted or use an uncommon codec.',
  };
  return hints[ext.toLowerCase()] ?? null;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function VideoPlayer({ src, mimeType, fileExtension, onExport, subtitleUrl: subtitleUrlProp }: VideoPlayerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenVisible, setFullscreenVisible] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const [showKeyHints, setShowKeyHints] = useState(false);
  // Interpolated time for smooth seek bar (updated at 60fps via rAF)
  const [displayTime, setDisplayTime] = useState(0);
  const [showRemaining, setShowRemaining] = useState(false);
  // Screen reader announcement for volume/speed changes via keyboard
  const [controlAnnouncement, setControlAnnouncement] = useState('');

  // Reset playback state when src changes (React "adjusting state during render" pattern)
  const [prevSrc, setPrevSrc] = useState(src);
  if (prevSrc !== src) {
    setPrevSrc(src);
    setPlaybackRate(1.0);
    setError(null);
    setLoading(true);
  }

  const videoRef = useRef<HTMLVideoElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const seekBarTooltipRef = useRef<HTMLDivElement>(null);
  const hasShownHints = useRef(false);
  const keyHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSeekingRef = useRef(false);
  const stalledTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Smooth time interpolation — video.currentTime updates ~4Hz on WebKitGTK,
  // we interpolate between updates for fluid seek bar movement
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullscreenEnteredAtRef = useRef(0);
  const vizTimeRef = useRef(0);
  const lastDrawTimeRef = useRef(0);
  const rafRef = useRef<number>(0);
  const isPlayingRef = useRef(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Trap focus within fullscreen overlay
  useFocusTrap(fullscreenRef, isFullscreen);

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
  }, []); // Element ref doesn't change; listeners persist across src changes

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

  // Drive fullscreen opacity transition
  useEffect(() => {
    // Trigger on next frame so the CSS transition fires
    const id = requestAnimationFrame(() => setFullscreenVisible(isFullscreen));
    return () => cancelAnimationFrame(id);
  }, [isFullscreen]);

  // Auto-hide controls after inactivity in fullscreen
  useEffect(() => {
    if (!isFullscreen) {
      queueMicrotask(() => setControlsVisible(true));
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
      return;
    }

    fullscreenEnteredAtRef.current = Date.now();

    const resetTimer = () => {
      setControlsVisible(true);
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
      // Don't hide while seeking or paused
      if (isSeekingRef.current || !isPlayingRef.current) return;
      // Longer delay during the first 3s after entering fullscreen so controls don't vanish immediately
      const elapsed = Date.now() - fullscreenEnteredAtRef.current;
      const delay = elapsed < 3000 ? 5000 : 3000;
      autoHideTimerRef.current = setTimeout(() => setControlsVisible(false), delay);
    };

    // Initial show + auto-hide setup (deferred to avoid synchronous setState in effect)
    const id = requestAnimationFrame(() => resetTimer());

    const handleMouseMove = () => resetTimer();
    const handleKeyDown = () => resetTimer();

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('keydown', handleKeyDown);
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    };
  }, [isFullscreen, isPlaying]);

  // Escape key closes fullscreen (not the parent modal)
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setIsFullscreen(false);
      }
    };
    // Use capture phase so we intercept before the modal's escape handler
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isFullscreen]);

  const handleLoadedMetadata = useCallback(() => {
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

  const handleError = useCallback(() => {
    setLoading(false);
    const mediaError = videoRef.current?.error;
    const detail = mediaError?.message || `error code ${mediaError?.code ?? 'unknown'}`;
    setError(`Playback failed: ${detail}`);
  }, []);

  // --- Playback handlers ---

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play(); else video.pause();
  }, []);

  const handleVideoClick = useCallback(() => {
    // Delay play/pause to distinguish from double-click
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      handlePlayPause();
    }, 200);
  }, [handlePlayPause]);

  const handleVideoDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    setIsFullscreen(fs => !fs);
  }, []);

  const handleSeekMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const bar = seekBarRef.current;
    if (!video || !bar || !duration) return;
    isSeekingRef.current = true;

    const seekTo = (clientX: number) => {
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      video.currentTime = ratio * duration;
      setCurrentTime(video.currentTime);
      vizTimeRef.current = video.currentTime;
      setDisplayTime(video.currentTime);
    };

    seekTo(e.clientX);

    const handleMouseMove = (moveE: MouseEvent) => {
      if (!isSeekingRef.current) return;
      seekTo(moveE.clientX);
    };

    const handleMouseUp = () => {
      isSeekingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [duration]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (videoRef.current) {
      videoRef.current.volume = v;
      videoRef.current.muted = v === 0;
    }
    setIsMuted(v === 0);
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
    setControlAnnouncement(`Speed ${next}x`);
  }, [playbackRate]);

  const handleSkipBack = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, video.currentTime - 5);
  }, []);

  const handleSkipForward = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
  }, []);

  const showSeekTooltip = useCallback((clientX: number) => {
    const tooltip = seekBarTooltipRef.current;
    const container = seekBarRef.current;
    if (!tooltip || !container || !duration) return;
    const rect = container.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    tooltip.textContent = formatTime(ratio * duration);
    const halfW = tooltip.offsetWidth / 2;
    const rawLeft = clientX - rect.left;
    const clampedLeft = Math.max(halfW, Math.min(rect.width - halfW, rawLeft));
    tooltip.style.left = `${clampedLeft}px`;
    tooltip.style.opacity = '1';
  }, [duration]);

  const hideSeekTooltip = useCallback(() => {
    const tooltip = seekBarTooltipRef.current;
    if (tooltip) tooltip.style.opacity = '0';
  }, []);

  const handleSeekBarMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    showSeekTooltip(e.clientX);
  }, [duration, showSeekTooltip]);

  const handleSeekBarMouseLeave = useCallback(() => {
    hideSeekTooltip();
  }, [hideSeekTooltip]);

  const handleSeekKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || !duration) return;

    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':
        video.currentTime = Math.max(0, video.currentTime - 5);
        break;
      case 'ArrowRight':
        video.currentTime = Math.min(duration, video.currentTime + 5);
        break;
      case 'Home':
        video.currentTime = 0;
        break;
      case 'End':
        video.currentTime = duration;
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      setCurrentTime(video.currentTime);
      vizTimeRef.current = video.currentTime;
      setDisplayTime(video.currentTime);
    }
  }, [duration]);

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

  const handleToggleLoop = useCallback(() => {
    setIsLooping(prev => {
      const next = !prev;
      if (videoRef.current) videoRef.current.loop = next;
      return next;
    });
  }, []);

  // Sync loop property
  useEffect(() => {
    if (videoRef.current) videoRef.current.loop = isLooping;
  }, [isLooping]);

  // Smooth seek bar interpolation at 60fps between ~4Hz timeupdate events
  useEffect(() => {
    if (!isPlaying) {
      lastDrawTimeRef.current = 0;
      return;
    }
    let running = true;
    const loop = () => {
      if (!running) return;
      const now = performance.now();
      if (lastDrawTimeRef.current > 0) {
        vizTimeRef.current += (now - lastDrawTimeRef.current) / 1000 * playbackRate;
        // Clamp to duration to avoid overshooting
        if (duration > 0) vizTimeRef.current = Math.min(vizTimeRef.current, duration);
      }
      lastDrawTimeRef.current = now;
      setDisplayTime(vizTimeRef.current);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, playbackRate, duration]);

  // Keyboard shortcuts (bubbling phase — Escape handled separately in capture phase)
  useEffect(() => {
    if (!src) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      // Show key hints on first keyboard interaction
      if (!hasShownHints.current) {
        hasShownHints.current = true;
        setShowKeyHints(true);
        keyHintTimerRef.current = setTimeout(() => setShowKeyHints(false), 3000);
      }

      switch (e.key) {
        case '?':
        case 'h':
        case 'H':
          // Toggle key hints with 3s auto-dismiss
          if (keyHintTimerRef.current) clearTimeout(keyHintTimerRef.current);
          setShowKeyHints(prev => {
            if (!prev) {
              keyHintTimerRef.current = setTimeout(() => setShowKeyHints(false), 3000);
            }
            return !prev;
          });
          break;
        case ' ':
          e.preventDefault();
          handlePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleSkipBack();
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleSkipForward();
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume(prev => {
            const v = Math.min(1, prev + 0.1);
            if (videoRef.current) { videoRef.current.volume = v; videoRef.current.muted = false; }
            setIsMuted(false);
            setControlAnnouncement(`Volume ${Math.round(v * 100)}%`);
            return v;
          });
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(prev => {
            const v = Math.max(0, prev - 0.1);
            if (videoRef.current) { videoRef.current.volume = v; videoRef.current.muted = v === 0; }
            setIsMuted(v === 0);
            setControlAnnouncement(v === 0 ? 'Muted' : `Volume ${Math.round(v * 100)}%`);
            return v;
          });
          break;
        case 'f':
        case 'F':
          setIsFullscreen(fs => !fs);
          break;
        case 'm':
        case 'M':
          handleMuteToggle();
          break;
        case 'l':
        case 'L':
          handleToggleLoop();
          break;
        case 'c':
        case 'C':
          if (subtitleUrlProp) handleCaptionToggle();
          break;
        case 't':
        case 'T':
          setShowRemaining(r => !r);
          break;
        case 's':
        case 'S':
          handleSpeedChange();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [src, handlePlayPause, handleSkipBack, handleSkipForward, handleMuteToggle, handleToggleLoop, handleSpeedChange, subtitleUrlProp, handleCaptionToggle]);

  // --- Error state ---

  if (error) {
    return (
      <div role="alert" className="p-6 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-center space-y-3">
        <svg className="w-8 h-8 mx-auto mb-2 text-[var(--error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        <p className="text-sm font-medium text-[var(--error)]">Failed to play video</p>
        <p className="text-xs text-[var(--text-muted)]">
          {error}
        </p>

        {/* Diagnostic info */}
        <div className="flex items-center justify-center gap-3 text-xs text-[var(--text-muted)]">
          <span>Format: <span className="font-mono text-[var(--text-secondary)]">{fileExtension.toUpperCase().replace('.', '')}</span></span>
          <span className="text-[var(--border-subtle)]">|</span>
          <span>MIME: <span className="font-mono text-[var(--text-secondary)]">{mimeType}</span></span>
        </div>

        {/* Conversion hint */}
        {getConversionHint(fileExtension) && (
          <p className="text-xs font-mono text-[var(--text-muted)] bg-[var(--bg-tertiary)] rounded-[var(--radius-sm)] px-3 py-1.5 max-w-md mx-auto">
            {getConversionHint(fileExtension)}
          </p>
        )}

        {/* Inline Save As button */}
        {onExport ? (
          <button
            onClick={onExport}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Save As
          </button>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">
            Use Save As to open it with an external player.
          </p>
        )}
      </div>
    );
  }

  // --- Control bar ---

  const btnClass = "px-2 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] btn-base btn-icon outline-none focus-visible:shadow-[var(--focus-ring)]";
  const divider = <div className="w-px h-5 bg-[var(--border-subtle)] flex-shrink-0" />;

  const controlBar = (
    <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-md)]">
      {/* Screen reader status */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {error ? 'Error' : loading ? 'Loading' : isPlaying ? 'Playing' : 'Paused'}
      </span>
      {/* Screen reader announcement for volume/speed changes */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {controlAnnouncement}
      </span>
      {/* Play/Pause */}
      <button onClick={handlePlayPause} className={btnClass} title={isPlaying ? 'Pause (Space)' : 'Play (Space)'} aria-label={isPlaying ? 'Pause' : 'Play'} aria-pressed={isPlaying}>
        {isPlaying ? (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Skip Back */}
      <button onClick={handleSkipBack} className={btnClass} title="Back 5s (←)" aria-label="Skip back 5 seconds">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
        </svg>
      </button>

      {/* Skip Forward */}
      <button onClick={handleSkipForward} className={btnClass} title="Forward 5s (→)" aria-label="Skip forward 5 seconds">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
        </svg>
      </button>

      {/* Time */}
      <div
        className="text-xs font-mono text-[var(--text-muted)] min-w-[85px] text-center select-none cursor-pointer"
        onClick={() => setShowRemaining(r => !r)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowRemaining(r => !r); } }}
        role="button"
        tabIndex={0}
        title="Click to toggle remaining time (T)"
        aria-label={showRemaining ? 'Showing remaining time, click for total' : 'Showing total time, click for remaining'}
      >
        {formatTime(displayTime)} / {showRemaining ? `\u2212${formatTime(Math.max(0, duration - displayTime))}` : formatTime(duration)}
      </div>

      {/* Seek bar — outer wrapper expands click target while visual bar stays h-1.5 */}
      <div
        className={`flex-1 py-2 cursor-pointer relative min-w-[60px] ${!duration ? 'opacity-50 pointer-events-none' : ''}`}
        onMouseDown={handleSeekMouseDown}
        onMouseMove={handleSeekBarMouseMove}
        onMouseLeave={handleSeekBarMouseLeave}
        onKeyDown={handleSeekKeyDown}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext={formatTime(currentTime)}
        aria-disabled={!duration || undefined}
      >
        {/* Seek tooltip */}
        <div
          ref={seekBarTooltipRef}
          className="absolute -top-7 text-xs font-mono text-[var(--text-primary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 pointer-events-none opacity-0 transition-opacity duration-75"
          style={{ transform: 'translateX(-50%)' }}
        />
        <div
          ref={seekBarRef}
          className="h-1.5 bg-[var(--bg-secondary)] rounded-full relative border border-[var(--border-subtle)]"
        >
          <div
            className="absolute inset-y-0 left-0 bg-[var(--accent)] rounded-full"
            style={{ width: `${duration > 0 ? (displayTime / duration) * 100 : 0}%` }}
          />
          {/* Seek thumb */}
          <div
            className="absolute top-1/2 w-3 h-3 rounded-full bg-[var(--bg-elevated)] border-2 border-[var(--accent)]/60 shadow-sm pointer-events-none"
            style={{ left: `${duration > 0 ? (displayTime / duration) * 100 : 0}%`, transform: 'translateX(-50%) translateY(-50%)' }}
          />
        </div>
      </div>

      {divider}

      {/* Volume */}
      <button onClick={handleMuteToggle} className={btnClass} title={isMuted ? 'Unmute (M)' : 'Mute (M)'} aria-label={isMuted ? 'Unmute' : 'Mute'} aria-pressed={isMuted}>
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          {isMuted || volume === 0 ? (
            <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
          ) : volume < 0.5 ? (
            <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
          ) : (
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
          )}
        </svg>
      </button>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={isMuted ? 0 : volume}
        onChange={handleVolumeChange}
        className="w-16 accent-[var(--accent)]"
        aria-label="Volume"
        aria-valuenow={isMuted ? 0 : Math.round(volume * 100)}
        aria-valuetext={isMuted ? 'Muted' : `${Math.round(volume * 100)}%`}
      />

      {divider}

      {/* CC / Subtitles — always visible, disabled when no subtitles for discoverability */}
      <button
        onClick={subtitleUrlProp ? handleCaptionToggle : undefined}
        className={`${btnClass} font-bold text-xs ${!subtitleUrlProp ? 'opacity-50 cursor-not-allowed' : showCaptions ? 'text-[var(--accent)]' : ''}`}
        title={!subtitleUrlProp ? 'No subtitles available' : showCaptions ? 'Hide subtitles (C)' : 'Show subtitles (C)'}
        aria-label={!subtitleUrlProp ? 'Subtitles unavailable' : showCaptions ? 'Hide subtitles' : 'Show subtitles'}
        aria-pressed={subtitleUrlProp ? showCaptions : undefined}
        aria-disabled={!subtitleUrlProp || undefined}
        disabled={!subtitleUrlProp}
      >
        CC
      </button>

      {/* Loop */}
      <button
        onClick={handleToggleLoop}
        className={`${btnClass} ${isLooping ? 'text-[var(--accent)]' : ''}`}
        title={isLooping ? 'Repeat: On (L)' : 'Repeat: Off (L)'}
        aria-label={isLooping ? 'Disable repeat' : 'Enable repeat'}
        aria-pressed={isLooping}
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
        </svg>
      </button>

      {/* Speed */}
      <button
        onClick={handleSpeedChange}
        className={`${btnClass} min-w-[42px] text-center font-mono`}
        title="Playback speed"
        aria-label={`Playback speed: ${playbackRate}x`}
      >
        {playbackRate}x
      </button>

      {/* PiP */}
      {pipSupported && (
        <button onClick={handlePip} className={btnClass} title={isPip ? 'Exit Picture-in-Picture' : 'Picture-in-Picture'} aria-label={isPip ? 'Exit Picture-in-Picture' : 'Enter Picture-in-Picture'} aria-pressed={isPip}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="2" y="3" width="20" height="14" rx="2" strokeWidth={2} />
            <rect x="11" y="9" width="9" height="6" rx="1" strokeWidth={2} fill="currentColor" opacity={0.3} />
          </svg>
        </button>
      )}

      {divider}

      {/* Fullscreen */}
      <button
        onClick={() => setIsFullscreen(fs => !fs)}
        className={`${btnClass} ${isFullscreen ? 'text-[var(--accent)]' : ''}`}
        title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        aria-pressed={isFullscreen}
      >
        {isFullscreen ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9L4 4m0 0v4m0-4h4m7 5l5-5m0 0v4m0-4h-4m-7 7l-5 5m0 0v-4m0 4h4m7-5l5 5m0 0v-4m0 4h-4" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0 0l-5-5m-7 14l-5 5m0 0h4m-4 0v-4m16 4l-5-5m5 5v-4m0 4h-4" />
          </svg>
        )}
      </button>
    </div>
  );

  const keyHintsOverlay = showKeyHints ? (
    <div className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-[var(--bg-elevated)]/90 text-[var(--text-primary)] text-xs rounded-[var(--radius-md)] px-4 py-3 pointer-events-none z-10 whitespace-nowrap transition-opacity duration-[var(--transition-slow)] border border-[var(--border-subtle)]">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">Space</kbd> Play/Pause</span>
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">F</kbd> Fullscreen</span>
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">&larr; &rarr;</kbd> Seek &plusmn;5s</span>
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">M</kbd> Mute</span>
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">&uarr; &darr;</kbd> Volume</span>
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">L</kbd> Loop</span>
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">S</kbd> Speed</span>
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">T</kbd> Time</span>
        {subtitleUrlProp && <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">C</kbd> Captions</span>}
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">?</kbd> Show hints</span>
      </div>
    </div>
  ) : null;

  const videoElement = (
    <video
      ref={videoRef}
      src={src}
      preload="metadata"
      className={isFullscreen
        ? "max-w-full max-h-full cursor-pointer"
        : "max-w-full max-h-[500px] cursor-pointer"
      }
      onLoadedMetadata={handleLoadedMetadata}
      onError={handleError}
      onTimeUpdate={() => {
        const t = videoRef.current?.currentTime ?? 0;
        setCurrentTime(t);
        vizTimeRef.current = t;
      }}
      onDurationChange={() => {
        const d = videoRef.current?.duration ?? 0;
        if (isFinite(d) && d > 0) setDuration(d);
      }}
      onWaiting={() => setLoading(true)}
      onPlaying={() => {
        setLoading(false);
        if (stalledTimerRef.current) {
          clearTimeout(stalledTimerRef.current);
          stalledTimerRef.current = null;
        }
      }}
      onPlay={() => {
        setIsPlaying(true);
        isPlayingRef.current = true;
        vizTimeRef.current = videoRef.current?.currentTime ?? 0;
        lastDrawTimeRef.current = performance.now();
      }}
      onPause={() => {
        setIsPlaying(false);
        isPlayingRef.current = false;
      }}
      onEnded={() => {
        setIsPlaying(false);
        isPlayingRef.current = false;
        if (!isLooping && videoRef.current) {
          videoRef.current.currentTime = 0;
          vizTimeRef.current = 0;
          setDisplayTime(0);
        }
      }}
      onSeeked={() => {
        const t = videoRef.current?.currentTime ?? 0;
        vizTimeRef.current = t;
        setDisplayTime(t);
      }}
      onStalled={() => {
        if (videoRef.current && videoRef.current.readyState < 2) {
          setLoading(true);
          if (stalledTimerRef.current) clearTimeout(stalledTimerRef.current);
          stalledTimerRef.current = setTimeout(() => {
            if (videoRef.current && videoRef.current.readyState < 2) {
              setLoading(false);
              setError('Video playback stalled. Your system may be missing required GStreamer plugins.');
            }
            stalledTimerRef.current = null;
          }, 5000);
        }
      }}
      onClick={handleVideoClick}
      onDoubleClick={handleVideoDoubleClick}
    >
      {subtitleUrlProp && (
        <track
          kind="subtitles"
          src={subtitleUrlProp}
          srcLang="und"
          label="Subtitles"
          default={showCaptions}
        />
      )}
    </video>
  );

  // Single return path — video element stays at the same React tree position
  // regardless of fullscreen state, preventing unmount/remount that loses playback.
  return (
    <div className="space-y-3">
      {isFullscreen && (
        <div className="p-4 text-center text-sm text-[var(--text-muted)]">
          Video is expanded to fullscreen. Press Esc or the collapse button to return.
        </div>
      )}

      <div
        ref={fullscreenRef}
        className={isFullscreen
          ? `fixed inset-0 z-[60] flex flex-col bg-[var(--bg-primary)] transition-opacity duration-200 ${fullscreenVisible ? 'opacity-100' : 'opacity-0'}`
          : 'contents'
        }
        style={isFullscreen ? { cursor: controlsVisible ? 'auto' : 'none' } : undefined}
      >
        {/* Video content area */}
        <div
          className={isFullscreen
            ? 'flex-1 overflow-auto flex items-center justify-center p-4 bg-[var(--bg-secondary)] relative'
            : 'flex items-center justify-center overflow-auto max-h-[500px] bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-2 relative'
          }
        >
          {loading && (
            <div className="py-12 text-center">
              <DelayedSpinner size="lg" className="mx-auto mb-4" />
              <p className="text-sm text-[var(--text-muted)]">Loading video...</p>
            </div>
          )}
          {videoElement}
          {isFullscreen ? controlsVisible && keyHintsOverlay : keyHintsOverlay}
        </div>

        {/* Control bar — auto-hides in fullscreen after inactivity */}
        <div
          className={isFullscreen
            ? `flex-shrink-0 px-4 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-card)] transition-[opacity,transform] duration-300 ${controlsVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-full'}`
            : ''
          }
        >
          {controlBar}
        </div>
      </div>
    </div>
  );
}
