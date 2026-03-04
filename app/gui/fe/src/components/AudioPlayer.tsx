import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties } from 'react';
import { DelayedSpinner } from './LoadingSpinner';

interface AudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  trackNumber?: number;
  year?: number;
  picture?: { data: Uint8Array; format: string } | null;
}

function MetadataAlbumArt({ picture }: { picture: { data: Uint8Array; format: string } }) {
  const url = useMemo(() => {
    const blob = new Blob([picture.data as BlobPart], { type: picture.format });
    return URL.createObjectURL(blob);
  }, [picture]);

  useEffect(() => {
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return (
    <img
      src={url}
      alt="Album art"
      className="w-10 h-10 rounded-[2px] object-cover flex-shrink-0"
    />
  );
}

interface AudioPlayerProps {
  data: Uint8Array;
  fileExtension: string;
  onExport?: () => void;
}

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

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function getConversionHint(ext: string): string | null {
  const hints: Record<string, string> = {
    '.flac': 'Try converting to MP3: ffmpeg -i file.flac -q:a 2 output.mp3',
    '.aac': 'Try converting to MP3: ffmpeg -i file.aac -c:a libmp3lame output.mp3',
    '.opus': 'Try converting to OGG: ffmpeg -i file.opus -c:a libvorbis output.ogg',
    '.m4a': 'Try converting to MP3: ffmpeg -i file.m4a -c:a libmp3lame output.mp3',
    '.wav': 'WAV is usually supported. The file may be corrupted or use an uncommon codec.',
  };
  return hints[ext.toLowerCase()] ?? null;
}

/** Minimal in-place radix-2 Cooley-Tukey FFT. n must be a power of 2. */
function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len *= 2) {
    const half = len >> 1;
    const ang = -2 * Math.PI / len;
    const wR = Math.cos(ang), wI = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cR = 1, cI = 0;
      for (let j = 0; j < half; j++) {
        const k = i + j + half;
        const tR = cR * re[k] - cI * im[k];
        const tI = cR * im[k] + cI * re[k];
        re[k] = re[i + j] - tR;
        im[k] = im[i + j] - tI;
        re[i + j] += tR;
        im[i + j] += tI;
        const nR = cR * wR - cI * wI;
        cI = cR * wI + cI * wR;
        cR = nR;
      }
    }
  }
}

/** Text that scrolls horizontally on hover when it overflows its container. */
function MarqueeText({ text, className }: { text: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const spanRef = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const span = spanRef.current;
    if (!container || !span) return;
    const cw = container.clientWidth;
    const sw = span.scrollWidth;
    const isOverflowing = sw > cw;
    setOverflows(isOverflowing);
    setOffset(isOverflowing ? cw - sw : 0);
  }, [text]);

  return (
    <div
      ref={containerRef}
      className={`marquee-on-hover ${className ?? ''}`}
      style={{ '--marquee-offset': `${offset}px` } as CSSProperties}
    >
      <span ref={spanRef} className={overflows ? 'marquee-overflows' : ''}>
        {text}
      </span>
    </div>
  );
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

const BAR_COUNT = 32;
const FFT_SIZE = 1024;
const SMOOTHING = 0.8;
const TARGET_FPS = 24;
const FRAME_INTERVAL = 1000 / TARGET_FPS;
const WAVEFORM_BUCKETS = 200;

/** Downsample audio channel to peak values per bucket for waveform overview. */
function computeWaveformSummary(channel: Float32Array, buckets: number): Float32Array {
  const samplesPerBucket = Math.floor(channel.length / buckets);
  if (samplesPerBucket < 1) return new Float32Array(0);
  const summary = new Float32Array(buckets);
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = i * samplesPerBucket;
    for (let j = 0; j < samplesPerBucket; j++) {
      const abs = Math.abs(channel[start + j] || 0);
      if (abs > max) max = abs;
    }
    summary[i] = max;
  }
  return summary;
}

