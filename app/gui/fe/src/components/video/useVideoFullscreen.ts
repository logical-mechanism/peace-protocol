import { useState, useRef, useEffect, useCallback, type MutableRefObject } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { AUTO_HIDE_INITIAL_MS, AUTO_HIDE_SUBSEQUENT_MS } from './videoConstants';
import type { VideoFullscreenResult } from './videoTypes';

export function useVideoFullscreen(opts: {
  isPlayingRef: MutableRefObject<boolean>;
  isSeekingRef: MutableRefObject<boolean>;
  isPlaying: boolean;
}): VideoFullscreenResult {
  const { isPlayingRef, isSeekingRef, isPlaying } = opts;

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenVisible, setFullscreenVisible] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  const fullscreenRef = useRef<HTMLDivElement>(null);
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullscreenEnteredAtRef = useRef(0);

  // Trap focus within fullscreen overlay
  useFocusTrap(fullscreenRef, isFullscreen);

  // Drive fullscreen opacity transition
  useEffect(() => {
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
      const delay = elapsed < 3000 ? AUTO_HIDE_INITIAL_MS : AUTO_HIDE_SUBSEQUENT_MS;
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
  }, [isFullscreen, isPlaying, isPlayingRef, isSeekingRef]);

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

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(fs => !fs);
  }, []);

  return {
    fullscreenRef,
    state: {
      isFullscreen,
      fullscreenVisible,
      controlsVisible,
    },
    actions: {
      toggleFullscreen,
    },
  };
}
