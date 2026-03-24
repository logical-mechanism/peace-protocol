import { useState, useRef, useEffect } from 'react';
import { SPEED_OPTIONS } from './videoConstants';
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
}): VideoKeyboardState {
  const {
    src, subtitleUrl,
    playbackActions, fullscreenActions, seekBarActions,
    adjustVolume, currentVolume, isMuted, playbackRate,
  } = opts;

  const [showKeyHints, setShowKeyHints] = useState(false);
  const [controlAnnouncement, setControlAnnouncement] = useState('');

  const hasShownHints = useRef(false);
  const keyHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        case 'ArrowLeft':
          e.preventDefault();
          playbackActions.handleSkipBack();
          break;
        case 'ArrowRight':
          e.preventDefault();
          playbackActions.handleSkipForward();
          break;
        case 'ArrowUp':
          e.preventDefault();
          adjustVolume(0.1);
          {
            const newVol = Math.min(1, currentVolume + 0.1);
            setControlAnnouncement(`Volume ${Math.round(newVol * 100)}%`);
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          adjustVolume(-0.1);
          {
            const newVol = Math.max(0, currentVolume - 0.1);
            setControlAnnouncement(newVol === 0 ? 'Muted' : `Volume ${Math.round(newVol * 100)}%`);
          }
          break;
        case 'f':
        case 'F':
          fullscreenActions.toggleFullscreen();
          break;
        case 'm':
        case 'M':
          playbackActions.handleMuteToggle();
          break;
        case 'l':
        case 'L':
          playbackActions.handleToggleLoop();
          break;
        case 'c':
        case 'C':
          if (subtitleUrl) playbackActions.handleCaptionToggle();
          break;
        case 't':
        case 'T':
          seekBarActions.setShowRemaining(r => !r);
          break;
        case 's':
        case 'S': {
          // Compute the next speed for the announcement (handleSpeedChange cycles internally)
          const idx = SPEED_OPTIONS.indexOf(playbackRate as typeof SPEED_OPTIONS[number]);
          const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
          playbackActions.handleSpeedChange();
          setControlAnnouncement(`Speed ${next}x`);
          break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    src, subtitleUrl,
    playbackActions, fullscreenActions, seekBarActions,
    adjustVolume, currentVolume, isMuted, playbackRate,
  ]);

  return {
    showKeyHints,
    controlAnnouncement,
  };
}
