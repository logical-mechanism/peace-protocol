import { useState, useRef, useEffect } from 'react';
import { SPEED_OPTIONS, SKIP_SECONDS, SKIP_SECONDS_MEDIUM, SKIP_SECONDS_LARGE, FRAME_STEP_SECONDS } from './videoConstants';
import type { VideoPlaybackActions, VideoFullscreenActions, VideoSeekBarActions, VideoKeyboardState } from './videoTypes';

export function useVideoKeyboard(opts: {
  src: string;
  subtitleUrl?: string | null;
  playbackActions: VideoPlaybackActions;
  fullscreenActions: VideoFullscreenActions;
  seekBarActions: VideoSeekBarActions;
  adjustVolume: (delta: number) => void;
  currentVolume: number;
  isMuted: boolean;
  playbackRate: number;
  duration: number;
  isPlaying: boolean;
  currentTime: number;
  isLooping: boolean;
  showCaptions: boolean;
}): VideoKeyboardState {
  const {
    src, subtitleUrl,
    playbackActions, fullscreenActions, seekBarActions,
    adjustVolume, currentVolume, isMuted, playbackRate, duration,
    isPlaying, currentTime, isLooping, showCaptions,
  } = opts;

  const [showKeyHints, setShowKeyHints] = useState(false);
  const [controlAnnouncement, setControlAnnouncement] = useState('');
  const [visualOsd, setVisualOsd] = useState<string | null>(null);

  const hasShownHints = useRef(false);
  const keyHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const osdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showOsd = (text: string) => {
    setVisualOsd(text);
    if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    osdTimerRef.current = setTimeout(() => {
      setVisualOsd(null);
      osdTimerRef.current = null;
    }, 800);
  };

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
          playbackActions.handlePlayPause();
          break;
        case 'ArrowLeft': {
          e.preventDefault();
          const skipL = e.shiftKey ? -SKIP_SECONDS_LARGE : -SKIP_SECONDS;
          playbackActions.handleSkip(skipL);
          showOsd(`${skipL}s`);
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          const skipR = e.shiftKey ? SKIP_SECONDS_LARGE : SKIP_SECONDS;
          playbackActions.handleSkip(skipR);
          showOsd(`+${skipR}s`);
          break;
        }
        case 'ArrowUp':
          e.preventDefault();
          adjustVolume(0.1);
          {
            const newVol = Math.min(1, currentVolume + 0.1);
            const volText = `Volume ${Math.round(newVol * 100)}%`;
            setControlAnnouncement(volText);
            showOsd(volText);
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          adjustVolume(-0.1);
          {
            const newVol = Math.max(0, currentVolume - 0.1);
            const volText = newVol === 0 ? 'Muted' : `Volume ${Math.round(newVol * 100)}%`;
            setControlAnnouncement(volText);
            showOsd(volText);
          }
          break;
        case 'f':
        case 'F':
          fullscreenActions.toggleFullscreen();
          showOsd('Fullscreen');
          break;
        case 'm':
        case 'M':
          playbackActions.handleMuteToggle();
          showOsd(isMuted ? 'Unmuted' : 'Muted');
          break;
        case 'j':
        case 'J':
          playbackActions.handleSkip(-SKIP_SECONDS_MEDIUM);
          showOsd(`-${SKIP_SECONDS_MEDIUM}s`);
          break;
        case 'k':
        case 'K':
          playbackActions.handlePlayPause();
          break;
        case 'l':
        case 'L':
          playbackActions.handleSkip(SKIP_SECONDS_MEDIUM);
          showOsd(`+${SKIP_SECONDS_MEDIUM}s`);
          break;
        case 'r':
        case 'R':
          playbackActions.handleToggleLoop();
          showOsd(isLooping ? 'Loop Off' : 'Loop On');
          break;
        case 'c':
        case 'C':
          if (subtitleUrl) {
            playbackActions.handleCaptionToggle();
            showOsd(showCaptions ? 'Captions Off' : 'Captions On');
          }
          break;
        case 't':
        case 'T':
          seekBarActions.setShowRemaining(r => !r);
          break;
        case 's':
        case 'S': {
          const idx = SPEED_OPTIONS.indexOf(playbackRate as typeof SPEED_OPTIONS[number]);
          const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
          playbackActions.handleSpeedChange();
          setControlAnnouncement(`Speed ${next}x`);
          showOsd(`${next}x`);
          break;
        }
        case '.':
          if (!isPlaying && duration > 0) {
            const fwd = Math.min(duration, currentTime + FRAME_STEP_SECONDS);
            playbackActions.seekTo(fwd);
            seekBarActions.syncVizTime(fwd);
            showOsd('Frame \u2192');
          }
          break;
        case ',':
          if (!isPlaying && duration > 0) {
            const back = Math.max(0, currentTime - FRAME_STEP_SECONDS);
            playbackActions.seekTo(back);
            seekBarActions.syncVizTime(back);
            showOsd('\u2190 Frame');
          }
          break;
        case '0': case '1': case '2': case '3': case '4':
        case '5': case '6': case '7': case '8': case '9': {
          if (duration > 0) {
            const pct = parseInt(e.key) / 10;
            const target = pct * duration;
            playbackActions.seekTo(target);
            seekBarActions.syncVizTime(target);
            showOsd(`${parseInt(e.key) * 10}%`);
          }
          break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    src, subtitleUrl,
    playbackActions, fullscreenActions, seekBarActions,
    adjustVolume, currentVolume, isMuted, playbackRate, duration,
    isPlaying, currentTime, isLooping, showCaptions,
  ]);

  return {
    showKeyHints,
    controlAnnouncement,
    visualOsd,
  };
}
