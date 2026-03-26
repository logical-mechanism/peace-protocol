import type { MutableRefObject, RefObject } from 'react';

export interface VideoPlayerProps {
  /** Direct URL to the video file (asset:// protocol from Tauri convertFileSrc). */
  src: string;
  mimeType: string;
  fileExtension: string;
  onExport?: () => void;
  /** Direct URL to the subtitle file (asset:// protocol), or null if none. */
  subtitleUrl?: string | null;
}

export interface VideoPlaybackState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  isLooping: boolean;
  isPip: boolean;
  pipSupported: boolean;
  showCaptions: boolean;
  loading: boolean;
  error: string | null;
  bufferedEnd: number;
  isEnded: boolean;
  isSeeking: boolean;
  resumedFrom: number | null;
}

export interface VideoPlaybackActions {
  handlePlayPause: () => void;
  handleStop: () => void;
  handleVideoClick: () => void;
  handleSkipBack: () => void;
  handleSkipForward: () => void;
  handleSkip: (seconds: number) => void;
  handleVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  adjustVolume: (delta: number) => void;
  handleMuteToggle: () => void;
  handleSpeedChange: () => void;
  handleToggleLoop: () => void;
  handleCaptionToggle: () => void;
  handlePip: () => Promise<void>;
  cancelClickTimer: () => void;
  updateCurrentTime: (t: number) => void;
  handleReplay: () => void;
  seekTo: (time: number) => void;
  setSpeed: (speed: number) => void;
  setIsSeeking: (seeking: boolean) => void;
}

export interface VideoEventHandlers {
  onLoadedMetadata: () => void;
  onError: () => void;
  onTimeUpdate: () => void;
  onDurationChange: () => void;
  onCanPlay: () => void;
  onWaiting: () => void;
  onPlaying: () => void;
  onPlay: () => void;
  onPause: () => void;
  onEnded: () => void;
  onSeeked: () => void;
  onStalled: () => void;
  onProgress: () => void;
}

export interface VideoPlaybackResult {
  videoRef: RefObject<HTMLVideoElement | null>;
  isPlayingRef: MutableRefObject<boolean>;
  isSeekingRef: MutableRefObject<boolean>;
  vizTimeRef: MutableRefObject<number>;
  stalledTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  state: VideoPlaybackState;
  actions: VideoPlaybackActions;
  eventHandlers: VideoEventHandlers;
}

export interface VideoFullscreenState {
  isFullscreen: boolean;
  fullscreenVisible: boolean;
  controlsVisible: boolean;
}

export interface VideoFullscreenActions {
  toggleFullscreen: () => void;
}

export interface VideoFullscreenResult {
  fullscreenRef: RefObject<HTMLDivElement | null>;
  state: VideoFullscreenState;
  actions: VideoFullscreenActions;
}

export interface VideoSeekBarState {
  displayTime: number;
  showRemaining: boolean;
}

export interface VideoSeekBarActions {
  handleSeekMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleSeekBarMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleSeekBarMouseLeave: () => void;
  handleSeekKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  setShowRemaining: React.Dispatch<React.SetStateAction<boolean>>;
  syncVizTime: (time: number) => void;
}

export interface VideoSeekBarResult {
  seekBarRef: RefObject<HTMLDivElement | null>;
  seekBarTooltipRef: RefObject<HTMLDivElement | null>;
  hoverMarkerRef: RefObject<HTMLDivElement | null>;
  state: VideoSeekBarState;
  actions: VideoSeekBarActions;
}

export interface VideoKeyboardState {
  showKeyHints: boolean;
  controlAnnouncement: string;
  visualOsd: string | null;
  showOsd: (text: string) => void;
}
