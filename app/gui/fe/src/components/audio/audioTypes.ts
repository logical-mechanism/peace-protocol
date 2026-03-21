export interface AudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  trackNumber?: number;
  year?: number;
  picture?: { data: Uint8Array; format: string } | null;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
}

export interface AudioPlayerProps {
  /** Direct URL to the audio file served by the Axum media server. */
  src: string;
  fileExtension: string;
  /** Token name for Rust-side waveform decode via symphonia. */
  tokenName: string;
  /** Content category for Rust-side waveform decode. */
  category: string;
  onExport?: () => void;
}

export interface AudioPlaybackState {
  isReady: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  error: string | null;
  isBuffering: boolean;
  playError: string | null;
  isLooping: boolean;
  isMuted: boolean;
  volume: number;
  playbackRate: number;
}

export interface AudioPlaybackActions {
  play: () => void;
  pause: () => void;
  stop: () => void;
  skipBack: () => void;
  skipForward: () => void;
  seek: (time: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleLoop: () => void;
  cycleSpeed: () => void;
  clearPlayError: () => void;
}