export default function AudioPlayer({ data, fileExtension, onExport }: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.75);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [showRemaining, setShowRemaining] = useState(false);
  const [metadata, setMetadata] = useState<AudioMetadata | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [showKeyHints, setShowKeyHints] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [visualizationFailed, setVisualizationFailed] = useState(false);

  // Native <audio> element for playback — no Web Audio API in the output path
  const audioRef = useRef<HTMLAudioElement>(null);
  // Decoded PCM buffer for FFT visualization (not for playback)
  const bufferRef = useRef<AudioBuffer | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const seekBarRef = useRef<HTMLDivElement | null>(null);
  const isPlayingRef = useRef(false);
  const isSeekingRef = useRef(false);
  const prevBarsRef = useRef(new Float32Array(BAR_COUNT));
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformDataRef = useRef<Float32Array | null>(null);
  const fftReRef = useRef(new Float32Array(FFT_SIZE));
  const fftImRef = useRef(new Float32Array(FFT_SIZE));
  // Smooth time interpolation — audio.currentTime updates ~4Hz on WebKitGTK,
  // we interpolate between updates for fluid visualization
  const vizTimeRef = useRef(0);
  const lastDrawTimeRef = useRef(0);
  // Cached CSS gradient colors — updated on mount + theme change via MutationObserver
  const gradientColorsRef = useRef({ start: '#6366f1', mid: '#818cf8', end: '#a5b4fc' });
  const hasShownHintsRef = useRef(false);
  // RAF loop control — stops when paused + bars fully decayed, restarts on play
  const rafActiveRef = useRef(false);
  const startLoopRef = useRef<(() => void) | null>(null);
  const drawWaveformRef = useRef<((progress: number) => void) | null>(null);
  const waveformContainerRef = useRef<HTMLDivElement | null>(null);
  const seekBarTooltipRef = useRef<HTMLDivElement | null>(null);
  const waveformTooltipRef = useRef<HTMLDivElement | null>(null);
  const pcmDecodedRef = useRef(false);

  // --- Cache CSS gradient colors (avoids getComputedStyle per frame) ---

  useEffect(() => {
    const readColors = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const styles = getComputedStyle(canvas);
      gradientColorsRef.current = {
        start: styles.getPropertyValue('--audio-gradient-start').trim() || '#6366f1',
        mid: styles.getPropertyValue('--audio-gradient-mid').trim() || '#818cf8',
        end: styles.getPropertyValue('--audio-gradient-end').trim() || '#a5b4fc',
      };
    };

    readColors();

    const observer = new MutationObserver(readColors);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => observer.disconnect();
  }, []);

  // --- Load audio element + decode PCM for visualization ---

  useEffect(() => {
    let cancelled = false;
    const audio = audioRef.current;
    if (!audio) return;

    setIsReady(false);
    setError(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setPlaybackRate(1.0);
    setMetadata(null);
    setIsBuffering(false);
    setVisualizationFailed(false);
    isPlayingRef.current = false;
    vizTimeRef.current = 0;
    lastDrawTimeRef.current = 0;
    prevBarsRef.current.fill(0);
    bufferRef.current = null;
    waveformDataRef.current = null;
    pcmDecodedRef.current = false;

    // Blob URL for native <audio> playback — GStreamer handles output directly,
    // completely bypassing AudioContext.destination (which is broken on WebKitGTK)
    const blob = new Blob([data], { type: getMimeType(fileExtension) });
    const url = URL.createObjectURL(blob);
    audio.src = url;

    // Parse ID3/Vorbis metadata (best-effort, doesn't affect playback)
    import('music-metadata').then(({ parseBuffer }) => {
      parseBuffer(new Uint8Array(data), { mimeType: getMimeType(fileExtension) })
        .then(result => {
          if (cancelled) return;
          const { common } = result;
          const pic = common.picture?.[0];
          setMetadata({
            title: common.title,
            artist: common.artist,
            album: common.album,
            trackNumber: common.track?.no ?? undefined,
            year: common.year,
            picture: pic ? { data: new Uint8Array(pic.data), format: pic.format } : null,
          });
        })
        .catch(() => {});
    }).catch(() => {});

    const onLoadedMetadata = () => { if (!cancelled) setDuration(audio.duration); };
    const onCanPlay = () => {
      if (cancelled) return;
      // Ensure playback starts from the beginning — GStreamer can report a
      // non-zero currentTime after parsing certain container formats.
      audio.currentTime = 0;
      setIsReady(true);
      // Start PCM decode now that GStreamer pipeline is fully ready.
      // Decoding before canplay contends with GStreamer on the audio thread,
      // causing skipping/lagging on initial playback.
      if (!pcmDecodedRef.current) {
        pcmDecodedRef.current = true;
        const offlineCtx = new OfflineAudioContext(2, 1, 44100);
        offlineCtx.decodeAudioData(data.slice().buffer)
          .then(buffer => {
            if (cancelled) return;
            bufferRef.current = buffer;
            waveformDataRef.current = computeWaveformSummary(buffer.getChannelData(0), WAVEFORM_BUCKETS);
            drawWaveformRef.current?.(0);
          })
          .catch(() => {
            if (!cancelled) setVisualizationFailed(true);
          });
      }
    };
    const onTimeUpdate = () => {
      if (cancelled) return;
      setCurrentTime(audio.currentTime);
      // Re-sync visualization time to prevent drift
      vizTimeRef.current = audio.currentTime;
    };
    const onEnded = () => {
      if (cancelled) return;
      isPlayingRef.current = false;
      setIsPlaying(false);
    };
    const onWaiting = () => { if (!cancelled) setIsBuffering(true); };
    const onPlaying = () => { if (!cancelled) setIsBuffering(false); };
    const onStalled = () => {
      // Only treat as buffering if we don't have enough data for continuous playback.
      // readyState < 3 (HAVE_FUTURE_DATA) means the browser lacks sufficient buffered data.
      if (!cancelled && audio.readyState < 3) setIsBuffering(true);
    };
    const onError = () => {
      if (cancelled) return;
      const code = audio.error?.code;
      if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        setError('Audio format not supported. Try converting to MP3 or OGG.');
      } else {
        setError('Failed to load audio. The format may not be supported.');
      }
    };

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('stalled', onStalled);

    return () => {
      cancelled = true;
      audio.pause();
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('stalled', onStalled);
      // Detach from GStreamer before revoking
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      cancelAnimationFrame(rafRef.current);
    };
  }, [data, fileExtension]);

  // --- Waveform overview drawing ---

  const drawWaveform = useCallback((progressRatio: number) => {
    const canvas = waveformCanvasRef.current;
    const waveform = waveformDataRef.current;
    if (!canvas || !waveform || waveform.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const barW = width / waveform.length;
    const mid = height / 2;

    for (let i = 0; i < waveform.length; i++) {
      const h = waveform[i] * mid * 0.9;
      const x = i * barW;
      const isPlayed = (i / waveform.length) <= progressRatio;

      ctx.fillStyle = isPlayed
        ? 'rgba(99, 102, 241, 0.6)'
        : 'rgba(99, 102, 241, 0.15)';

      ctx.fillRect(x, mid - h, barW - 0.5, h * 2);
    }

    // Playback position indicator — bright vertical line at current position
    if (progressRatio > 0) {
      const indicatorX = Math.round(progressRatio * width);
      // Glow behind
      ctx.fillStyle = 'rgba(250, 250, 250, 0.3)';
      ctx.fillRect(indicatorX - 2, 0, 6, height);
      // Main line
      ctx.fillStyle = 'rgba(250, 250, 250, 0.9)';
      ctx.fillRect(indicatorX, 0, 2, height);
    }
  }, []);

  // Keep ref in sync so the data-loading effect can call it without a dependency
  drawWaveformRef.current = drawWaveform;

  // --- Visualization: FFT computed from decoded AudioBuffer ---

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const { start: gradStart, mid: gradMid, end: gradEnd } = gradientColorsRef.current;

    // Single gradient reused for all bars (avoids 768+ gradient allocations/sec)
    const barGradient = ctx.createLinearGradient(0, height, 0, 0);
    barGradient.addColorStop(0, gradStart);
    barGradient.addColorStop(0.5, gradMid);
    barGradient.addColorStop(1, gradEnd);

    const buffer = bufferRef.current;
    const audio = audioRef.current;
    const gap = 2;
    const barWidth = (width - gap * (BAR_COUNT - 1)) / BAR_COUNT;

    // Advance interpolated time smoothly between audio.currentTime updates
    const now = performance.now();
    if (lastDrawTimeRef.current > 0 && isPlayingRef.current) {
      vizTimeRef.current += (now - lastDrawTimeRef.current) / 1000;
    }
    lastDrawTimeRef.current = now;

    if (buffer && audio && isPlayingRef.current) {
      const channel = buffer.getChannelData(0);
      const startSample = Math.floor(vizTimeRef.current * buffer.sampleRate);

      const re = fftReRef.current;
      const im = fftImRef.current;
      re.fill(0);
      im.fill(0);

      // Hann-windowed samples
      for (let i = 0; i < FFT_SIZE; i++) {
        const idx = startSample + i;
        const sample = idx >= 0 && idx < channel.length ? channel[idx] : 0;
        re[i] = sample * 0.5 * (1 - Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));
      }

      fftInPlace(re, im);

      const binsPerBar = Math.floor((FFT_SIZE / 2) / BAR_COUNT);

      for (let i = 0; i < BAR_COUNT; i++) {
        let mag = 0;
        for (let j = 0; j < binsPerBar; j++) {
          const k = i * binsPerBar + j;
          mag += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        }
        // dB-scale normalization (similar to AnalyserNode)
        const avgMag = mag / binsPerBar;
        const dB = avgMag > 0 ? 20 * Math.log10(avgMag / FFT_SIZE) : -100;
        const normalized = Math.max(0, Math.min(1, (dB + 70) / 50)); // -70dB floor, -20dB ceiling
        prevBarsRef.current[i] = SMOOTHING * prevBarsRef.current[i] + (1 - SMOOTHING) * normalized;

        const barHeight = prevBarsRef.current[i] * height;
        const x = i * (barWidth + gap);
        const y = height - barHeight;

        ctx.fillStyle = barGradient;

        const segH = 3, segGap = 1;
        let curY = height;
        while (curY > y) {
          const top = Math.max(y, curY - segH);
          ctx.fillRect(x, top, barWidth, curY - top);
          curY -= segH + segGap;
        }
      }
    } else {
      // Decay bars smoothly when not playing
      for (let i = 0; i < BAR_COUNT; i++) {
        prevBarsRef.current[i] *= 0.92;
        if (prevBarsRef.current[i] < 0.005) continue;

        const barHeight = prevBarsRef.current[i] * height;
        const x = i * (barWidth + gap);
        const y = height - barHeight;

        ctx.fillStyle = barGradient;

        const segH = 3, segGap = 1;
        let curY = height;
        while (curY > y) {
          const top = Math.max(y, curY - segH);
          ctx.fillRect(x, top, barWidth, curY - top);
          curY -= segH + segGap;
        }
      }
    }

    // Update waveform progress overlay
    if (waveformDataRef.current && duration > 0) {
      drawWaveform(vizTimeRef.current / duration);
    }
  }, [duration, drawWaveform]);

  // Animation loop — throttled to TARGET_FPS, pauses when window is not visible,
  // stops entirely when paused + bars fully decayed (saves ~24 drawFrame calls/sec idle)
  useEffect(() => {
    let running = true;
    let lastTime = 0;

    const startLoop = () => {
      if (!running || rafActiveRef.current) return;
      rafActiveRef.current = true;
      const loop = (now: number) => {
        if (!running || document.hidden) {
          rafActiveRef.current = false;
          return;
        }
        if (now - lastTime >= FRAME_INTERVAL) {
          lastTime = now;
          drawFrame();

          // Stop loop when paused and all bars have decayed to zero
          if (!isPlayingRef.current && prevBarsRef.current.every(v => v < 0.005)) {
            rafActiveRef.current = false;
            return;
          }
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    };

    startLoopRef.current = startLoop;

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafRef.current);
        rafActiveRef.current = false;
      } else {
        lastTime = 0;
        startLoop();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) startLoop();

    return () => {
      running = false;
      rafActiveRef.current = false;
      startLoopRef.current = null;
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [drawFrame]);

  // --- Sync loop property ---
  useEffect(() => {
    if (audioRef.current) audioRef.current.loop = isLooping;
  }, [isLooping]);

  // --- Transport handlers ---

  const handlePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !isReady) return;
    audio.play().then(() => {
      vizTimeRef.current = audio.currentTime;
      lastDrawTimeRef.current = performance.now();
      isPlayingRef.current = true;
      setIsPlaying(true);
      // Restart animation loop if it was stopped after decay
      startLoopRef.current?.();
    }).catch(err => {
      console.error('Failed to play:', err);
      setError('Failed to play audio.');
    });
  }, [isReady]);

  const handlePause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    isPlayingRef.current = false;
    setIsPlaying(false);
  }, []);

  const handleStop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    vizTimeRef.current = 0;
    lastDrawTimeRef.current = 0;
    isPlayingRef.current = false;
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const handleSkipBack = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !isReady) return;
    audio.currentTime = Math.max(0, audio.currentTime - 10);
    vizTimeRef.current = audio.currentTime;
  }, [isReady]);

  const handleSkipForward = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !isReady) return;
    audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
    vizTimeRef.current = audio.currentTime;
  }, [isReady]);

  const handleMuteToggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const newMuted = !isMuted;
    audio.muted = newMuted;
    setIsMuted(newMuted);
  }, [isMuted]);

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Show keyboard shortcut hints on first interaction
      if (!hasShownHintsRef.current) {
        hasShownHintsRef.current = true;
        setShowKeyHints(true);
        setTimeout(() => setShowKeyHints(false), 3000);
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (isPlaying) handlePause();
          else handlePlay();
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
          setVolume(v => {
            const next = Math.min(1, v + 0.05);
            if (audioRef.current) { audioRef.current.volume = next; audioRef.current.muted = false; }
            setIsMuted(false);
            return next;
          });
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(v => {
            const next = Math.max(0, v - 0.05);
            if (audioRef.current) { audioRef.current.volume = next; audioRef.current.muted = next === 0; }
            setIsMuted(next === 0);
            return next;
          });
          break;
        case 'm':
        case 'M':
          handleMuteToggle();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, handlePlay, handlePause, handleSkipBack, handleSkipForward, handleMuteToggle]);

  const handleSeekMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !seekBarRef.current || !duration || !isReady) return;
    isSeekingRef.current = true;

    const seekTo = (clientX: number) => {
      const rect = seekBarRef.current!.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      audio.currentTime = ratio * duration;
      vizTimeRef.current = audio.currentTime;
      setCurrentTime(audio.currentTime);
      drawWaveformRef.current?.(ratio);
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
  }, [duration, isReady]);

  const handleWaveformMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !waveformContainerRef.current || !duration || !isReady) return;
    e.preventDefault();
    isSeekingRef.current = true;

    const seekTo = (clientX: number) => {
      const rect = waveformContainerRef.current!.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      audio.currentTime = ratio * duration;
      vizTimeRef.current = audio.currentTime;
      setCurrentTime(audio.currentTime);
      drawWaveformRef.current?.(ratio);
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
  }, [duration, isReady]);

  const handleSeekKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !isReady || !duration) return;

    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':
        audio.currentTime = Math.max(0, audio.currentTime - 5);
        break;
      case 'ArrowRight':
        audio.currentTime = Math.min(duration, audio.currentTime + 5);
        break;
      case 'Home':
        audio.currentTime = 0;
        break;
      case 'End':
        audio.currentTime = duration;
        break;
      default:
        handled = false;
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation(); // Prevent global keydown handler from also seeking ±10s
      vizTimeRef.current = audio.currentTime;
      setCurrentTime(audio.currentTime);
      if (duration > 0) drawWaveformRef.current?.(audio.currentTime / duration);
    }
  }, [isReady, duration]);

  // --- Seek preview tooltip (ref-based DOM mutation, zero re-renders) ---

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
    const halfW = 28; // approximate half-width of "MM:SS" text
    const rawLeft = clientX - rect.left;
    const clampedLeft = Math.max(halfW, Math.min(rect.width - halfW, rawLeft));
    tooltip.style.left = `${clampedLeft}px`;
    tooltip.style.opacity = '1';
    tooltip.textContent = formatTime(ratio * duration);
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

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (audioRef.current) {
      audioRef.current.volume = v;
      if (v > 0) { audioRef.current.muted = false; setIsMuted(false); }
    }
  }, []);

  const handleToggleLoop = useCallback(() => {
    setIsLooping(prev => {
      const next = !prev;
      if (audioRef.current) audioRef.current.loop = next;
      return next;
    });
  }, []);

  const handleSpeedChange = useCallback(() => {
    const idx = SPEED_OPTIONS.indexOf(playbackRate as typeof SPEED_OPTIONS[number]);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    setPlaybackRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, [playbackRate]);

  // --- Render ---

  if (error) {
    const mime = getMimeType(fileExtension);
    const ext = (fileExtension || '.mp3').toUpperCase().slice(1);
    const conversionHint = getConversionHint(fileExtension);

    return (
      <div className="bg-[var(--winamp-bg)] border border-[var(--winamp-border-dark)] rounded-[var(--radius-sm)] overflow-hidden shadow-lg">
        <div className="p-6 text-center space-y-3">
          <svg className="w-8 h-8 mx-auto mb-2 text-[var(--error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-[var(--error)]">{error}</p>
          <p className="text-xs text-[var(--text-muted)]">
            Detected format: <span className="font-mono">{ext}</span> ({mime})
          </p>
          {conversionHint && (
            <p className="text-xs text-[var(--text-secondary)] font-mono">{conversionHint}</p>
          )}
          {onExport && (
            <button
              onClick={onExport}
              className="mt-2 px-4 py-2 text-sm bg-[var(--winamp-bg-light)] winamp-bevel rounded-[2px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:brightness-125 transition-all duration-75 cursor-pointer"
            >
              Save As to open with an external player
            </button>
          )}
        </div>
      </div>
    );
  }

  const transportBtn =
    'w-8 h-8 flex items-center justify-center bg-[var(--winamp-bg-light)] rounded-[2px] winamp-bevel hover:brightness-125 active:winamp-groove transition-all duration-75 cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)] outline-none focus-visible:shadow-[var(--focus-ring)]';
  const transportBtnLg =
    'w-10 h-10 flex items-center justify-center bg-[var(--winamp-bg-light)] rounded-[2px] winamp-bevel hover:brightness-125 active:winamp-groove transition-all duration-75 cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)] outline-none focus-visible:shadow-[var(--focus-ring)]';

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="bg-[var(--winamp-bg)] border border-[var(--winamp-border-dark)] rounded-[var(--radius-sm)] overflow-hidden shadow-lg">
      {/* Hidden audio element — native GStreamer output, no Web Audio API */}
      <audio ref={audioRef} preload="auto" style={{ display: 'none' }} />

      {/* Title Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gradient-to-r from-[var(--winamp-bg-dark)] to-[var(--winamp-bg)] border-b border-[var(--winamp-border-dark)]">
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] opacity-60" />
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] opacity-30" />
          </div>
          <span className="text-xs font-bold tracking-wider text-[var(--accent)] uppercase">
            Veiled Audio
          </span>
        </div>
        <span className="text-[10px] text-[var(--text-muted)]">
          {(fileExtension || '.mp3').toUpperCase().slice(1)}
        </span>
      </div>

      {/* Metadata Display */}
      {metadata && (metadata.title || metadata.artist || metadata.album) && (
        <div className="flex items-center gap-3 px-3 pt-2">
          {metadata.picture && (
            <MetadataAlbumArt picture={metadata.picture} />
          )}
          <div className="flex-1 min-w-0">
            {metadata.title && (
              <MarqueeText
                text={metadata.title}
                className="text-xs font-medium text-[var(--text-primary)]"
              />
            )}
            {metadata.artist && (
              <MarqueeText
                text={metadata.artist}
                className="text-[10px] text-[var(--text-secondary)]"
              />
            )}
            {(metadata.album || metadata.year) && (
              <MarqueeText
                text={`${[metadata.album, metadata.year].filter(Boolean).join(' \u2014 ')}${metadata.trackNumber ? ` (Track ${metadata.trackNumber})` : ''}`}
                className="text-[10px] text-[var(--text-muted)]"
              />
            )}
          </div>
        </div>
      )}

      {/* Visualization Canvas (waveform behind, FFT on top) */}
      <div
        ref={waveformContainerRef}
        className="winamp-groove mx-2 mt-2 relative cursor-pointer"
        onMouseDown={handleWaveformMouseDown}
        onMouseMove={handleWaveformMouseMove}
        onMouseLeave={handleWaveformMouseLeave}
      >
        <canvas
          ref={waveformCanvasRef}
          width={480}
          height={120}
          className="w-full block bg-[var(--winamp-bg-dark)] absolute inset-0"
          style={{ imageRendering: 'pixelated' }}
          aria-hidden="true"
        />
        <canvas
          ref={canvasRef}
          width={480}
          height={120}
          className="w-full block relative"
          style={{ imageRendering: 'pixelated' }}
          aria-hidden="true"
        />
        {!isReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--winamp-bg-dark)]/80">
            <DelayedSpinner size="sm" className="mr-2" />
            <span className="text-xs text-[var(--text-muted)]">Loading audio...</span>
          </div>
        )}
        {showKeyHints && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/80 text-white text-xs rounded-[var(--radius-md)] px-4 py-3 pointer-events-none z-10 whitespace-nowrap transition-opacity duration-[var(--transition-slow)]">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              <span><kbd className="font-mono bg-white/20 px-1.5 py-0.5 rounded text-[11px]">Space</kbd> Play/Pause</span>
              <span><kbd className="font-mono bg-white/20 px-1.5 py-0.5 rounded text-[11px]">&larr; &rarr;</kbd> Seek &plusmn;10s</span>
              <span><kbd className="font-mono bg-white/20 px-1.5 py-0.5 rounded text-[11px]">&uarr; &darr;</kbd> Volume</span>
              <span><kbd className="font-mono bg-white/20 px-1.5 py-0.5 rounded text-[11px]">M</kbd> Mute</span>
            </div>
          </div>
        )}
        <div
          ref={waveformTooltipRef}
          className="absolute -top-6 -translate-x-1/2 bg-black/80 text-white text-[11px] font-mono rounded px-1.5 py-0.5 pointer-events-none select-none z-20 transition-opacity duration-75"
          style={{ opacity: 0 }}
          aria-hidden="true"
        />
        {visualizationFailed && isReady && (
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] text-[var(--text-muted)] pointer-events-none select-none">
            Visualization unavailable for this format
          </div>
        )}
      </div>

      {/* LED Display Row */}
      <div className="flex items-center justify-between px-3 py-2">
        <div
          className="winamp-groove px-3 py-1 bg-[var(--winamp-bg-dark)] cursor-pointer select-none"
          onClick={() => setShowRemaining(r => !r)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowRemaining(r => !r); } }}
          role="button"
          tabIndex={0}
          title="Click to toggle remaining time"
          aria-label={showRemaining ? 'Showing remaining time, click for total' : 'Showing total time, click for remaining'}
        >
          <span className="winamp-led-text text-lg font-medium">
            {formatTime(currentTime)}
          </span>
          <span className="text-[var(--text-muted)] text-xs mx-1">/</span>
          <span className="winamp-led-text text-sm opacity-60">
            {showRemaining ? `\u2212${formatTime(Math.max(0, duration - currentTime))}` : formatTime(duration)}
          </span>
        </div>
        <span className="text-[10px] font-bold tracking-widest text-[var(--text-muted)] uppercase" aria-live="polite" aria-atomic="true">
          {!isReady ? 'Loading' : isBuffering && isPlaying ? 'Buffering' : isPlaying ? 'Playing' : currentTime > 0 ? 'Paused' : 'Ready'}
        </span>
      </div>

      {/* Seek Bar — outer wrapper expands click target to ~24px while visual bar stays 8px */}
      <div className="px-3">
        <div
          className="py-2 cursor-pointer relative"
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
            className="absolute -top-1 -translate-x-1/2 bg-black/80 text-white text-[11px] font-mono rounded px-1.5 py-0.5 pointer-events-none select-none z-20 transition-opacity duration-75"
            style={{ opacity: 0 }}
            aria-hidden="true"
          />
          <div
            ref={seekBarRef}
            className="winamp-groove h-2 bg-[var(--winamp-bg-dark)] relative outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)]"
              style={{ width: `${progress}%` }}
            />
            {/* Seek thumb */}
            <div
              className="absolute top-1/2 w-3 h-3 rounded-full bg-white border-2 border-[var(--accent)] shadow-sm pointer-events-none"
              style={{ left: `${progress}%`, transform: 'translateX(-50%) translateY(-50%)' }}
            />
          </div>
        </div>
      </div>

      {/* Transport Controls + Volume */}
      <div className="flex items-center justify-between px-3 py-2.5 border-t border-[var(--winamp-border-dark)]">
        <div className="flex items-center gap-1">
          {/* Skip Back */}
          <button onClick={handleSkipBack} className={transportBtn} title="Back 10s" aria-label="Skip back 10 seconds">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
            </svg>
          </button>

          {/* Play / Pause */}
          <button
            onClick={isPlaying ? handlePause : handlePlay}
            className={transportBtnLg}
            title={isPlaying ? 'Pause' : 'Play'}
            aria-label={isPlaying ? 'Pause' : 'Play'}
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

          {/* Stop */}
          <button onClick={handleStop} className={transportBtn} title="Stop" aria-label="Stop">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h12v12H6z" />
            </svg>
          </button>

          {/* Skip Forward */}
          <button onClick={handleSkipForward} className={transportBtn} title="Forward 10s" aria-label="Skip forward 10 seconds">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
            </svg>
          </button>

          {/* Loop Toggle */}
          <button
            onClick={handleToggleLoop}
            className={`${transportBtn} ml-1 ${isLooping ? '!text-[var(--accent)]' : ''}`}
            title={isLooping ? 'Repeat: On' : 'Repeat: Off'}
            aria-label={isLooping ? 'Disable repeat' : 'Enable repeat'}
            aria-pressed={isLooping}
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
            </svg>
          </button>

          {/* Playback Speed */}
          <button
            onClick={handleSpeedChange}
            className={`${transportBtn} ml-1 text-[10px] font-bold tracking-tight min-w-[32px] ${playbackRate !== 1 ? '!text-[var(--accent)]' : ''}`}
            title={`Speed: ${playbackRate}x`}
            aria-label={`Playback speed: ${playbackRate}x`}
          >
            {playbackRate}x
          </button>
        </div>

        {/* Volume */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleMuteToggle}
            className="w-6 h-6 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-75 cursor-pointer outline-none focus-visible:shadow-[var(--focus-ring)]"
            title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
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
            onChange={handleVolumeChange}
            className="winamp-slider w-20"
            aria-label="Volume"
          />
        </div>
      </div>
    </div>
  );
}
