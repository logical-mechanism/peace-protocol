import { useState, useEffect, useRef, useCallback } from 'react';
import { DelayedSpinner } from './LoadingSpinner';

interface VideoPlayerProps {
  data: Uint8Array;
  mimeType: string;
  fileExtension: string;
  onExport?: () => void;
  subtitleData?: Uint8Array | null;
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/** Try to remux an unsupported container to MP4 via ffmpeg.wasm (lazy-loaded). */
async function remuxToMp4(
  data: Uint8Array,
  inputName: string,
  onProgress?: (event: { progress: number; time: number }) => void,
): Promise<Uint8Array> {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const { toBlobURL } = await import('@ffmpeg/util');

  const ffmpeg = new FFmpeg();

  // Load the single-threaded WASM core from CDN via blob URLs
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  if (onProgress) ffmpeg.on('progress', onProgress);

  await ffmpeg.writeFile(inputName, data);
  await ffmpeg.exec(['-i', inputName, '-c', 'copy', 'output.mp4']);
  const output = await ffmpeg.readFile('output.mp4');

  if (onProgress) ffmpeg.off('progress', onProgress);
  await ffmpeg.terminate();

  if (output instanceof Uint8Array) return output;
  // readFile can return a string for text files; shouldn't happen for video
  throw new Error('Unexpected output type from ffmpeg');
}

export default function VideoPlayer({ data, mimeType, fileExtension, onExport, subtitleData }: VideoPlayerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [remuxing, setRemuxing] = useState(false);
  const [remuxProgress, setRemuxProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [pipSupported, setPipSupported] = useState(false);
  const [showCaptions, setShowCaptions] = useState(false);
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);

  const [showKeyHints, setShowKeyHints] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const hasShownHints = useRef(false);

  // PiP feature detection
  useEffect(() => {
    setPipSupported(
      typeof document !== 'undefined' &&
      'pictureInPictureEnabled' in document &&
      (document as Document & { pictureInPictureEnabled: boolean }).pictureInPictureEnabled,
    );
  }, []);

  // Create Blob URL for subtitle track
  useEffect(() => {
    if (!subtitleData || subtitleData.length === 0) {
      setSubtitleUrl(null);
      return;
    }
    // Convert SRT to VTT if needed (WebVTT is required for <track>)
    let blob: Blob;
    const text = new TextDecoder().decode(subtitleData);
    if (!text.trimStart().startsWith('WEBVTT')) {
      // Simple SRT → VTT conversion: add WEBVTT header, replace comma with dot in timestamps
      const vtt = 'WEBVTT\n\n' + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
      blob = new Blob([vtt], { type: 'text/vtt' });
    } else {
      blob = new Blob([subtitleData as BlobPart], { type: 'text/vtt' });
    }
    const url = URL.createObjectURL(blob);
    setSubtitleUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [subtitleData]);

  // Probe whether the browser can play the blob directly; if not, remux.
  useEffect(() => {
    let cancelled = false;
    let currentUrl: string | null = null;
    const videoEl = videoRef.current;

    const revokeUrl = () => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
        currentUrl = null;
      }
    };

    // Reset playback state on new data
    setPlaybackRate(1.0);
    setRemuxProgress(0);

    (async () => {
      // First attempt: create blob URL and see if a probe <video> can play it
      const blob = new Blob([new Uint8Array(data)], { type: mimeType });
      const url = URL.createObjectURL(blob);
      currentUrl = url;

      const canPlay = await new Promise<boolean>((resolve) => {
        const probe = document.createElement('video');
        probe.preload = 'metadata';
        probe.muted = true;
        let resolved = false;
        const timeout = setTimeout(() => { cleanup(); resolve(false); }, 8000);
        const cleanup = () => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          probe.removeAttribute('src');
          probe.load();
        };
        probe.addEventListener('loadedmetadata', () => { cleanup(); resolve(true); }, { once: true });
        probe.addEventListener('error', () => { cleanup(); resolve(false); }, { once: true });
        probe.src = url;
      });

      if (cancelled) { revokeUrl(); return; }

      if (canPlay) {
        setBlobUrl(url);
        return;
      }

      // The browser can't play this format natively — try remuxing
      revokeUrl();
      setRemuxing(true);
      setRemuxProgress(0);

      try {
        const inputName = `input${fileExtension}`;
        const mp4Bytes = await remuxToMp4(new Uint8Array(data), inputName, (evt) => {
          if (!cancelled) setRemuxProgress(Math.max(0, Math.min(1, evt.progress)));
        });
        if (cancelled) return;
        const mp4Blob = new Blob([mp4Bytes as BlobPart], { type: 'video/mp4' });
        const mp4Url = URL.createObjectURL(mp4Blob);
        currentUrl = mp4Url;
        setBlobUrl(mp4Url);
      } catch {
        if (cancelled) return;
        setError('This video format could not be converted for in-app playback.');
        setLoading(false);
      } finally {
        if (!cancelled) {
            setRemuxing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (videoEl) {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
      }
      revokeUrl();
    };
  }, [data, mimeType, fileExtension]);

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
      if (isFinite(d) && d > 0) setDuration(d);
    }
  }, []);

  const handleError = useCallback(() => {
    setLoading(false);
    setError('The video could not be played.');
  }, []);

  // --- Playback handlers ---

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play(); else video.pause();
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const bar = seekBarRef.current;
    if (!video || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = ratio * duration;
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

  // Keyboard shortcuts (bubbling phase — Escape handled separately in capture phase)
  useEffect(() => {
    if (!blobUrl) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      // Show key hints on first keyboard interaction
      if (!hasShownHints.current) {
        hasShownHints.current = true;
        setShowKeyHints(true);
        setTimeout(() => setShowKeyHints(false), 3000);
      }

      switch (e.key) {
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
            return v;
          });
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(prev => {
            const v = Math.max(0, prev - 0.1);
            if (videoRef.current) { videoRef.current.volume = v; videoRef.current.muted = v === 0; }
            setIsMuted(v === 0);
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
        case 'c':
        case 'C':
          if (subtitleUrl) handleCaptionToggle();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [blobUrl, handlePlayPause, handleSkipBack, handleSkipForward, handleMuteToggle, subtitleUrl, handleCaptionToggle]);

  // --- Error state ---

  if (error) {
    return (
      <div className="p-6 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-center space-y-3">
        <svg className="w-8 h-8 mx-auto mb-2 text-[var(--error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        <p className="text-sm font-medium text-[var(--error)]">Failed to play video</p>
        <p className="text-xs text-[var(--text-muted)]">
          This video format could not be converted for in-app playback.
        </p>

        {/* Diagnostic info */}
        <div className="flex items-center justify-center gap-3 text-xs text-[var(--text-muted)]">
          <span>Format: <span className="font-mono text-[var(--text-secondary)]">{fileExtension.toUpperCase().replace('.', '')}</span></span>
          <span className="text-[var(--border-subtle)]">|</span>
          <span>MIME: <span className="font-mono text-[var(--text-secondary)]">{mimeType}</span></span>
        </div>

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

  // --- Remuxing progress ---

  if (remuxing) {
    return (
      <div className="py-12 text-center space-y-4">
        <DelayedSpinner size="lg" className="mx-auto" />
        <p className="text-sm text-[var(--text-muted)]">Converting for playback...</p>
        <div className="mx-auto max-w-xs">
          <div className="h-1.5 bg-[var(--bg-secondary)] rounded-full overflow-hidden border border-[var(--border-subtle)]">
            <div
              className="h-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${Math.round(remuxProgress * 100)}%` }}
            />
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-2">
            {Math.round(remuxProgress * 100)}%
          </p>
        </div>
      </div>
    );
  }

  // --- Control bar ---

  const btnClass = "px-2 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] btn-base btn-icon";
  const divider = <div className="w-px h-5 bg-[var(--border-subtle)] flex-shrink-0" />;

  const controlBar = (
    <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-md)]">
      {/* Play/Pause */}
      <button onClick={handlePlayPause} className={btnClass} title={isPlaying ? 'Pause (Space)' : 'Play (Space)'} aria-label={isPlaying ? 'Pause' : 'Play'}>
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
      <span className="text-xs font-mono text-[var(--text-muted)] min-w-[85px] text-center select-none">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>

      {/* Seek bar */}
      <div
        ref={seekBarRef}
        className="flex-1 h-1.5 bg-[var(--bg-secondary)] rounded-full cursor-pointer relative overflow-hidden border border-[var(--border-subtle)] min-w-[60px]"
        onClick={handleSeek}
      >
        <div
          className="absolute inset-y-0 left-0 bg-[var(--accent)] rounded-full transition-[width] duration-[var(--transition-fast)]"
          style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
        />
      </div>

      {divider}

      {/* Volume */}
      <button onClick={handleMuteToggle} className={btnClass} title={isMuted ? 'Unmute (M)' : 'Mute (M)'} aria-label={isMuted ? 'Unmute' : 'Mute'}>
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
      />

      {divider}

      {/* CC / Subtitles */}
      {subtitleUrl && (
        <button
          onClick={handleCaptionToggle}
          className={`${btnClass} font-bold text-xs ${showCaptions ? 'text-[var(--accent)]' : ''}`}
          title={showCaptions ? 'Hide subtitles (C)' : 'Show subtitles (C)'}
          aria-label={showCaptions ? 'Hide subtitles' : 'Show subtitles'}
        >
          CC
        </button>
      )}

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
        <button onClick={handlePip} className={btnClass} title="Picture-in-Picture" aria-label="Toggle Picture-in-Picture">
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
        className={btnClass}
        title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
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
    <div className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-black/80 text-white text-xs rounded-[var(--radius-md)] px-4 py-3 pointer-events-none z-10 whitespace-nowrap transition-opacity duration-[var(--transition-slow)]">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        <span><kbd className="font-mono bg-white/20 px-1.5 py-0.5 rounded text-[11px]">Space</kbd> Play/Pause</span>
        <span><kbd className="font-mono bg-white/20 px-1.5 py-0.5 rounded text-[11px]">F</kbd> Fullscreen</span>
        <span><kbd className="font-mono bg-white/20 px-1.5 py-0.5 rounded text-[11px]">&larr; &rarr;</kbd> Seek &plusmn;5s</span>
        <span><kbd className="font-mono bg-white/20 px-1.5 py-0.5 rounded text-[11px]">M</kbd> Mute</span>
        <span><kbd className="font-mono bg-white/20 px-1.5 py-0.5 rounded text-[11px]">&uarr; &darr;</kbd> Volume</span>
        {subtitleUrl && <span><kbd className="font-mono bg-white/20 px-1.5 py-0.5 rounded text-[11px]">C</kbd> Captions</span>}
      </div>
    </div>
  ) : null;

  const videoElement = blobUrl ? (
    <video
      ref={videoRef}
      src={blobUrl}
      className={isFullscreen
        ? "max-w-full max-h-full cursor-pointer"
        : "max-w-full max-h-[500px] cursor-pointer"
      }
      onLoadedMetadata={handleLoadedMetadata}
      onError={handleError}
      onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
      onDurationChange={() => {
        const d = videoRef.current?.duration ?? 0;
        if (isFinite(d) && d > 0) setDuration(d);
      }}
      onPlay={() => setIsPlaying(true)}
      onPause={() => setIsPlaying(false)}
      onEnded={() => setIsPlaying(false)}
      onStalled={() => {
        if (videoRef.current && videoRef.current.readyState < 2) {
          setLoading(false);
          setError('Video playback stalled. Your system may be missing required GStreamer plugins.');
        }
      }}
      onClick={handlePlayPause}
    >
      {subtitleUrl && (
        <track
          kind="subtitles"
          src={subtitleUrl}
          srcLang="en"
          label="Subtitles"
          default={showCaptions}
        />
      )}
    </video>
  ) : null;

  // Fullscreen overlay
  if (isFullscreen) {
    return (
      <>
        {/* Inline placeholder so LibraryContentModal layout isn't disrupted */}
        <div className="p-4 text-center text-sm text-[var(--text-muted)]">
          Video is expanded to fullscreen. Press Esc or the collapse button to return.
        </div>

        {/* Fullscreen overlay */}
        <div className="fixed inset-0 z-[60] flex flex-col bg-[var(--bg-primary)]">
          {/* Video content area */}
          <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-[var(--bg-secondary)] relative">
            {videoElement}
            {keyHintsOverlay}
          </div>

          {/* Control bar at bottom */}
          <div className="flex-shrink-0 px-4 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]">
            {controlBar}
          </div>
        </div>
      </>
    );
  }

  // Normal inline view
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center overflow-auto max-h-[500px] bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-2 relative">
        {loading && blobUrl && (
          <div className="py-12 text-center">
            <DelayedSpinner size="lg" className="mx-auto mb-4" />
            <p className="text-sm text-[var(--text-muted)]">Loading video...</p>
          </div>
        )}
        {videoElement}
        {keyHintsOverlay}
      </div>
      {controlBar}
    </div>
  );
}
