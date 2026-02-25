import { useState, useRef, useEffect, useCallback } from 'react';
import LoadingSpinner from './LoadingSpinner';

interface AudioPlayerProps {
  data: Uint8Array;
  fileExtension: string;
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
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
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

const BAR_COUNT = 32;
const FFT_SIZE = 1024;
const SMOOTHING = 0.8;
const TARGET_FPS = 24;
const FRAME_INTERVAL = 1000 / TARGET_FPS;

export default function AudioPlayer({ data, fileExtension }: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.75);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Native <audio> element for playback — no Web Audio API in the output path
  const audioRef = useRef<HTMLAudioElement>(null);
  // Decoded PCM buffer for FFT visualization (not for playback)
  const bufferRef = useRef<AudioBuffer | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const seekBarRef = useRef<HTMLDivElement | null>(null);
  const isPlayingRef = useRef(false);
  const prevBarsRef = useRef(new Float32Array(BAR_COUNT));
  const fftReRef = useRef(new Float32Array(FFT_SIZE));
  const fftImRef = useRef(new Float32Array(FFT_SIZE));
  // Smooth time interpolation — audio.currentTime updates ~4Hz on WebKitGTK,
  // we interpolate between updates for fluid visualization
  const vizTimeRef = useRef(0);
  const lastDrawTimeRef = useRef(0);

  // --- Load audio element + decode PCM for visualization ---

