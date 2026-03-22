import { useState, useRef, useCallback, useEffect } from 'react';
import { SPEED_OPTIONS } from './audioConstants';

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    '.opus': 'audio/opus',
  };
  return map[ext.toLowerCase()] || 'audio/mpeg';
}
export { getMimeType };

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function getConversionHint(ext: string): string | null {
  const hints: Record<string, string> = {
    '.flac': 'Try converting to MP3: ffmpeg -i file.flac -q:a 2 output.mp3',
    '.aac': 'Try converting to MP3: ffmpeg -i file.aac -c:a libmp3lame output.mp3',
    '.opus': 'Try converting to OGG: ffmpeg -i file.opus -c:a libvorbis output.ogg',
    '.m4a': 'Try converting to MP3: ffmpeg -i file.m4a -c:a libmp3lame output.mp3',
    '.wav': 'WAV is usually supported. The file may be corrupted or use an uncommon codec.',
    '.ogg': 'Try converting to MP3: ffmpeg -i file.ogg -c:a libmp3lame output.mp3',
    '.mp3': 'MP3 is widely supported. The file may be corrupted or use an uncommon bitrate.',
  };
  return hints[ext.toLowerCase()] ?? null;
}

interface UseAudioPlaybackOptions {
  src: string;
  fileExtension: string;
  onTimeUpdate?: (time: number, duration: number) => void;
  onSeeked?: () => void;
}

