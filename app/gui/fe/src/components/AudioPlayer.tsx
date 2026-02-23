import { useState, useRef, useEffect, useCallback } from 'react';

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

export default function AudioPlayer({ data, fileExtension }: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.75);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number>(0);
  const seekBarRef = useRef<HTMLDivElement | null>(null);
  // Accumulate old blob URLs — only revoke on unmount to avoid StrictMode race conditions.
  // GStreamer (WebKitGTK) keeps loading from the URL asynchronously, so revoking early
  // causes "Failed to load resource" errors.
  const blobUrlsRef = useRef<string[]>([]);

  // Revoke all blob URLs on unmount only
  useEffect(() => {
    return () => {
      for (const url of blobUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      blobUrlsRef.current = [];
    };
  }, []);

  // Create blob URL + Audio element
  useEffect(() => {
    const blob = new Blob([new Uint8Array(data)], { type: getMimeType(fileExtension) });
    const url = URL.createObjectURL(blob);
    blobUrlsRef.current.push(url);

    const audio = new Audio();
    audio.src = url;
    audio.volume = volume;
    audio.preload = 'auto';
    audioRef.current = audio;
    audio.load();

    const onLoadedMetadata = () => setDuration(audio.duration);
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => setIsPlaying(false);
    const onError = () => setError('Failed to decode audio. Format may not be supported.');

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      cancelAnimationFrame(animationRef.current);
      audio.pause();
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audioContextRef.current?.close();
      audioContextRef.current = null;
      sourceRef.current = null;
      analyserRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, fileExtension]);

  // Canvas visualization loop
  const drawVisualization = useCallback(() => {
    const analyser = analyserRef.current;
    const canvas = canvasRef.current;
    if (!analyser || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const barCount = 32;
      const barsPerBin = Math.floor(bufferLength / barCount);
      const gap = 2;
      const barWidth = (width - gap * (barCount - 1)) / barCount;

      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j = 0; j < barsPerBin; j++) {
          sum += dataArray[i * barsPerBin + j];
        }
        const average = sum / barsPerBin;
        const barHeight = (average / 255) * height;
        const x = i * (barWidth + gap);
        const y = height - barHeight;

        const gradient = ctx.createLinearGradient(x, height, x, y);
        gradient.addColorStop(0, '#6366f1');
        gradient.addColorStop(0.5, '#818cf8');
        gradient.addColorStop(1, '#a5b4fc');
        ctx.fillStyle = gradient;

        // Segmented bars (retro Winamp style)
        const segmentHeight = 3;
        const segmentGap = 1;
        let currentY = height;
        while (currentY > y) {
          const segTop = Math.max(y, currentY - segmentHeight);
          ctx.fillRect(x, segTop, barWidth, currentY - segTop);
          currentY -= segmentHeight + segmentGap;
        }
      }
    };

    draw();
  }, []);

  // Lazy AudioContext initialization (on first play)
  const ensureAudioContext = useCallback(async () => {
    if (audioContextRef.current) {
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      return;
    }

    const ctx = new AudioContext();
    audioContextRef.current = ctx;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    analyserRef.current = analyser;

    if (audioRef.current && !sourceRef.current) {
      const source = ctx.createMediaElementSource(audioRef.current);
      source.connect(analyser);
      analyser.connect(ctx.destination);
      sourceRef.current = source;
    }

    // Resume if created in suspended state (autoplay policy)
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    drawVisualization();
  }, [drawVisualization]);

  const handlePlay = useCallback(async () => {
    if (!audioRef.current) return;
    await ensureAudioContext();
    try {
      await audioRef.current.play();
      setIsPlaying(true);
    } catch (err) {
      console.error('Failed to play audio:', err);
      setError('Failed to play audio. The format may not be supported.');
    }
  }, [ensureAudioContext]);

  const handlePause = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    setIsPlaying(false);
  }, []);

  const handleStop = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const handleSkipBack = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10);
  }, []);

  const handleSkipForward = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.min(
      audioRef.current.duration || 0,
      audioRef.current.currentTime + 10,
    );
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !seekBarRef.current || !duration) return;
    const rect = seekBarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = ratio * duration;
  }, [duration]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  }, []);

  if (error) {
    return (
      <div className="p-4 bg-[var(--error-muted)] rounded-[var(--radius-md)] text-center">
        <p className="text-sm text-[var(--error)]">{error}</p>
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
      <div className="winamp-groove mx-2 mt-2">
        <canvas
          ref={canvasRef}
          width={480}
          height={120}
          className="w-full block bg-[var(--winamp-bg-dark)]"
          style={{ imageRendering: 'pixelated' }}
        />
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
          {isPlaying ? 'Playing' : currentTime > 0 ? 'Paused' : 'Ready'}
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