  useEffect(() => {
    let cancelled = false;
    const audio = audioRef.current;
    if (!audio) return;

    /* eslint-disable react-hooks/set-state-in-effect */
    setIsReady(false);
    setError(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    /* eslint-enable react-hooks/set-state-in-effect */
    isPlayingRef.current = false;
    vizTimeRef.current = 0;
    lastDrawTimeRef.current = 0;
    prevBarsRef.current.fill(0);
    bufferRef.current = null;

    // Blob URL for native <audio> playback — GStreamer handles output directly,
    // completely bypassing AudioContext.destination (which is broken on WebKitGTK)
    const blob = new Blob([new Uint8Array(data)], { type: getMimeType(fileExtension) });
    const url = URL.createObjectURL(blob);
    audio.src = url;

    // Decode in parallel for FFT visualization (doesn't affect playback)
    const offlineCtx = new OfflineAudioContext(2, 1, 44100);
    offlineCtx.decodeAudioData(data.slice().buffer)
      .then(buffer => { if (!cancelled) bufferRef.current = buffer; })
      .catch(() => {}); // Visualization degrades gracefully if decode fails

    const onLoadedMetadata = () => { if (!cancelled) setDuration(audio.duration); };
    const onCanPlay = () => { if (!cancelled) setIsReady(true); };
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

    return () => {
      cancelled = true;
      audio.pause();
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      // Detach from GStreamer before revoking
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      cancelAnimationFrame(rafRef.current);
    };
  }, [data, fileExtension]);

  // --- Visualization: FFT computed from decoded AudioBuffer ---

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

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

        const gradient = ctx.createLinearGradient(x, height, x, y);
        gradient.addColorStop(0, '#6366f1');
        gradient.addColorStop(0.5, '#818cf8');
        gradient.addColorStop(1, '#a5b4fc');
        ctx.fillStyle = gradient;

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

        const gradient = ctx.createLinearGradient(x, height, x, y);
        gradient.addColorStop(0, '#6366f1');
        gradient.addColorStop(0.5, '#818cf8');
        gradient.addColorStop(1, '#a5b4fc');
        ctx.fillStyle = gradient;

        const segH = 3, segGap = 1;
        let curY = height;
        while (curY > y) {
          const top = Math.max(y, curY - segH);
          ctx.fillRect(x, top, barWidth, curY - top);
          curY -= segH + segGap;
        }
      }
    }
  }, []);

  // Animation loop — throttled to TARGET_FPS to reduce CPU pressure on WebKitGTK
  useEffect(() => {
    let running = true;
    let lastTime = 0;
    const loop = (now: number) => {
      if (!running) return;
      if (now - lastTime >= FRAME_INTERVAL) {
        lastTime = now;
        drawFrame();
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [drawFrame]);

  // --- Transport handlers ---

  const handlePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !isReady) return;
    audio.play().then(() => {
      vizTimeRef.current = audio.currentTime;
      lastDrawTimeRef.current = performance.now();
      isPlayingRef.current = true;
      setIsPlaying(true);
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

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !seekBarRef.current || !duration || !isReady) return;
    const rect = seekBarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    vizTimeRef.current = audio.currentTime;
  }, [duration, isReady]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  }, []);

  // --- Render ---

  if (error) {
    return (
      <div className="bg-[var(--winamp-bg)] border border-[var(--winamp-border-dark)] rounded-[var(--radius-sm)] overflow-hidden shadow-lg">
        <div className="p-6 text-center space-y-2">
          <p className="text-sm text-[var(--error)]">{error}</p>
          <p className="text-xs text-[var(--text-muted)]">
            Use Save As to play with an external application.
          </p>
        </div>
      </div>
    );
  }

  const transportBtn =
    'w-8 h-8 flex items-center justify-center bg-[var(--winamp-bg-light)] rounded-[2px] winamp-bevel hover:brightness-125 active:winamp-groove transition-all duration-75 cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]';
  const transportBtnLg =
    'w-10 h-10 flex items-center justify-center bg-[var(--winamp-bg-light)] rounded-[2px] winamp-bevel hover:brightness-125 active:winamp-groove transition-all duration-75 cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]';

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

      {/* Visualization Canvas */}
      <div className="winamp-groove mx-2 mt-2 relative">
        <canvas
          ref={canvasRef}
          width={480}
          height={120}
          className="w-full block bg-[var(--winamp-bg-dark)]"
          style={{ imageRendering: 'pixelated' }}
        />
        {!isReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--winamp-bg-dark)]/80">
            <LoadingSpinner size="sm" className="mr-2" />
            <span className="text-xs text-[var(--text-muted)]">Loading audio...</span>
          </div>
        )}
      </div>

      {/* LED Display Row */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="winamp-groove px-3 py-1 bg-[var(--winamp-bg-dark)]">
          <span className="winamp-led-text text-lg font-medium">
            {formatTime(currentTime)}
          </span>
          <span className="text-[var(--text-muted)] text-xs mx-1">/</span>
          <span className="winamp-led-text text-sm opacity-60">
            {formatTime(duration)}
          </span>
        </div>
        <span className="text-[10px] font-bold tracking-widest text-[var(--text-muted)] uppercase">
          {!isReady ? 'Loading' : isPlaying ? 'Playing' : currentTime > 0 ? 'Paused' : 'Ready'}
        </span>
      </div>

      {/* Seek Bar */}
      <div className="px-3 py-1">
        <div
          ref={seekBarRef}
          className="winamp-groove h-2 bg-[var(--winamp-bg-dark)] cursor-pointer relative overflow-hidden"
          onClick={handleSeek}
        >
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Transport Controls + Volume */}
      <div className="flex items-center justify-between px-3 py-2.5 border-t border-[var(--winamp-border-dark)]">
        <div className="flex items-center gap-1">
          {/* Skip Back */}
          <button onClick={handleSkipBack} className={transportBtn} title="Back 10s">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
            </svg>
          </button>

          {/* Play / Pause */}
          <button
            onClick={isPlaying ? handlePause : handlePlay}
            className={transportBtnLg}
            title={isPlaying ? 'Pause' : 'Play'}
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
          <button onClick={handleStop} className={transportBtn} title="Stop">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h12v12H6z" />
            </svg>
          </button>

          {/* Skip Forward */}
          <button onClick={handleSkipForward} className={transportBtn} title="Forward 10s">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
            </svg>
          </button>
        </div>

        {/* Volume */}
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[var(--text-muted)]" fill="currentColor" viewBox="0 0 24 24">
            {volume === 0 ? (
              <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
            ) : volume < 0.5 ? (
              <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
            ) : (
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
            )}
          </svg>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={handleVolumeChange}
            className="winamp-slider w-20"
          />
        </div>
      </div>
    </div>
  );
}
