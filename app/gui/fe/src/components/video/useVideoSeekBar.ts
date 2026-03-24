import { useState, useRef, useCallback, useEffect, type MutableRefObject, type RefObject } from 'react';
import { formatTime } from './videoUtils';
import { SKIP_SECONDS } from './videoConstants';
import type { VideoSeekBarResult } from './videoTypes';

export function useVideoSeekBar(opts: {
  videoRef: RefObject<HTMLVideoElement | null>;
  vizTimeRef: MutableRefObject<number>;
  isPlayingRef: MutableRefObject<boolean>;
  isSeekingRef: MutableRefObject<boolean>;
  lastDrawTimeRef: MutableRefObject<number>;
  duration: number;
  isPlaying: boolean;
  playbackRate: number;
  setCurrentTime: (t: number) => void;
  setIsSeeking: (seeking: boolean) => void;
}): VideoSeekBarResult {
  const {
    videoRef, vizTimeRef, isSeekingRef, lastDrawTimeRef,
    duration, isPlaying, playbackRate, setCurrentTime, setIsSeeking,
  } = opts;

  const [displayTime, setDisplayTime] = useState(0);
  const [showRemaining, setShowRemaining] = useState(false);

  const seekBarRef = useRef<HTMLDivElement>(null);
  const seekBarTooltipRef = useRef<HTMLDivElement>(null);
  const hoverMarkerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const wasPlayingRef = useRef(false);

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
  }, [isPlaying, playbackRate, duration, vizTimeRef, lastDrawTimeRef]);

  const syncVizTime = useCallback((time: number) => {
    vizTimeRef.current = time;
    setDisplayTime(time);
  }, [vizTimeRef]);

  // --- Seek bar interactions ---

  const handleSeekMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const bar = seekBarRef.current;
    if (!video || !bar || !duration) return;
    wasPlayingRef.current = !video.paused;
    isSeekingRef.current = true;
    setIsSeeking(true);

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
      setIsSeeking(false);
      if (wasPlayingRef.current) {
        video.play().catch(() => {});
        wasPlayingRef.current = false;
      }
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [duration, videoRef, isSeekingRef, vizTimeRef, setCurrentTime, setIsSeeking]);

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
    // Position hover marker
    const marker = hoverMarkerRef.current;
    if (marker) {
      marker.style.left = `${ratio * 100}%`;
      marker.style.opacity = '1';
    }
  }, [duration]);

  const hideSeekTooltip = useCallback(() => {
    const tooltip = seekBarTooltipRef.current;
    if (tooltip) tooltip.style.opacity = '0';
    const marker = hoverMarkerRef.current;
    if (marker) marker.style.opacity = '0';
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
        video.currentTime = Math.max(0, video.currentTime - SKIP_SECONDS);
        break;
      case 'ArrowRight':
        video.currentTime = Math.min(duration, video.currentTime + SKIP_SECONDS);
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
  }, [duration, videoRef, vizTimeRef, setCurrentTime]);

  return {
    seekBarRef,
    seekBarTooltipRef,
    hoverMarkerRef,
    state: {
      displayTime,
      showRemaining,
    },
    actions: {
      handleSeekMouseDown,
      handleSeekBarMouseMove,
      handleSeekBarMouseLeave,
      handleSeekKeyDown,
      setShowRemaining,
      syncVizTime,
    },
  };
}