export function useAudioPlayback({ src, fileExtension, onTimeUpdate, onSeeked }: UseAudioPlaybackOptions) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.75);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const isPlayingRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset playback state when src changes
  const [prevSrc, setPrevSrc] = useState(src);
  if (prevSrc !== src) {
    setPrevSrc(src);
    setIsReady(false);
    setError(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setPlaybackRate(1.0);
    setIsBuffering(false);
    setPlayError(null);
  }

  // Stable refs for callbacks
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onSeekedRef = useRef(onSeeked);
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
    onSeekedRef.current = onSeeked;
  });

  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const audio = audioRef.current;
    if (!audio) return;

    isPlayingRef.current = false;
    retryCountRef.current = 0;
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    if (readyTimeoutRef.current) { clearTimeout(readyTimeoutRef.current); readyTimeoutRef.current = null; }

    // Revoke previous blob URL
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }

    const handleLoadedMetadata = () => {
      if (cancelled) return;
      const d = audio.duration;
      if (isFinite(d) && d > 0) setDuration(d);
    };
    const handleDurationChange = () => {
      if (cancelled) return;
      const d = audio.duration;
      if (isFinite(d) && d > 0) setDuration(d);
    };
    const handleCanPlay = () => {
      if (cancelled) return;
      if (readyTimeoutRef.current) { clearTimeout(readyTimeoutRef.current); readyTimeoutRef.current = null; }
      if (audio.currentTime > 0.05) audio.currentTime = 0;
      setIsReady(true);
    };
    const handleTimeUpdate = () => {
      if (cancelled) return;
      setCurrentTime(audio.currentTime);
      const d = audio.duration;
      if (isFinite(d) && d > 0) setDuration(prev => prev > 0 ? prev : d);
      onTimeUpdateRef.current?.(audio.currentTime, audio.duration);
    };
    const handleEnded = () => {
      if (cancelled) return;
      isPlayingRef.current = false;
      setIsPlaying(false);
    };
    const handleWaiting = () => { if (!cancelled) setIsBuffering(true); };
    const handlePlaying = () => { if (!cancelled) setIsBuffering(false); };
    const handleStalled = () => {
      if (!cancelled && audio.readyState < 3) setIsBuffering(true);
    };
    const handleError = () => {
      if (cancelled) return;
      const code = audio.error?.code;
      console.warn('[AudioPlayer] error event, code:', code, 'message:', audio.error?.message);
      if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED && retryCountRef.current < 2) {
        retryCountRef.current++;
        retryTimerRef.current = setTimeout(() => {
          if (cancelled) return;
          audio.load();
        }, 500 * retryCountRef.current);
        return;
      }
      if (readyTimeoutRef.current) { clearTimeout(readyTimeoutRef.current); readyTimeoutRef.current = null; }
      if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        setError('Audio format not supported. Try converting to MP3 or OGG.');
      } else {
        setError('Failed to load audio. The format may not be supported.');
      }
    };
    const handleSeeked = () => {
      if (cancelled) return;
      onSeekedRef.current?.();
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('stalled', handleStalled);
    audio.addEventListener('seeked', handleSeeked);

    // Fetch audio data via JS fetch() and create a blob URL.
    // WebKitGTK's GStreamer souphttpsrc cannot reliably load <audio> from
    // HTTP URLs — canplay never fires. Fetching via JS and using a blob://
    // URL works because GStreamer handles blob sources via its appsrc path.
    const mime = getMimeType(fileExtension);
    console.debug('[AudioPlayer] Fetching audio from:', src);
    fetch(src)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then(blob => {
        if (cancelled) return;
        const blobUrl = URL.createObjectURL(new Blob([blob], { type: mime }));
        blobUrlRef.current = blobUrl;
        const source = audio.querySelector('source');
        if (source) {
          source.setAttribute('src', blobUrl);
          source.setAttribute('type', mime);
        }
        audio.load();

        // Safety timeout: if canplay never fires within 5s, show controls anyway
        readyTimeoutRef.current = setTimeout(() => {
          if (!cancelled) {
            console.warn('[AudioPlayer] canplay not received within 5s, enabling controls');
            setIsReady(true);
          }
        }, 5000);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('[AudioPlayer] Failed to fetch audio:', err);
        setError('Failed to load audio file.');
      });

    return () => {
      cancelled = true;
      audio.pause();
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      if (readyTimeoutRef.current) { clearTimeout(readyTimeoutRef.current); readyTimeoutRef.current = null; }
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('stalled', handleStalled);
      audio.removeEventListener('seeked', handleSeeked);
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    };
  }, [src, fileExtension]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.loop = isLooping;
  }, [isLooping]);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !isReady) return;
    audio.play().then(() => {
      isPlayingRef.current = true;
      setIsPlaying(true);
      setPlayError(null);
    }).catch(err => {
      console.error('Failed to play:', err);
      setPlayError('Failed to play audio. Try again or save the file to open with an external player.');
    });
  }, [isReady]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    isPlayingRef.current = false;
    setIsPlaying(false);
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    isPlayingRef.current = false;
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const skipBack = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !isReady) return;
    audio.currentTime = Math.max(0, audio.currentTime - 10);
  }, [isReady]);

  const skipForward = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !isReady) return;
    audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
  }, [isReady]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = time;
    setCurrentTime(time);
  }, []);

  const handleSetVolume = useCallback((v: number) => {
    setVolume(v);
    if (audioRef.current) {
      audioRef.current.volume = v;
      if (v > 0) { audioRef.current.muted = false; setIsMuted(false); }
    }
  }, []);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const newMuted = !isMuted;
    audio.muted = newMuted;
    setIsMuted(newMuted);
  }, [isMuted]);

  const toggleLoop = useCallback(() => {
    setIsLooping(prev => {
      const next = !prev;
      if (audioRef.current) audioRef.current.loop = next;
      return next;
    });
  }, []);

  const cycleSpeed = useCallback(() => {
    const idx = SPEED_OPTIONS.indexOf(playbackRate as typeof SPEED_OPTIONS[number]);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    setPlaybackRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, [playbackRate]);

  const clearPlayError = useCallback(() => setPlayError(null), []);

  const mimeType = getMimeType(fileExtension);

  return {
    audioRef,
    mimeType,
    state: { isReady, isPlaying, currentTime, duration, error, isBuffering, playError, isLooping, isMuted, volume, playbackRate },
    actions: { play, pause, stop, skipBack, skipForward, seek, setVolume: handleSetVolume, toggleMute, toggleLoop, cycleSpeed, clearPlayError },
  };
}
