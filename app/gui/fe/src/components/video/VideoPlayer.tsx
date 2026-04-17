import { useCallback, useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DelayedSpinner } from '../LoadingSpinner';
import { useVideoPlayback } from './useVideoPlayback';
import { useVideoFullscreen } from './useVideoFullscreen';
import { useVideoSeekBar } from './useVideoSeekBar';
import { useVideoKeyboard } from './useVideoKeyboard';
import { formatTime, getConversionHint } from './videoUtils';
import { SPEED_FINE_MIN, SPEED_FINE_MAX, SPEED_FINE_STEP, SPEED_PRESETS } from './videoConstants';
import type { VideoPlayerProps } from './videoTypes';

export default function VideoPlayer({ src, mimeType, fileExtension, onExport, subtitleUrl: subtitleUrlProp }: VideoPlayerProps) {
  const { t } = useTranslation('common');
  // Destructure hook returns fully so ESLint can trace ref usage
  const {
    videoRef, isPlayingRef, isSeekingRef, vizTimeRef,
    state: playbackState, actions: playbackActions, eventHandlers,
  } = useVideoPlayback({ src });

  const {
    fullscreenRef, state: fullscreenState, actions: fullscreenActions,
  } = useVideoFullscreen({
    isPlayingRef,
    isSeekingRef,
    isPlaying: playbackState.isPlaying,
  });

  const {
    seekBarRef, seekBarTooltipRef, hoverMarkerRef, state: seekBarState, actions: seekBarActions,
  } = useVideoSeekBar({
    videoRef,
    vizTimeRef,
    isSeekingRef,
    duration: playbackState.duration,
    isPlaying: playbackState.isPlaying,
    setCurrentTime: playbackActions.updateCurrentTime,
    setIsSeeking: playbackActions.setIsSeeking,
  });

  const { showKeyHints, controlAnnouncement, visualOsd, showOsd } = useVideoKeyboard({
    src,
    subtitleUrl: subtitleUrlProp,
    playbackActions,
    fullscreenActions,
    seekBarActions,
    adjustVolume: playbackActions.adjustVolume,
    currentVolume: playbackState.volume,
    isMuted: playbackState.isMuted,
    playbackRate: playbackState.playbackRate,
    duration: playbackState.duration,
    isPlaying: playbackState.isPlaying,
    currentTime: playbackState.currentTime,
    isLooping: playbackState.isLooping,
    showCaptions: playbackState.showCaptions,
  });

  const handleVideoDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    playbackActions.cancelClickTimer();
    fullscreenActions.toggleFullscreen();
  }, [playbackActions, fullscreenActions]);

  // Volume mouse wheel on video area
  const videoAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = videoAreaRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      playbackActions.adjustVolume(delta);
      const newVol = Math.max(0, Math.min(1, playbackState.volume + delta));
      const volText = newVol === 0 ? t('mediaPlayer.muted') : `${t('mediaPlayer.volume')} ${t('mediaPlayer.volumePercent', { percent: Math.round(newVol * 100) })}`;
      showOsd(volText);
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [playbackActions, playbackState.volume, showOsd, t]);

  // Speed popup state
  const [speedPopupOpen, setSpeedPopupOpen] = useState(false);
  const speedPopupRef = useRef<HTMLDivElement>(null);
  const speedBtnRef = useRef<HTMLButtonElement>(null);

  // Close speed popup on click-outside or Escape
  useEffect(() => {
    if (!speedPopupOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (speedPopupRef.current && !speedPopupRef.current.contains(e.target as Node) &&
          speedBtnRef.current && !speedBtnRef.current.contains(e.target as Node)) {
        setSpeedPopupOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setSpeedPopupOpen(false); }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [speedPopupOpen]);

  const handleSpeedSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const speed = parseFloat(e.target.value);
    playbackActions.setSpeed(speed);
  }, [playbackActions]);

  const handleSpeedPreset = useCallback((speed: number) => {
    playbackActions.setSpeed(speed);
    setSpeedPopupOpen(false);
  }, [playbackActions]);

  const { isFullscreen, fullscreenVisible, controlsVisible } = fullscreenState;
  const { isPlaying, currentTime, duration, volume, isMuted, playbackRate, isLooping, isPip, pipSupported, showCaptions, loading, error, bufferedEnd, isEnded, isSeeking, resumedFrom } = playbackState;
  const { displayTime, showRemaining } = seekBarState;

  // --- Error state ---

  if (error) {
    return (
      <div role="alert" className="p-6 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-center space-y-3">
        <svg className="w-8 h-8 mx-auto mb-2 text-[var(--error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        <p className="text-sm font-medium text-[var(--error)]">{t('videoPlayer.failedToPlay')}</p>
        <p className="text-xs text-[var(--text-muted)]">
          {error}
        </p>

        {/* Diagnostic info */}
        <div className="flex items-center justify-center gap-3 text-xs text-[var(--text-muted)]">
          <span>{t('videoPlayer.formatLabel')}: <span className="font-mono text-[var(--text-secondary)]">{fileExtension.toUpperCase().replace('.', '')}</span></span>
          <span className="text-[var(--border-subtle)]">|</span>
          <span>{t('videoPlayer.mimeLabel')}: <span className="font-mono text-[var(--text-secondary)]">{mimeType}</span></span>
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
            {t('videoPlayer.saveAs')}
          </button>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">
            {t('videoPlayer.saveAsHint')}
          </p>
        )}
      </div>
    );
  }

  // --- Control bar ---

  const btnClass = "flex-shrink-0 px-2 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] btn-base btn-icon outline-none focus-visible:shadow-[var(--focus-ring)]";
  const divider = <div className="w-px h-5 bg-[var(--border-subtle)] flex-shrink-0" />;

  const controlBar = (
    <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] flex-nowrap overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
      {/* Screen reader status */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {error ? t('mediaPlayer.statusError') : loading ? t('mediaPlayer.statusLoading') : isPlaying ? t('mediaPlayer.statusPlaying') : t('mediaPlayer.statusPaused')}
      </span>
      {/* Screen reader announcement for volume/speed changes */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {controlAnnouncement}
      </span>
      {/* Play/Pause */}
      <button onClick={playbackActions.handlePlayPause} className={btnClass} title={isPlaying ? t('mediaPlayer.pauseShortcut', { key: 'Space' }) : t('mediaPlayer.playShortcut', { key: 'Space' })} aria-label={isPlaying ? t('mediaPlayer.pause') : t('mediaPlayer.play')} aria-pressed={isPlaying}>
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

      {/* Stop */}
      <button onClick={() => { playbackActions.handleStop(); seekBarActions.syncVizTime(0); }} className={btnClass} title={t('mediaPlayer.stopShortcut', { key: 'X' })} aria-label={t('mediaPlayer.stop')}>
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6h12v12H6z" />
        </svg>
      </button>

      {/* Skip Back */}
      <button onClick={playbackActions.handleSkipBack} className={btnClass} title={t('mediaPlayer.skipBackShortcut', { seconds: 5, key: '\u2190' })} aria-label={t('mediaPlayer.skipBackSeconds', { seconds: 5 })}>
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
        </svg>
      </button>

      {/* Skip Forward */}
      <button onClick={playbackActions.handleSkipForward} className={btnClass} title={t('mediaPlayer.skipForwardShortcut', { seconds: 5, key: '\u2192' })} aria-label={t('mediaPlayer.skipForwardSeconds', { seconds: 5 })}>
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
        </svg>
      </button>

      {/* Time */}
      <div
        className={`flex-shrink-0 text-xs font-mono text-[var(--text-muted)] ${duration >= 3600 ? 'min-w-[130px]' : 'min-w-[85px]'} text-center select-none cursor-pointer`}
        onClick={() => seekBarActions.setShowRemaining(r => !r)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); seekBarActions.setShowRemaining(r => !r); } }}
        role="button"
        tabIndex={0}
        title={t('mediaPlayer.clickToggleRemainingTimeShortcut', { key: 'T' })}
        aria-label={showRemaining ? t('mediaPlayer.showingRemainingTime') : t('mediaPlayer.showingTotalTime')}
      >
        {formatTime(displayTime)} / {showRemaining ? `\u2212${formatTime(Math.max(0, duration - displayTime))}` : formatTime(duration)}
      </div>

      {/* Seek bar — outer wrapper expands click target while visual bar stays h-1.5 */}
      <div
        className={`group/seek flex-1 py-2 cursor-pointer relative min-w-[60px] ${!duration ? 'opacity-50 pointer-events-none' : ''}`}
        onMouseDown={seekBarActions.handleSeekMouseDown}
        onMouseMove={seekBarActions.handleSeekBarMouseMove}
        onMouseLeave={seekBarActions.handleSeekBarMouseLeave}
        onKeyDown={seekBarActions.handleSeekKeyDown}
        role="slider"
        tabIndex={0}
        aria-label={t('mediaPlayer.seek')}
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
          className="h-1.5 group-hover/seek:h-2.5 transition-[height] duration-150 bg-[var(--bg-secondary)] rounded-full relative border border-[var(--border-subtle)]"
        >
          {/* Buffered range */}
          <div
            className="absolute inset-y-0 left-0 bg-[var(--text-muted)]/20 rounded-full"
            style={{ width: `${duration > 0 ? (bufferedEnd / duration) * 100 : 0}%` }}
          />
          {/* Hover preview marker */}
          <div
            ref={hoverMarkerRef}
            className="absolute inset-y-0 w-0.5 bg-white/40 pointer-events-none opacity-0 transition-opacity duration-75"
            style={{ transform: 'translateX(-50%)' }}
          />
          {/* Played range */}
          <div
            className="absolute inset-y-0 left-0 bg-[var(--accent)] rounded-full"
            style={{ width: `${duration > 0 ? (displayTime / duration) * 100 : 0}%` }}
          />
          {/* Seek thumb */}
          <div
            className="absolute top-1/2 w-3 h-3 group-hover/seek:w-3.5 group-hover/seek:h-3.5 transition-all duration-150 rounded-full bg-[var(--bg-elevated)] border-2 border-[var(--accent)]/60 shadow-sm pointer-events-none"
            style={{ left: `${duration > 0 ? (displayTime / duration) * 100 : 0}%`, transform: 'translateX(-50%) translateY(-50%)' }}
          />
        </div>
      </div>

      {divider}

      {/* Volume */}
      <button onClick={playbackActions.handleMuteToggle} className={btnClass} title={isMuted ? t('mediaPlayer.unmuteShortcut', { key: 'M' }) : t('mediaPlayer.muteShortcut', { key: 'M' })} aria-label={isMuted ? t('mediaPlayer.unmute') : t('mediaPlayer.mute')} aria-pressed={isMuted}>
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
        onChange={playbackActions.handleVolumeChange}
        className="w-16 flex-shrink-0 accent-[var(--accent)]"
        aria-label={t('mediaPlayer.volume')}
        aria-valuenow={isMuted ? 0 : Math.round(volume * 100)}
        aria-valuetext={isMuted ? t('mediaPlayer.muted') : t('mediaPlayer.volumePercent', { percent: Math.round(volume * 100) })}
      />

      {divider}

      {/* CC / Subtitles — always visible, disabled when no subtitles for discoverability */}
      <button
        onClick={subtitleUrlProp ? playbackActions.handleCaptionToggle : undefined}
        className={`${btnClass} font-bold text-xs ${!subtitleUrlProp ? 'opacity-50 cursor-not-allowed' : showCaptions ? 'text-[var(--accent)]' : ''}`}
        title={!subtitleUrlProp ? t('videoPlayer.noSubtitles') : showCaptions ? t('videoPlayer.hideSubtitlesShortcut', { key: 'C' }) : t('videoPlayer.showSubtitlesShortcut', { key: 'C' })}
        aria-label={!subtitleUrlProp ? t('videoPlayer.subtitlesUnavailable') : showCaptions ? t('videoPlayer.hideSubtitles') : t('videoPlayer.showSubtitles')}
        aria-pressed={subtitleUrlProp ? showCaptions : undefined}
        aria-disabled={!subtitleUrlProp || undefined}
        disabled={!subtitleUrlProp}
      >
        CC
      </button>

      {/* Loop */}
      <button
        onClick={playbackActions.handleToggleLoop}
        className={`${btnClass} ${isLooping ? 'text-[var(--accent)]' : ''}`}
        title={isLooping ? t('mediaPlayer.repeatOnShortcut', { key: 'R' }) : t('mediaPlayer.repeatOffShortcut', { key: 'R' })}
        aria-label={isLooping ? t('mediaPlayer.disableRepeat') : t('mediaPlayer.enableRepeat')}
        aria-pressed={isLooping}
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
        </svg>
      </button>

      {/* Speed — left-click cycles presets, right-click opens fine control */}
      <div className="relative flex-shrink-0">
        <button
          ref={speedBtnRef}
          onClick={playbackActions.handleSpeedChange}
          onContextMenu={(e) => { e.preventDefault(); setSpeedPopupOpen(p => !p); }}
          className={`${btnClass} min-w-[42px] text-center font-mono`}
          title={t('mediaPlayer.speedTooltip')}
          aria-label={t('mediaPlayer.playbackSpeed', { speed: playbackRate })}
        >
          {playbackRate}x
        </button>
        {speedPopupOpen && (
          <div
            ref={speedPopupRef}
            className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-3 shadow-lg z-30 w-48"
          >
            <div className="text-xs text-[var(--text-muted)] mb-2 text-center">{playbackRate}x</div>
            <input
              type="range"
              min={SPEED_FINE_MIN}
              max={SPEED_FINE_MAX}
              step={SPEED_FINE_STEP}
              value={playbackRate}
              onChange={handleSpeedSliderChange}
              className="w-full accent-[var(--accent)] mb-2"
              aria-label={t('mediaPlayer.fineSpeedControl')}
            />
            <div className="flex justify-between gap-1">
              {SPEED_PRESETS.map(s => (
                <button
                  key={s}
                  onClick={() => handleSpeedPreset(s)}
                  className={`flex-1 text-xs py-1 rounded-[var(--radius-sm)] transition-colors ${
                    playbackRate === s
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* PiP */}
      {pipSupported && (
        <button onClick={playbackActions.handlePip} className={btnClass} title={isPip ? t('videoPlayer.exitPip') : t('videoPlayer.enterPip')} aria-label={isPip ? t('videoPlayer.exitPip') : t('videoPlayer.enterPip')} aria-pressed={isPip}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="2" y="3" width="20" height="14" rx="2" strokeWidth={2} />
            <rect x="11" y="9" width="9" height="6" rx="1" strokeWidth={2} fill="currentColor" opacity={0.3} />
          </svg>
        </button>
      )}

      {divider}

      {/* Fullscreen */}
      <button
        onClick={fullscreenActions.toggleFullscreen}
        className={`${btnClass} ${isFullscreen ? 'text-[var(--accent)]' : ''}`}
        title={isFullscreen ? t('videoPlayer.exitFullscreenShortcut', { key: 'F' }) : t('videoPlayer.fullscreenShortcut', { key: 'F' })}
        aria-label={isFullscreen ? t('videoPlayer.exitFullscreen') : t('videoPlayer.enterFullscreen')}
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
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">Space</kbd> {t('mediaPlayer.hintPlayPause')}</span>
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">F</kbd> {t('mediaPlayer.hintFullscreen')}</span>
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">&larr; &rarr;</kbd> {t('mediaPlayer.hintSeekShift')}</span>
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">M</kbd> {t('mediaPlayer.hintMute')}</span>
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">&uarr; &darr;</kbd> {t('mediaPlayer.volume')}</span>
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">J</kbd> / <kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">K</kbd> / <kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">L</kbd> {t('mediaPlayer.hintBackPlayFwd')}</span>
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">X</kbd> {t('mediaPlayer.hintStop')}</span>
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">R</kbd> {t('mediaPlayer.hintRepeat')}</span>
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">S</kbd> {t('mediaPlayer.hintSpeed')}</span>
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">T</kbd> {t('mediaPlayer.hintTime')}</span>
        {subtitleUrlProp && <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">C</kbd> {t('mediaPlayer.hintCaptions')}</span>}
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">,</kbd> / <kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">.</kbd> {t('mediaPlayer.hintFrameStep')}</span>
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">0-9</kbd> {t('mediaPlayer.hintSeekPercent')}</span>
        <span><kbd className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-[11px]">?</kbd> {t('mediaPlayer.hintShowHints')}</span>
      </div>
    </div>
  ) : null;

  const videoElement = (
    <video
      ref={videoRef}
      preload="metadata"
      className={isFullscreen
        ? "max-w-full max-h-full cursor-pointer"
        : "max-w-full max-h-[500px] cursor-pointer"
      }
      onLoadedMetadata={eventHandlers.onLoadedMetadata}
      onError={eventHandlers.onError}
      onTimeUpdate={() => {
        eventHandlers.onTimeUpdate();
        // Don't overwrite display position during seeking — video.currentTime may be stale in WebKitGTK
        if (!isSeekingRef.current) {
          seekBarActions.syncVizTime(videoRef.current?.currentTime ?? 0);
        }
      }}
      onDurationChange={eventHandlers.onDurationChange}
      onCanPlay={eventHandlers.onCanPlay}
      onWaiting={eventHandlers.onWaiting}
      onPlaying={eventHandlers.onPlaying}
      onPlay={() => {
        eventHandlers.onPlay();
        if (!isSeekingRef.current) {
          seekBarActions.syncVizTime(videoRef.current?.currentTime ?? 0);
        }
      }}
      onPause={eventHandlers.onPause}
      onEnded={() => {
        eventHandlers.onEnded();
        if (!playbackState.isLooping) {
          seekBarActions.syncVizTime(0);
        }
      }}
      onSeeked={() => {
        eventHandlers.onSeeked();
        seekBarActions.syncVizTime(videoRef.current?.currentTime ?? 0);
      }}
      onStalled={eventHandlers.onStalled}
      onProgress={eventHandlers.onProgress}
      onClick={playbackActions.handleVideoClick}
      onDoubleClick={handleVideoDoubleClick}
    >
      <source src={src} type={mimeType} />
      {subtitleUrlProp && (
        <track
          kind="subtitles"
          src={subtitleUrlProp}
          srcLang="und"
          label={t('videoPlayer.subtitlesLabel')}
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
          {t('videoPlayer.fullscreenMessage')}
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
          ref={videoAreaRef}
          className={isFullscreen
            ? 'flex-1 overflow-auto flex items-center justify-center p-4 bg-[var(--bg-secondary)] relative'
            : 'flex items-center justify-center overflow-auto max-h-[500px] bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-2 relative'
          }
        >
          {videoElement}
          {loading && !isSeeking && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-secondary)]/80 backdrop-blur-sm">
              <div className="text-center">
                <DelayedSpinner size="lg" className="mx-auto mb-4" />
                <p className="text-sm text-[var(--text-muted)]">{t('videoPlayer.loadingVideo')}</p>
              </div>
            </div>
          )}
          {isEnded && !loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <button
                onClick={playbackActions.handleReplay}
                className="flex flex-col items-center gap-2 text-white/90 hover:text-white transition-colors"
                aria-label={t('videoPlayer.replayAria')}
              >
                <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
                </svg>
                <span className="text-sm font-medium">{t('videoPlayer.replay')}</span>
              </button>
            </div>
          )}
          {resumedFrom !== null && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-[var(--bg-elevated)]/90 text-[var(--text-primary)] text-xs rounded-[var(--radius-md)] px-3 py-1.5 pointer-events-none z-10 border border-[var(--border-subtle)] transition-opacity duration-500">
              {t('videoPlayer.resumedFrom', { time: formatTime(resumedFrom) })}
            </div>
          )}
          {visualOsd && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/70 text-white text-lg font-semibold rounded-[var(--radius-md)] px-5 py-3 pointer-events-none z-10">
              {visualOsd}
            </div>
          )}
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

        {/* Mini progress bar — visible in fullscreen when controls are hidden */}
        {isFullscreen && (
          <div
            className={`absolute bottom-0 left-0 h-0.5 bg-[var(--accent)] z-20 transition-opacity duration-300 ${controlsVisible ? 'opacity-0' : 'opacity-100'}`}
            style={{ width: `${duration > 0 ? (displayTime / duration) * 100 : 0}%` }}
          />
        )}
      </div>
    </div>
  );
}
