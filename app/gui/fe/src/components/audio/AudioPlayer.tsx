import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties } from 'react';
import { DelayedSpinner } from '../LoadingSpinner';
import { useAudioPlayback, formatTime, getConversionHint } from './useAudioPlayback';
import { useAudioWaveform } from './useAudioWaveform';
import { CANVAS_H } from './audioConstants';
import type { AudioPlayerProps } from './audioTypes';

/** Text that scrolls horizontally on hover when it overflows its container. */
function MarqueeText({ text, className }: { text: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const spanRef = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [offset, setOffset] = useState(0);
  const [duration, setDuration] = useState(4);

  useEffect(() => {
    const container = containerRef.current;
    const span = spanRef.current;
    if (!container || !span) return;
    const cw = container.clientWidth;
    const sw = span.scrollWidth;
    const isOverflowing = sw > cw;
    setOverflows(isOverflowing);
    setOffset(isOverflowing ? cw - sw : 0);
    // Scale duration by overflow distance (~40px/s scroll speed)
    setDuration(isOverflowing ? Math.max(3, (sw - cw) / 40) : 4);
  }, [text]);

  return (
    <div
      ref={containerRef}
      className={`marquee-on-hover ${className ?? ''}`}
      style={{ '--marquee-offset': `${offset}px`, '--marquee-duration': `${duration}s` } as CSSProperties}
    >
      <span ref={spanRef} className={overflows ? 'marquee-overflows' : ''}>
        {text}
      </span>
    </div>
  );
}

/** Musical note placeholder for tracks without album art. */
function AlbumArtPlaceholder() {
  return (
    <div className="w-14 h-14 rounded-[var(--radius-md)] bg-[var(--bg-tertiary)] flex items-center justify-center flex-shrink-0">
      <svg className="w-6 h-6 text-[var(--text-muted)]" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
      </svg>
    </div>
  );
}

function MetadataAlbumArt({ picture }: { picture: { data: Uint8Array; format: string } }) {
  // Cap at 5MB to prevent memory bloat from large embedded art
  const url = useMemo(() => {
    if (picture.data.length > 5_000_000) return null;
    const blob = new Blob([picture.data as BlobPart], { type: picture.format });
    return URL.createObjectURL(blob);
  }, [picture]);

  useEffect(() => {
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [url]);

  if (!url) return <AlbumArtPlaceholder />;

  return (
    <img
      src={url}
      alt="Album art"
      className="w-14 h-14 rounded-[var(--radius-md)] object-cover flex-shrink-0 shadow-md"
    />
  );
}

export default function AudioPlayer({ fileExtension, tokenName, category, onExport }: AudioPlayerProps) {
  const { waveformCanvasRef, metadata, vizFailed, waveformDuration, drawWaveform, updateProgress, forceRedraw } =
    useAudioWaveform(tokenName, category);

  const { mimeType, state, actions } = useAudioPlayback({
    tokenName,
    category,
    fileExtension,
    waveformDuration,
    onTimeUpdate: updateProgress,
    onSeeked: forceRedraw,
  });

  const { isReady, isPlaying, currentTime, duration, error, isBuffering, playError, isLooping, isMuted, volume, playbackRate } = state;
  const { play, pause, stop, skipBack, skipForward, seek, setVolume, toggleMute, toggleLoop, cycleSpeed, setSpeed, clearPlayError } = actions;

  const [showRemaining, setShowRemaining] = useState(false);

  // Keyboard hints toggle
  const [showKeyHints, setShowKeyHints] = useState(false);
  // Speed popover (right-click on speed button)
  const [showSpeedPopover, setShowSpeedPopover] = useState(false);

  // Close speed popover on click-outside or Escape
  useEffect(() => {
    if (!showSpeedPopover) return;
    const close = () => setShowSpeedPopover(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    // Delay listener to avoid catching the same right-click event
    const id = setTimeout(() => {
      document.addEventListener('click', close);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [showSpeedPopover]);

  // Seek refs
  const seekBarRef = useRef<HTMLDivElement | null>(null);
  const isSeekingRef = useRef(false);
  const waveformContainerRef = useRef<HTMLDivElement | null>(null);
  const seekBarTooltipRef = useRef<HTMLDivElement | null>(null);
  const waveformTooltipRef = useRef<HTMLDivElement | null>(null);

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (isPlaying) pause();
          else play();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skipBack();
          break;
        case 'ArrowRight':
          e.preventDefault();
          skipForward();
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume(Math.min(1, volume + 0.05));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(Math.max(0, volume - 0.05));
          break;
        case 'm':
        case 'M':
          toggleMute();
          break;
        case 'l':
        case 'L':
          toggleLoop();
          break;
        case 's':
        case 'S':
          cycleSpeed();
          break;
        case 't':
        case 'T':
          setShowRemaining(prev => !prev);
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, play, pause, skipBack, skipForward, toggleMute, toggleLoop, cycleSpeed, volume, setVolume]);

  // --- Seek handlers ---
  const handleSeekMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!seekBarRef.current || !duration || !isReady) return;
    isSeekingRef.current = true;

    const seekTo = (clientX: number) => {
      const rect = seekBarRef.current!.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      seek(ratio * duration);
      drawWaveform(ratio);
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
  }, [duration, isReady, seek, drawWaveform]);

  const handleWaveformMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!waveformContainerRef.current || !duration || !isReady) return;
    e.preventDefault();
    isSeekingRef.current = true;

    const seekTo = (clientX: number) => {
      const rect = waveformContainerRef.current!.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      seek(ratio * duration);
      drawWaveform(ratio);
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
  }, [duration, isReady, seek, drawWaveform]);

  const handleSeekKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isReady || !duration) return;

    let newTime = currentTime;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':
        newTime = Math.max(0, currentTime - 5);
        break;
      case 'ArrowRight':
        newTime = Math.min(duration, currentTime + 5);
        break;
      case 'Home':
        newTime = 0;
        break;
      case 'End':
        newTime = duration;
        break;
      default:
        handled = false;
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      seek(newTime);
      if (duration > 0) drawWaveform(newTime / duration);
    }
  }, [isReady, duration, currentTime, seek, drawWaveform]);

  // --- Seek preview tooltip ---
  const showSeekTooltip = useCallback((
    clientX: number,
    containerRef: React.RefObject<HTMLDivElement | null>,
    tooltipRef: React.RefObject<HTMLDivElement | null>,
  ) => {
    const tooltip = tooltipRef.current;
    const container = containerRef.current;
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

  const hideSeekTooltip = useCallback((tooltipRef: React.RefObject<HTMLDivElement | null>) => {
    const tooltip = tooltipRef.current;
    if (tooltip) tooltip.style.opacity = '0';
  }, []);

  const handleWaveformMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isReady || !duration) return;
    showSeekTooltip(e.clientX, waveformContainerRef, waveformTooltipRef);
  }, [isReady, duration, showSeekTooltip]);

  const handleWaveformMouseLeave = useCallback(() => {
    hideSeekTooltip(waveformTooltipRef);
  }, [hideSeekTooltip]);

  const handleSeekBarMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isReady || !duration) return;
    showSeekTooltip(e.clientX, seekBarRef, seekBarTooltipRef);
  }, [isReady, duration, showSeekTooltip]);

  const handleSeekBarMouseLeave = useCallback(() => {
    hideSeekTooltip(seekBarTooltipRef);
  }, [hideSeekTooltip]);

  // --- Render ---

  if (error) {
    const ext = (fileExtension || '.mp3').toUpperCase().slice(1);
    const conversionHint = getConversionHint(fileExtension);

    return (
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-[var(--radius-md)] overflow-hidden">
        <div className="p-6 text-center space-y-3">
          <svg className="w-8 h-8 mx-auto mb-2 text-[var(--error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-[var(--error)]">{error}</p>
          <p className="text-xs text-[var(--text-muted)]">
            Detected format: <span className="font-mono">{ext}</span> ({mimeType})
          </p>
          {conversionHint && (
            <p className="text-xs text-[var(--text-secondary)] font-mono">{conversionHint}</p>
          )}
          {onExport && (
            <button
              onClick={onExport}
              className="mt-2 px-4 py-2 text-sm bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            >
              Save As to open with an external player
            </button>
          )}
        </div>
      </div>
    );
  }

  const transportBtn =
    'w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-tertiary)] active:scale-95 transition-all duration-150 cursor-pointer outline-none focus-visible:shadow-[var(--focus-ring)]';
  const transportBtnLg =
    'w-10 h-10 flex items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 active:bg-[var(--accent)]/30 active:scale-95 transition-all duration-150 cursor-pointer outline-none focus-visible:shadow-[var(--focus-ring)]';

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-[var(--radius-md)] overflow-hidden">
      {/* Hidden audio element */}
      {/* Audio playback handled by rodio (Rust) via Tauri IPC — no <audio> element needed */}

      {/* Metadata + Format Badge */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {metadata?.picture ? <MetadataAlbumArt picture={metadata.picture} /> : <AlbumArtPlaceholder />}
          {metadata && (metadata.title || metadata.artist || metadata.album) ? (
            <div className="flex-1 min-w-0">
              {metadata.title && (
                <MarqueeText text={metadata.title} className="text-xs font-medium text-[var(--text-primary)]" />
              )}
              {metadata.artist && (
                <MarqueeText text={metadata.artist} className="text-[10px] text-[var(--text-secondary)]" />
              )}
              {(metadata.album || metadata.year) && (
                <MarqueeText
                  text={`${[metadata.album, metadata.year].filter(Boolean).join(' \u2014 ')}${metadata.trackNumber ? ` (Track ${metadata.trackNumber})` : ''}`}
                  className="text-[10px] text-[var(--text-muted)]"
                />
              )}
            </div>
          ) : (
            <span className="text-xs text-[var(--text-secondary)] truncate">Audio</span>
          )}
        </div>
        <div className="flex items-center gap-2 ml-2 shrink-0">
          {(metadata?.sampleRate || metadata?.channels) && (
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
              {metadata?.sampleRate != null && <span>{Math.round(metadata.sampleRate / 1000)}kHz</span>}
              {metadata?.channels != null && (
                <span>{metadata.channels === 1 ? 'Mono' : metadata.channels === 2 ? 'Stereo' : `${metadata.channels}ch`}</span>
              )}
            </div>
          )}
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
            {(fileExtension || '.mp3').toUpperCase().slice(1)}
          </span>
        </div>
      </div>

      {/* Waveform Visualization */}
      <div
        ref={waveformContainerRef}
        className="mx-3 relative cursor-pointer rounded-[var(--radius-sm)] overflow-hidden"
        onMouseDown={handleWaveformMouseDown}
        onMouseMove={handleWaveformMouseMove}
        onMouseLeave={handleWaveformMouseLeave}
        tabIndex={0}
        role="slider"
        aria-label="Audio waveform, click to seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext={formatTime(currentTime)}
      >
        <canvas
          ref={waveformCanvasRef}
          className="w-full block bg-[var(--bg-primary)]"
          style={{ imageRendering: 'pixelated', height: CANVAS_H }}
          aria-hidden="true"
        />
        {!isReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)]/80">
            <DelayedSpinner size="sm" className="mr-2" />
            <span className="text-xs text-[var(--text-muted)]">Loading audio...</span>
          </div>
        )}
{/* Keyboard hints panel removed — now toggled via ? button in transport controls */}
        <div
          ref={waveformTooltipRef}
          className="absolute -top-6 -translate-x-1/2 bg-black/80 text-white text-[11px] font-mono rounded px-1.5 py-0.5 pointer-events-none select-none z-20 transition-opacity duration-75"
          style={{ opacity: 0 }}
          aria-hidden="true"
        />
        {vizFailed && isReady && (
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] text-[var(--text-muted)] pointer-events-none select-none">
            Visualization unavailable for this format
          </div>
        )}
      </div>

      {/* Time + Controls Row */}
      <div className="flex items-center gap-3 px-3 py-2">
        {/* Time display */}
        <button
          type="button"
          className="font-mono text-xs text-[var(--text-secondary)] cursor-pointer select-none hover:text-[var(--text-primary)] transition-colors shrink-0"
          onClick={() => setShowRemaining(r => !r)}
          title="Click to toggle remaining time"
          role="switch"
          aria-checked={showRemaining}
          aria-label="Toggle remaining time"
        >
          <span className="text-[var(--text-primary)]">{formatTime(currentTime)}</span>
          <span className="text-[var(--text-muted)] mx-0.5">/</span>
          <span className="opacity-60">
            {showRemaining ? `\u2212${formatTime(Math.max(0, duration - currentTime), duration === 0)}` : formatTime(duration, duration === 0)}
          </span>
        </button>

        {/* Seek Bar */}
        <div className="flex-1">
          <div
            className="group py-1.5 cursor-pointer relative"
            onMouseDown={handleSeekMouseDown}
            onMouseMove={handleSeekBarMouseMove}
            onMouseLeave={handleSeekBarMouseLeave}
            onKeyDown={handleSeekKeyDown}
            role="slider"
            tabIndex={0}
            aria-label="Seek position"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(currentTime)}
            aria-valuetext={formatTime(currentTime)}
          >
            <div
              ref={seekBarTooltipRef}
              className="absolute -top-5 -translate-x-1/2 bg-black/80 text-white text-[11px] font-mono rounded px-1.5 py-0.5 pointer-events-none select-none z-20 transition-opacity duration-75"
              style={{ opacity: 0 }}
              aria-hidden="true"
            />
            <div
              ref={seekBarRef}
              className="h-1.5 group-hover:h-2 bg-[var(--bg-tertiary)] rounded-full relative transition-all duration-150"
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)] opacity-70"
                style={{ width: `${progress}%` }}
              />
              <div
                className="absolute top-1/2 w-3 h-3 rounded-full bg-[var(--accent)] shadow-sm pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `${progress}%`, transform: 'translateX(-50%) translateY(-50%)' }}
              />
            </div>
          </div>
        </div>

        {/* Status */}
        <span className="text-[10px] font-medium tracking-wide text-[var(--text-muted)] uppercase shrink-0" aria-live="polite" aria-atomic="true">
          {!isReady ? 'Loading' : isBuffering && isPlaying ? 'Buffering' : isPlaying ? 'Playing' : currentTime > 0 ? 'Paused' : 'Ready'}
        </span>
      </div>

      {/* Transport Controls + Volume */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--border)]">
        <div className="flex items-center gap-0.5">
          <button onClick={skipBack} className={transportBtn} title="Back 10s" aria-label="Skip back 10 seconds">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
            </svg>
          </button>

          <button
            onClick={isPlaying ? pause : play}
            className={`${transportBtnLg}${isPlaying ? ' ring-2 ring-[var(--accent)]/30' : ''}${!isReady ? ' !cursor-not-allowed' : ''}`}
            title={isPlaying ? 'Pause' : 'Play'}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            aria-pressed={isPlaying}
            aria-keyshortcuts="Space"
            aria-describedby={playError ? 'audio-play-error' : undefined}
            disabled={!isReady}
            style={{ opacity: isReady ? 1 : 0.4 }}
          >
            {isPlaying ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <button onClick={stop} className={transportBtn} title="Stop" aria-label="Stop">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h12v12H6z" />
            </svg>
          </button>

          <button onClick={skipForward} className={transportBtn} title="Forward 10s" aria-label="Skip forward 10 seconds">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
            </svg>
          </button>

          <span className="w-px h-5 bg-[var(--border)] mx-1" />

          <button
            onClick={toggleLoop}
            className={`${transportBtn} ${isLooping ? '!text-[var(--accent)]' : ''}`}
            title={isLooping ? 'Repeat: On (L)' : 'Repeat: Off (L)'}
            aria-label={isLooping ? 'Disable repeat' : 'Enable repeat'}
            aria-pressed={isLooping}
            aria-keyshortcuts="l"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
            </svg>
          </button>

          <div className="relative">
            <button
              onClick={cycleSpeed}
              onContextMenu={(e) => { e.preventDefault(); setShowSpeedPopover(v => !v); }}
              className={`${transportBtn} text-[10px] font-bold tracking-tight min-w-[32px] ${playbackRate !== 1 ? '!text-[var(--accent)]' : ''}`}
              title={`Speed: ${playbackRate}x (S) · Right-click for slider`}
              aria-label={`Playback speed: ${playbackRate}x`}
            >
              {playbackRate}x
            </button>
            {showSpeedPopover && (
              <div
                className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-[var(--radius-md)] px-3 py-2 z-30 shadow-lg flex flex-col items-center gap-1.5 min-w-[80px]"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="text-[10px] font-mono text-[var(--text-primary)] font-bold">{playbackRate.toFixed(2)}x</span>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.05"
                  value={playbackRate}
                  onChange={(e) => setSpeed(parseFloat(e.target.value))}
                  className="audio-volume-slider w-16"
                  style={{ '--volume-pct': `${((playbackRate - 0.5) / 1.5) * 100}%` } as CSSProperties}
                  aria-label="Fine speed control"
                />
                <div className="flex justify-between w-full text-[9px] text-[var(--text-muted)]">
                  <span>0.5x</span>
                  <span>2x</span>
                </div>
              </div>
            )}
          </div>

          <span className="w-px h-5 bg-[var(--border)] mx-1" />

          <div className="relative">
            <button
              onClick={() => setShowKeyHints(v => !v)}
              className={`${transportBtn} text-[10px] font-bold min-w-[24px] ${showKeyHints ? '!text-[var(--accent)]' : ''}`}
              title="Keyboard shortcuts"
              aria-label="Toggle keyboard shortcuts"
              aria-expanded={showKeyHints}
            >
              ?
            </button>
            {showKeyHints && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-black/90 text-white text-xs rounded-[var(--radius-md)] px-4 py-3 z-30 whitespace-nowrap shadow-lg">
                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                  <span><kbd className="font-mono bg-white/20 px-1.5 py-0.5 rounded text-[11px]">Space</kbd> Play/Pause</span>
                  <span><kbd className="font-mono bg-white/20 px-1.5 py-0.5 rounded text-[11px]">&larr; &rarr;</kbd> Seek &plusmn;10s</span>
                  <span><kbd className="font-mono bg-white/20 px-1.5 py-0.5 rounded text-[11px]">&uarr; &darr;</kbd> Volume</span>
                  <span><kbd className="font-mono bg-white/20 px-1.5 py-0.5 rounded text-[11px]">M</kbd> Mute</span>
                  <span><kbd className="font-mono bg-white/20 px-1.5 py-0.5 rounded text-[11px]">L</kbd> Loop</span>
                  <span><kbd className="font-mono bg-white/20 px-1.5 py-0.5 rounded text-[11px]">S</kbd> Speed</span>
                  <span><kbd className="font-mono bg-white/20 px-1.5 py-0.5 rounded text-[11px]">T</kbd> Time mode</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleMute}
            className="w-6 h-6 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer outline-none focus-visible:shadow-[var(--focus-ring)]"
            title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
            aria-pressed={isMuted}
          >
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
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="audio-volume-slider w-20"
            style={{ '--volume-pct': `${Math.round(volume * 100)}%` } as CSSProperties}
            aria-label="Volume"
            role="slider"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={volume}
            aria-valuetext={`${Math.round(volume * 100)}%`}
          />
        </div>
      </div>

      {/* Play error */}
      {playError && (
        <div id="audio-play-error" className="flex items-center gap-2 px-3 py-1.5 bg-[var(--error)]/10 border-t border-[var(--error)]/20" role="alert">
          <svg className="w-3.5 h-3.5 shrink-0 text-[var(--error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" />
          </svg>
          <p className="text-xs text-[var(--error)] flex-1">{playError}</p>
          <button
            type="button"
            onClick={clearPlayError}
            className="text-[var(--error)] hover:text-[var(--text-primary)] cursor-pointer"
            aria-label="Dismiss play error"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
