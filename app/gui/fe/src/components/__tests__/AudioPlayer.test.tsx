import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// ── Mocks (hoisted before imports) ──────────────────────────────────

vi.mock('../LoadingSpinner', () => ({
  DelayedSpinner: ({ className }: { className?: string }) => (
    <div data-testid="spinner" className={className}>Loading...</div>
  ),
}));

const mockDecodeAudioWaveform = vi.fn().mockResolvedValue({
  waveform: Array(480).fill(0.5),
  sampleRate: 44100,
  durationSecs: 120,
  channels: 2,
  fftPcmPath: '/mock/path/pcm.raw',
});

const mockGetPcmUrl = vi.fn().mockResolvedValue('http://127.0.0.1:9999/mock-pcm.raw');

const mockDecodeAudioWaveformFast = vi.fn().mockResolvedValue({
  waveform: Array(48).fill(0.5),
  sampleRate: 44100,
  durationSecs: 120,
  channels: 2,
});

vi.mock('../../services/libraryService', () => ({
  decodeAudioWaveform: (...args: unknown[]) => mockDecodeAudioWaveform(...args),
  decodeAudioWaveformFast: (...args: unknown[]) => mockDecodeAudioWaveformFast(...args),
  getPcmUrl: (...args: unknown[]) => mockGetPcmUrl(...args),
}));

const mockObjectUrl = 'blob:mock-audio-url';
const createObjectURLSpy = vi.fn().mockReturnValue(mockObjectUrl);
const revokeObjectURLSpy = vi.fn();
globalThis.URL.createObjectURL = createObjectURLSpy;
globalThis.URL.revokeObjectURL = revokeObjectURLSpy;

globalThis.OfflineAudioContext = vi.fn().mockImplementation(() => ({
  decodeAudioData: vi.fn().mockResolvedValue({
    getChannelData: () => new Float32Array(1000),
    numberOfChannels: 2,
    sampleRate: 44100,
    length: 1000,
    duration: 1,
  }),
})) as unknown as typeof OfflineAudioContext;

const playMock = vi.fn().mockResolvedValue(undefined);
const pauseMock = vi.fn();

import AudioPlayer from '../AudioPlayer';
import { fftInPlace, normalizeWaveform } from '../audioPlayerUtils';

// ── Helpers ──────────────────────────────────────────────────────────

const mockAudioUrl = 'asset://localhost/mock-audio.mp3';

function renderPlayer(overrides: Partial<{ src: string; fileExtension: string; tokenName: string; category: string; onExport: () => void }> = {}) {
  return render(
    <AudioPlayer src={mockAudioUrl} fileExtension=".mp3" tokenName="abc123" category="audio" {...overrides} />,
  );
}

function makeAudioControllable(audio: HTMLAudioElement) {
  let _currentTime = 0;
  Object.defineProperty(audio, 'currentTime', {
    get: () => _currentTime,
    set: (v: number) => { _currentTime = v; },
    configurable: true,
  });
  Object.defineProperty(audio, 'duration', {
    value: 120,
    writable: true,
    configurable: true,
  });
}

async function fireCanPlay() {
  const audio = document.querySelector('audio')!;
  await act(async () => {
    audio.dispatchEvent(new Event('loadedmetadata'));
    audio.dispatchEvent(new Event('canplay'));
  });
}

/** Flush microtask queue so async metadata parsing and PCM decode settle. */
async function flushMicrotasks() {
  await act(async () => {
    await new Promise(r => setTimeout(r, 0));
  });
}

// MediaError is not defined in jsdom — provide it globally for the component
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;
const MEDIA_ERR_DECODE = 3;
if (typeof globalThis.MediaError === 'undefined') {
  (globalThis as Record<string, unknown>).MediaError = {
    MEDIA_ERR_ABORTED: 1,
    MEDIA_ERR_NETWORK: 2,
    MEDIA_ERR_DECODE: MEDIA_ERR_DECODE,
    MEDIA_ERR_SRC_NOT_SUPPORTED: MEDIA_ERR_SRC_NOT_SUPPORTED,
  };
}

async function fireAudioError(code: number = MEDIA_ERR_SRC_NOT_SUPPORTED) {
  const audio = document.querySelector('audio')!;
  Object.defineProperty(audio, 'error', {
    value: { code },
    configurable: true,
  });
  await act(async () => {
    audio.dispatchEvent(new Event('error'));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  playMock.mockResolvedValue(undefined);
  HTMLAudioElement.prototype.play = playMock;
  HTMLAudioElement.prototype.pause = pauseMock;
});

// ── Pure utility function tests (migrated from AudioPlayer.test.ts) ─

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

function computeWaveformSummary(channels: Float32Array[], buckets: number): Float32Array {
  if (channels.length === 0 || channels[0].length === 0) return new Float32Array(0);
  const samplesPerBucket = Math.floor(channels[0].length / buckets);
  if (samplesPerBucket < 1) return new Float32Array(0);
  const summary = new Float32Array(buckets);
  const isStereo = channels.length >= 2;
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = i * samplesPerBucket;
    for (let j = 0; j < samplesPerBucket; j++) {
      let abs = Math.abs(channels[0][start + j] || 0);
      if (isStereo) {
        const absR = Math.abs(channels[1][start + j] || 0);
        if (absR > abs) abs = absR;
      }
      if (abs > max) max = abs;
    }
    summary[i] = max;
  }
  return summary;
}

describe('getMimeType', () => {
  it('returns correct MIME type for known extensions', () => {
    expect(getMimeType('.mp3')).toBe('audio/mpeg');
    expect(getMimeType('.wav')).toBe('audio/wav');
    expect(getMimeType('.flac')).toBe('audio/flac');
    expect(getMimeType('.ogg')).toBe('audio/ogg');
    expect(getMimeType('.aac')).toBe('audio/aac');
    expect(getMimeType('.m4a')).toBe('audio/mp4');
    expect(getMimeType('.opus')).toBe('audio/opus');
  });

  it('is case-insensitive', () => {
    expect(getMimeType('.MP3')).toBe('audio/mpeg');
    expect(getMimeType('.Flac')).toBe('audio/flac');
  });

  it('returns audio/mpeg as fallback for unknown extensions', () => {
    expect(getMimeType('.xyz')).toBe('audio/mpeg');
    expect(getMimeType('')).toBe('audio/mpeg');
  });
});

describe('formatTime', () => {
  it('formats seconds as MM:SS', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(5)).toBe('00:05');
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(600)).toBe('10:00');
    expect(formatTime(3661)).toBe('1:01:01');
  });

  it('formats as H:MM:SS when duration exceeds 60 minutes', () => {
    expect(formatTime(3600)).toBe('1:00:00');
    expect(formatTime(3661)).toBe('1:01:01');
    expect(formatTime(7200)).toBe('2:00:00');
    expect(formatTime(36000)).toBe('10:00:00');
    expect(formatTime(86399)).toBe('23:59:59');
  });

  it('floors fractional seconds', () => {
    expect(formatTime(5.9)).toBe('00:05');
    expect(formatTime(59.99)).toBe('00:59');
  });

  it('returns 00:00 for invalid inputs', () => {
    expect(formatTime(NaN)).toBe('00:00');
    expect(formatTime(Infinity)).toBe('00:00');
    expect(formatTime(-Infinity)).toBe('00:00');
    expect(formatTime(-5)).toBe('00:00');
  });
});

describe('getConversionHint', () => {
  it('returns format-specific hints for known extensions', () => {
    expect(getConversionHint('.flac')).toContain('ffmpeg');
    expect(getConversionHint('.aac')).toContain('libmp3lame');
    expect(getConversionHint('.opus')).toContain('libvorbis');
    expect(getConversionHint('.m4a')).toContain('ffmpeg');
    expect(getConversionHint('.wav')).toContain('corrupted');
  });

  it('is case-insensitive', () => {
    expect(getConversionHint('.FLAC')).toContain('ffmpeg');
  });

  it('returns null for extensions without specific hints', () => {
    expect(getConversionHint('.mp3')).toBeNull();
    expect(getConversionHint('.ogg')).toBeNull();
    expect(getConversionHint('.xyz')).toBeNull();
  });
});

describe('remaining time display', () => {
  function remainingTimeDisplay(duration: number, currentTime: number): string {
    return `\u2212${formatTime(Math.max(0, duration - currentTime))}`;
  }

  it('shows remaining time correctly mid-track', () => {
    expect(remainingTimeDisplay(300, 120)).toBe('\u221203:00');
  });

  it('shows 00:00 remaining at end of track', () => {
    expect(remainingTimeDisplay(300, 300)).toBe('\u221200:00');
  });

  it('clamps to 00:00 when currentTime exceeds duration', () => {
    expect(remainingTimeDisplay(300, 305)).toBe('\u221200:00');
  });

  it('shows full duration when currentTime is 0', () => {
    expect(remainingTimeDisplay(185, 0)).toBe('\u221203:05');
  });

  it('handles both duration and currentTime at 0', () => {
    expect(remainingTimeDisplay(0, 0)).toBe('\u221200:00');
  });
});

function computeSeekRatio(clientX: number, rectLeft: number, rectWidth: number): number {
  return Math.max(0, Math.min(1, (clientX - rectLeft) / rectWidth));
}

function computeTooltipLeft(clientX: number, rectLeft: number, rectWidth: number, halfWidth: number): number {
  const rawLeft = clientX - rectLeft;
  return Math.max(halfWidth, Math.min(rectWidth - halfWidth, rawLeft));
}

describe('computeSeekRatio', () => {
  it('computes correct ratio for mid-bar positions', () => {
    expect(computeSeekRatio(150, 100, 200)).toBeCloseTo(0.25);
    expect(computeSeekRatio(200, 100, 200)).toBeCloseTo(0.5);
    expect(computeSeekRatio(250, 100, 200)).toBeCloseTo(0.75);
  });

  it('clamps to 0 when clicking left of the container', () => {
    expect(computeSeekRatio(50, 100, 200)).toBe(0);
    expect(computeSeekRatio(0, 100, 200)).toBe(0);
  });

  it('clamps to 1 when clicking right of the container', () => {
    expect(computeSeekRatio(350, 100, 200)).toBe(1);
    expect(computeSeekRatio(500, 100, 200)).toBe(1);
  });

  it('returns 0 for exact left edge', () => {
    expect(computeSeekRatio(100, 100, 200)).toBe(0);
  });

  it('returns 1 for exact right edge', () => {
    expect(computeSeekRatio(300, 100, 200)).toBe(1);
  });
});

describe('computeTooltipLeft', () => {
  const halfW = 28;
  const rectLeft = 50;
  const rectWidth = 400;

  it('positions tooltip at cursor when in middle of container', () => {
    expect(computeTooltipLeft(250, rectLeft, rectWidth, halfW)).toBe(200);
  });

  it('clamps tooltip to left edge to prevent overflow', () => {
    expect(computeTooltipLeft(60, rectLeft, rectWidth, halfW)).toBe(halfW);
  });

  it('clamps tooltip to right edge to prevent overflow', () => {
    expect(computeTooltipLeft(445, rectLeft, rectWidth, halfW)).toBe(rectWidth - halfW);
  });

  it('returns halfWidth when cursor is at container left edge', () => {
    expect(computeTooltipLeft(rectLeft, rectLeft, rectWidth, halfW)).toBe(halfW);
  });

  it('returns rectWidth - halfWidth when cursor is at container right edge', () => {
    expect(computeTooltipLeft(rectLeft + rectWidth, rectLeft, rectWidth, halfW)).toBe(rectWidth - halfW);
  });
});

describe('computeWaveformSummary', () => {
  it('computes peak values per bucket (mono)', () => {
    const channel = new Float32Array([0.1, 0.5, 0.3, 0.2, 0.8, 0.4, 0.6, 0.7]);
    const result = computeWaveformSummary([channel], 2);
    expect(result.length).toBe(2);
    expect(result[0]).toBeCloseTo(0.5);
    expect(result[1]).toBeCloseTo(0.8);
  });

  it('handles negative values using absolute value', () => {
    const channel = new Float32Array([-0.9, 0.1, -0.2, 0.3]);
    const result = computeWaveformSummary([channel], 2);
    expect(result[0]).toBeCloseTo(0.9);
    expect(result[1]).toBeCloseTo(0.3);
  });

  it('returns empty array when channel is too short for buckets', () => {
    const channel = new Float32Array([0.5]);
    const result = computeWaveformSummary([channel], 200);
    expect(result.length).toBe(0);
  });

  it('handles silence', () => {
    const channel = new Float32Array(100);
    const result = computeWaveformSummary([channel], 10);
    expect(result.length).toBe(10);
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBe(0);
    }
  });

  it('handles single bucket covering all samples', () => {
    const channel = new Float32Array([0.1, 0.9, 0.3, 0.5]);
    const result = computeWaveformSummary([channel], 1);
    expect(result.length).toBe(1);
    expect(result[0]).toBeCloseTo(0.9);
  });

  it('returns empty array for empty channels array', () => {
    const result = computeWaveformSummary([], 10);
    expect(result.length).toBe(0);
  });

  it('uses max of both channels for stereo', () => {
    // Left channel has peak in bucket 1, right channel has peak in bucket 0
    const left  = new Float32Array([0.1, 0.2, 0.8, 0.3]);
    const right = new Float32Array([0.9, 0.1, 0.1, 0.2]);
    const result = computeWaveformSummary([left, right], 2);
    expect(result.length).toBe(2);
    // Bucket 0: max(abs(0.1), abs(0.9)) = 0.9, max(abs(0.2), abs(0.1)) = 0.2 → peak 0.9
    expect(result[0]).toBeCloseTo(0.9);
    // Bucket 1: max(abs(0.8), abs(0.1)) = 0.8, max(abs(0.3), abs(0.2)) = 0.3 → peak 0.8
    expect(result[1]).toBeCloseTo(0.8);
  });

  it('stereo picks right channel peak when left is silent', () => {
    const left  = new Float32Array([0, 0, 0, 0]);
    const right = new Float32Array([0, 0, 0.7, 0]);
    const result = computeWaveformSummary([left, right], 2);
    expect(result[0]).toBeCloseTo(0);
    expect(result[1]).toBeCloseTo(0.7);
  });

  it('stereo handles negative values in both channels', () => {
    const left  = new Float32Array([-0.3, 0.1]);
    const right = new Float32Array([0.1, -0.6]);
    const result = computeWaveformSummary([left, right], 1);
    // Per sample: max(0.3, 0.1) = 0.3, max(0.1, 0.6) = 0.6 → peak 0.6
    expect(result[0]).toBeCloseTo(0.6);
  });
});

function computeLogBinRange(barIndex: number, barCount: number, halfFFT: number): { lowBin: number; highBin: number } {
  const lowBin = Math.floor(halfFFT * (barIndex / barCount) ** 2);
  const highBin = Math.max(lowBin + 1, Math.floor(halfFFT * ((barIndex + 1) / barCount) ** 2));
  return { lowBin, highBin };
}

describe('log-frequency bin mapping', () => {
  const FFT_SIZE = 1024;
  const halfFFT = FFT_SIZE / 2;
  const BAR_COUNT = 32;

  it('first bar starts at bin 0', () => {
    const { lowBin } = computeLogBinRange(0, BAR_COUNT, halfFFT);
    expect(lowBin).toBe(0);
  });

  it('last bar ends at halfFFT', () => {
    const { highBin } = computeLogBinRange(BAR_COUNT - 1, BAR_COUNT, halfFFT);
    expect(highBin).toBe(halfFFT);
  });

  it('every bar has at least 1 bin', () => {
    for (let i = 0; i < BAR_COUNT; i++) {
      const { lowBin, highBin } = computeLogBinRange(i, BAR_COUNT, halfFFT);
      expect(highBin - lowBin).toBeGreaterThanOrEqual(1);
    }
  });

  it('bins are contiguous (no gaps between adjacent bars)', () => {
    for (let i = 0; i < BAR_COUNT - 1; i++) {
      const { highBin: prevHigh } = computeLogBinRange(i, BAR_COUNT, halfFFT);
      const { lowBin: nextLow } = computeLogBinRange(i + 1, BAR_COUNT, halfFFT);
      expect(nextLow).toBe(Math.floor(halfFFT * ((i + 1) / BAR_COUNT) ** 2));
      expect(prevHigh).toBeGreaterThanOrEqual(nextLow);
    }
  });

  it('allocates more bins to higher bars (log distribution)', () => {
    const firstRange = computeLogBinRange(0, BAR_COUNT, halfFFT);
    const lastRange = computeLogBinRange(BAR_COUNT - 1, BAR_COUNT, halfFFT);
    const firstBins = firstRange.highBin - firstRange.lowBin;
    const lastBins = lastRange.highBin - lastRange.lowBin;
    expect(lastBins).toBeGreaterThan(firstBins);
  });

  it('bass bars (first quarter) cover fewer total bins than treble bars (last quarter)', () => {
    let bassBins = 0;
    let trebleBins = 0;
    const quarter = BAR_COUNT / 4;
    for (let i = 0; i < quarter; i++) {
      const { lowBin, highBin } = computeLogBinRange(i, BAR_COUNT, halfFFT);
      bassBins += highBin - lowBin;
    }
    for (let i = BAR_COUNT - quarter; i < BAR_COUNT; i++) {
      const { lowBin, highBin } = computeLogBinRange(i, BAR_COUNT, halfFFT);
      trebleBins += highBin - lowBin;
    }
    expect(trebleBins).toBeGreaterThan(bassBins);
  });
});

describe('waveform pixel skip optimization', () => {
  it('computes same pixel for close time positions', () => {
    const canvasWidth = 480;
    const duration = 300;
    const time1 = 150.0;
    const time2 = 150.3;
    const px1 = Math.round((time1 / duration) * canvasWidth);
    const px2 = Math.round((time2 / duration) * canvasWidth);
    expect(px1).toBe(px2);
  });

  it('computes different pixel for distant time positions', () => {
    const canvasWidth = 480;
    const duration = 300;
    const time1 = 150.0;
    const time2 = 152.0;
    const px1 = Math.round((time1 / duration) * canvasWidth);
    const px2 = Math.round((time2 / duration) * canvasWidth);
    expect(px1).not.toBe(px2);
  });

  it('pixel range covers 0 to canvasWidth', () => {
    const canvasWidth = 480;
    const duration = 120;
    expect(Math.round((0 / duration) * canvasWidth)).toBe(0);
    expect(Math.round((duration / duration) * canvasWidth)).toBe(canvasWidth);
  });
});

function getStatusText(isReady: boolean, isBuffering: boolean, isPlaying: boolean, currentTime: number): string {
  if (!isReady) return 'Loading';
  if (isBuffering && isPlaying) return 'Buffering';
  if (isPlaying) return 'Playing';
  if (currentTime > 0) return 'Paused';
  return 'Ready';
}

describe('LED status display priority', () => {
  it('shows Loading when not ready', () => {
    expect(getStatusText(false, false, false, 0)).toBe('Loading');
  });

  it('Loading takes priority over all other states', () => {
    expect(getStatusText(false, true, true, 100)).toBe('Loading');
  });

  it('shows Buffering when playing and buffering', () => {
    expect(getStatusText(true, true, true, 50)).toBe('Buffering');
  });

  it('shows Playing when playing normally (not buffering)', () => {
    expect(getStatusText(true, false, true, 50)).toBe('Playing');
  });

  it('shows Paused when stopped with progress', () => {
    expect(getStatusText(true, false, false, 30)).toBe('Paused');
  });

  it('shows Ready at initial state', () => {
    expect(getStatusText(true, false, false, 0)).toBe('Ready');
  });

  it('does not show Buffering when paused (buffering flag stale)', () => {
    expect(getStatusText(true, true, false, 30)).toBe('Paused');
  });
});

// ── Component rendering tests ───────────────────────────────────────

describe('AudioPlayer component', () => {
  describe('rendering', () => {
    it('renders without crashing', () => {
      const { container } = renderPlayer();
      expect(container).toBeInTheDocument();
    });

    it('sets src URL on audio source element with MIME type', () => {
      renderPlayer();
      const source = document.querySelector('audio source');
      expect(source).not.toBeNull();
      expect(source!.getAttribute('src')).toBe(mockAudioUrl);
      expect(source!.getAttribute('type')).toBe('audio/mpeg');
    });

    it('shows loading spinner initially', () => {
      renderPlayer();
      expect(screen.getByTestId('spinner')).toBeInTheDocument();
      expect(screen.getByText('Loading audio...')).toBeInTheDocument();
    });

    it('shows Loading status initially', () => {
      renderPlayer();
      expect(screen.getByText('Loading')).toBeInTheDocument();
    });

    it('shows Ready status after canplay', async () => {
      renderPlayer();
      makeAudioControllable(document.querySelector('audio')!);
      await fireCanPlay();
      expect(screen.getByText('Ready')).toBeInTheDocument();
    });

    it('hides loading spinner after canplay', async () => {
      renderPlayer();
      makeAudioControllable(document.querySelector('audio')!);
      await fireCanPlay();
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    });

    it('play button is disabled before ready', () => {
      renderPlayer();
      expect(screen.getByLabelText('Play')).toBeDisabled();
    });

    it('play button is enabled after ready', async () => {
      renderPlayer();
      makeAudioControllable(document.querySelector('audio')!);
      await fireCanPlay();
      expect(screen.getByLabelText('Play')).toBeEnabled();
    });

    it('shows transport buttons', () => {
      renderPlayer();
      expect(screen.getByLabelText('Play')).toBeInTheDocument();
      expect(screen.getByLabelText('Stop')).toBeInTheDocument();
      expect(screen.getByLabelText('Skip back 10 seconds')).toBeInTheDocument();
      expect(screen.getByLabelText('Skip forward 10 seconds')).toBeInTheDocument();
    });

    it('seek bar has correct ARIA attributes', async () => {
      renderPlayer();
      makeAudioControllable(document.querySelector('audio')!);
      await fireCanPlay();
      const seekBar = screen.getByRole('slider', { name: 'Seek position' });
      expect(seekBar).toHaveAttribute('aria-valuemin', '0');
      expect(seekBar).toHaveAttribute('aria-valuemax', '120');
      expect(seekBar).toHaveAttribute('aria-valuenow', '0');
    });

    it('renders volume slider', () => {
      renderPlayer();
      expect(screen.getByLabelText('Volume')).toBeInTheDocument();
    });

    it('mute button has aria-pressed="false" initially', () => {
      renderPlayer();
      expect(screen.getByLabelText('Mute')).toHaveAttribute('aria-pressed', 'false');
    });

    it('loop button has aria-pressed="false" initially', () => {
      renderPlayer();
      expect(screen.getByLabelText('Enable repeat')).toHaveAttribute('aria-pressed', 'false');
    });

    it('shows 1x playback speed by default', () => {
      renderPlayer();
      expect(screen.getByLabelText('Playback speed: 1x')).toBeInTheDocument();
    });

    it('shows file extension badge', () => {
      renderPlayer({ fileExtension: '.mp3' });
      expect(screen.getByText('MP3')).toBeInTheDocument();
    });

    it('shows correct extension badge for WAV', () => {
      renderPlayer({ fileExtension: '.wav' });
      expect(screen.getByText('WAV')).toBeInTheDocument();
    });

    it('renders error state with conversion hint for unsupported format after retries exhausted', async () => {
      vi.useFakeTimers();
      renderPlayer({ fileExtension: '.flac' });
      // First error — triggers retry 1 (500ms)
      await fireAudioError();
      expect(screen.queryByText(/Audio format not supported/)).not.toBeInTheDocument();
      // Advance past retry 1
      await act(async () => { vi.advanceTimersByTime(500); });
      // Second error — triggers retry 2 (1000ms)
      await fireAudioError();
      expect(screen.queryByText(/Audio format not supported/)).not.toBeInTheDocument();
      // Advance past retry 2
      await act(async () => { vi.advanceTimersByTime(1000); });
      // Third error — retries exhausted, show error
      await fireAudioError();
      expect(screen.getByText(/Audio format not supported/)).toBeInTheDocument();
      expect(screen.getByText(/ffmpeg/)).toBeInTheDocument();
      vi.useRealTimers();
    });

    it('shows format badge in error state', async () => {
      renderPlayer({ fileExtension: '.flac' });
      // Use non-retryable error code for immediate error
      await fireAudioError(MEDIA_ERR_DECODE);
      expect(screen.getByText('FLAC')).toBeInTheDocument();
    });

    it('shows Save As button in error state when onExport provided', async () => {
      const onExport = vi.fn();
      renderPlayer({ onExport });
      await fireAudioError(MEDIA_ERR_DECODE);
      expect(screen.getByText(/Save As/)).toBeInTheDocument();
    });

    it('hides Save As in error state when onExport not provided', async () => {
      renderPlayer();
      await fireAudioError(MEDIA_ERR_DECODE);
      expect(screen.queryByText(/Save As/)).not.toBeInTheDocument();
    });

    it('calls onExport when Save As is clicked in error state', async () => {
      const onExport = vi.fn();
      renderPlayer({ onExport });
      await fireAudioError(MEDIA_ERR_DECODE);
      fireEvent.click(screen.getByText(/Save As/));
      expect(onExport).toHaveBeenCalledOnce();
    });

    it('renders generic error for non-format errors', async () => {
      renderPlayer();
      await fireAudioError(MEDIA_ERR_DECODE);
      expect(screen.getByText(/Failed to load audio/)).toBeInTheDocument();
    });
  });

  // ── Interaction tests ───────────────────────────────────────────────

  describe('keyboard interactions', () => {
    it('Space key calls play', async () => {
      renderPlayer();
      makeAudioControllable(document.querySelector('audio')!);
      await fireCanPlay();

      await act(async () => {
        fireEvent.keyDown(document, { key: ' ' });
      });
      expect(playMock).toHaveBeenCalledOnce();
    });

    it('Space key calls pause when playing', async () => {
      renderPlayer();
      makeAudioControllable(document.querySelector('audio')!);
      await fireCanPlay();

      // Play
      await act(async () => {
        fireEvent.keyDown(document, { key: ' ' });
      });
      // Pause
      await act(async () => {
        fireEvent.keyDown(document, { key: ' ' });
      });
      expect(pauseMock).toHaveBeenCalled();
    });

    it('Space key does not trigger play when INPUT is focused', async () => {
      renderPlayer();
      makeAudioControllable(document.querySelector('audio')!);
      await fireCanPlay();

      const volumeSlider = screen.getByLabelText('Volume');
      await act(async () => {
        fireEvent.keyDown(volumeSlider, { key: ' ' });
      });
      expect(playMock).not.toHaveBeenCalled();
    });

    it('ArrowLeft skips back 10 seconds', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      audio.currentTime = 30;
      await act(async () => {
        fireEvent.keyDown(document, { key: 'ArrowLeft' });
      });
      expect(audio.currentTime).toBe(20);
    });

    it('ArrowRight skips forward 10 seconds', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      audio.currentTime = 30;
      await act(async () => {
        fireEvent.keyDown(document, { key: 'ArrowRight' });
      });
      expect(audio.currentTime).toBe(40);
    });

    it('ArrowLeft clamps at 0', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      audio.currentTime = 5;
      await act(async () => {
        fireEvent.keyDown(document, { key: 'ArrowLeft' });
      });
      expect(audio.currentTime).toBe(0);
    });

    it('ArrowUp increases volume by 0.05', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      await act(async () => {
        fireEvent.keyDown(document, { key: 'ArrowUp' });
      });
      // Initial volume is 0.75, should be 0.80
      expect(audio.volume).toBeCloseTo(0.8);
    });

    it('ArrowDown decreases volume by 0.05', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      await act(async () => {
        fireEvent.keyDown(document, { key: 'ArrowDown' });
      });
      expect(audio.volume).toBeCloseTo(0.7);
    });

    it('M key toggles mute on', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      await act(async () => {
        fireEvent.keyDown(document, { key: 'm' });
      });
      expect(audio.muted).toBe(true);
      expect(screen.getByLabelText('Unmute')).toBeInTheDocument();
    });

    it('M key toggles mute off', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      // Mute
      await act(async () => {
        fireEvent.keyDown(document, { key: 'm' });
      });
      // Unmute
      await act(async () => {
        fireEvent.keyDown(document, { key: 'M' });
      });
      expect(audio.muted).toBe(false);
      expect(screen.getByLabelText('Mute')).toBeInTheDocument();
    });

    it('L key toggles loop on', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      expect(screen.getByLabelText('Enable repeat')).toHaveAttribute('aria-pressed', 'false');
      await act(async () => {
        fireEvent.keyDown(document, { key: 'l' });
      });
      expect(audio.loop).toBe(true);
      expect(screen.getByLabelText('Disable repeat')).toHaveAttribute('aria-pressed', 'true');
    });

    it('L key toggles loop off', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      // Enable loop
      await act(async () => {
        fireEvent.keyDown(document, { key: 'l' });
      });
      // Disable loop
      await act(async () => {
        fireEvent.keyDown(document, { key: 'L' });
      });
      expect(audio.loop).toBe(false);
      expect(screen.getByLabelText('Enable repeat')).toHaveAttribute('aria-pressed', 'false');
    });

    it('S key cycles playback speed', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      expect(screen.getByLabelText('Playback speed: 1x')).toBeInTheDocument();
      await act(async () => {
        fireEvent.keyDown(document, { key: 's' });
      });
      await waitFor(() => {
        expect(audio.playbackRate).toBe(1.25);
        expect(screen.getByLabelText('Playback speed: 1.25x')).toBeInTheDocument();
      });
    });
  });

  describe('seek bar keyboard', () => {
    it('ArrowLeft on seek bar seeks -5s', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      audio.currentTime = 30;
      const seekBar = screen.getByRole('slider', { name: 'Seek position' });
      await act(async () => {
        fireEvent.keyDown(seekBar, { key: 'ArrowLeft' });
      });
      expect(audio.currentTime).toBe(25);
    });

    it('ArrowRight on seek bar seeks +5s', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      audio.currentTime = 30;
      const seekBar = screen.getByRole('slider', { name: 'Seek position' });
      await act(async () => {
        fireEvent.keyDown(seekBar, { key: 'ArrowRight' });
      });
      expect(audio.currentTime).toBe(35);
    });

    it('Home on seek bar seeks to start', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      audio.currentTime = 60;
      const seekBar = screen.getByRole('slider', { name: 'Seek position' });
      await act(async () => {
        fireEvent.keyDown(seekBar, { key: 'Home' });
      });
      expect(audio.currentTime).toBe(0);
    });

    it('End on seek bar seeks to duration', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      audio.currentTime = 0;
      const seekBar = screen.getByRole('slider', { name: 'Seek position' });
      await act(async () => {
        fireEvent.keyDown(seekBar, { key: 'End' });
      });
      expect(audio.currentTime).toBe(120);
    });

    it('ArrowLeft on seek bar does not double-fire global handler', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      audio.currentTime = 30;
      const seekBar = screen.getByRole('slider', { name: 'Seek position' });
      await act(async () => {
        fireEvent.keyDown(seekBar, { key: 'ArrowLeft' });
      });
      // Should be 25 (-5s from seek bar), not 15 (-5s then -10s from global)
      expect(audio.currentTime).toBe(25);
    });
  });

  describe('button interactions', () => {
    it('click play button calls audio.play()', async () => {
      renderPlayer();
      makeAudioControllable(document.querySelector('audio')!);
      await fireCanPlay();

      await act(async () => {
        fireEvent.click(screen.getByLabelText('Play'));
      });
      expect(playMock).toHaveBeenCalledOnce();
    });

    it('shows inline error when play() rejects, keeps player controls visible', async () => {
      playMock.mockRejectedValueOnce(new Error('GStreamer pipeline error'));
      renderPlayer();
      makeAudioControllable(document.querySelector('audio')!);
      await fireCanPlay();

      await act(async () => {
        fireEvent.click(screen.getByLabelText('Play'));
      });
      await flushMicrotasks();

      // Play error renders inline (role="alert")
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Failed to play audio');
      // Player controls remain visible (not replaced by full error screen)
      expect(screen.getByLabelText('Stop')).toBeInTheDocument();
      expect(screen.getByLabelText('Volume')).toBeInTheDocument();
    });

    it('clears play error on next successful play', async () => {
      playMock.mockRejectedValueOnce(new Error('GStreamer fail'));
      renderPlayer();
      makeAudioControllable(document.querySelector('audio')!);
      await fireCanPlay();

      // First play fails
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Play'));
      });
      await flushMicrotasks();
      expect(screen.getByRole('alert')).toBeInTheDocument();

      // Second play succeeds (playMock reverts to default resolved)
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Play'));
      });
      await flushMicrotasks();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('dismiss button removes play error', async () => {
      playMock.mockRejectedValueOnce(new Error('fail'));
      renderPlayer();
      makeAudioControllable(document.querySelector('audio')!);
      await fireCanPlay();

      await act(async () => {
        fireEvent.click(screen.getByLabelText('Play'));
      });
      await flushMicrotasks();
      expect(screen.getByRole('alert')).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByLabelText('Dismiss play error'));
      });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('click stop resets currentTime to 0', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      audio.currentTime = 50;
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Stop'));
      });
      expect(pauseMock).toHaveBeenCalled();
      expect(audio.currentTime).toBe(0);
    });

    it('click mute button toggles mute', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;

      await act(async () => {
        fireEvent.click(screen.getByLabelText('Mute'));
      });
      expect(audio.muted).toBe(true);
      expect(screen.getByLabelText('Unmute')).toHaveAttribute('aria-pressed', 'true');
    });

    it('loop toggle changes aria-pressed', async () => {
      renderPlayer();

      const loopBtn = screen.getByLabelText('Enable repeat');
      expect(loopBtn).toHaveAttribute('aria-pressed', 'false');

      await act(async () => {
        fireEvent.click(loopBtn);
      });
      expect(screen.getByLabelText('Disable repeat')).toHaveAttribute('aria-pressed', 'true');
    });

    it('loop toggle syncs audio.loop property', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      expect(audio.loop).toBe(false);

      // Enable loop
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Enable repeat'));
      });
      expect(audio.loop).toBe(true);

      // Disable loop
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Disable repeat'));
      });
      expect(audio.loop).toBe(false);
    });

    it('speed button cycles through options', async () => {
      renderPlayer();

      expect(screen.getByLabelText('Playback speed: 1x')).toBeInTheDocument();

      // 1x → 1.25x
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Playback speed: 1x'));
      });
      expect(screen.getByLabelText('Playback speed: 1.25x')).toBeInTheDocument();

      // 1.25x → 1.5x
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Playback speed: 1.25x'));
      });
      expect(screen.getByLabelText('Playback speed: 1.5x')).toBeInTheDocument();
    });

    it('speed button sets audio.playbackRate', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      // Default playbackRate
      expect(audio.playbackRate).toBe(1);

      // 1x → 1.25x
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Playback speed: 1x'));
      });
      expect(audio.playbackRate).toBe(1.25);

      // 1.25x → 1.5x
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Playback speed: 1.25x'));
      });
      expect(audio.playbackRate).toBe(1.5);
    });
  });

  describe('LED time toggle', () => {
    it('click toggles from total to remaining time', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      const ledDisplay = screen.getByTitle('Click to toggle remaining time');
      // Initially shows total duration (no minus sign prefix)
      expect(ledDisplay.textContent).not.toContain('\u2212');

      // Click to switch to remaining time
      await act(async () => {
        fireEvent.click(ledDisplay);
      });
      // Now shows remaining time with minus sign prefix
      expect(ledDisplay.textContent).toContain('\u2212');

      // Click again to switch back to total
      await act(async () => {
        fireEvent.click(ledDisplay);
      });
      expect(ledDisplay.textContent).not.toContain('\u2212');
    });

    it('Enter key toggles remaining time (native button)', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      const ledDisplay = screen.getByTitle('Click to toggle remaining time');
      expect(ledDisplay.tagName).toBe('BUTTON');
      expect(ledDisplay.textContent).not.toContain('\u2212');

      // Native <button> handles Enter/Space → click; jsdom doesn't simulate this,
      // so we fire click directly (the semantic test is that it's a <button>).
      await act(async () => {
        fireEvent.click(ledDisplay);
      });
      expect(ledDisplay.textContent).toContain('\u2212');
    });

    it('LED time display is a native button element', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      const ledDisplay = screen.getByTitle('Click to toggle remaining time');
      expect(ledDisplay.tagName).toBe('BUTTON');
      expect(ledDisplay.getAttribute('type')).toBe('button');
    });
  });

  describe('volume interactions', () => {
    it('volume slider changes audio volume', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;

      const volumeSlider = screen.getByLabelText('Volume');
      await act(async () => {
        fireEvent.change(volumeSlider, { target: { value: '0.3' } });
      });
      expect(audio.volume).toBe(0.3);
    });

    it('volume slider unmutes when adjusted while muted', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      // Mute first
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Mute'));
      });
      expect(audio.muted).toBe(true);

      // Drag volume slider up
      const volumeSlider = screen.getByLabelText('Volume');
      await act(async () => {
        fireEvent.change(volumeSlider, { target: { value: '0.5' } });
      });
      expect(audio.muted).toBe(false);
    });

    it('ArrowUp unmutes when muted', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      // Mute
      await act(async () => {
        fireEvent.keyDown(document, { key: 'm' });
      });
      expect(audio.muted).toBe(true);

      // ArrowUp should unmute
      await act(async () => {
        fireEvent.keyDown(document, { key: 'ArrowUp' });
      });
      expect(audio.muted).toBe(false);
    });
  });

  // Note: metadata display tests removed — metadata parsing (music-metadata)
  // was removed when AudioPlayer switched from Uint8Array data to URL-based streaming.

  // ── Buffering state transition tests ────────────────────────────────

  describe('buffering state transitions', () => {
    it('shows Buffering when playing and waiting event fires', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      // Start playing
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Play'));
      });
      await waitFor(() => expect(screen.getByText('Playing')).toBeInTheDocument());

      // Fire waiting event
      await act(async () => {
        audio.dispatchEvent(new Event('waiting'));
      });

      await waitFor(() => expect(screen.getByText('Buffering')).toBeInTheDocument());
    });

    it('clears Buffering when playing event fires after waiting', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      // Play → waiting → playing
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Play'));
      });
      await waitFor(() => expect(screen.getByText('Playing')).toBeInTheDocument());

      await act(async () => {
        audio.dispatchEvent(new Event('waiting'));
      });
      await waitFor(() => expect(screen.getByText('Buffering')).toBeInTheDocument());

      await act(async () => {
        audio.dispatchEvent(new Event('playing'));
      });
      // Should now show Playing, not Buffering
      await waitFor(() => {
        expect(screen.queryByText('Buffering')).not.toBeInTheDocument();
        expect(screen.getByText('Playing')).toBeInTheDocument();
      });
    });

    it('shows Buffering on stalled when readyState < 3', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      // Start playing
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Play'));
      });

      // Set readyState < 3 (HAVE_CURRENT_DATA = 2)
      Object.defineProperty(audio, 'readyState', { value: 2, configurable: true });
      await act(async () => {
        audio.dispatchEvent(new Event('stalled'));
      });

      expect(screen.getByText('Buffering')).toBeInTheDocument();
    });

    it('does not show Buffering on stalled when readyState >= 3', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();

      // Start playing
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Play'));
      });
      await waitFor(() => expect(screen.getByText('Playing')).toBeInTheDocument());

      // Set readyState >= 3 (HAVE_FUTURE_DATA = 3)
      Object.defineProperty(audio, 'readyState', { value: 3, configurable: true });
      await act(async () => {
        audio.dispatchEvent(new Event('stalled'));
      });

      // Should show Playing, not Buffering
      await waitFor(() => {
        expect(screen.queryByText('Buffering')).not.toBeInTheDocument();
        expect(screen.getByText('Playing')).toBeInTheDocument();
      });
    });
  });

  // ── Retry on error tests ────────────────────────────────────────────

  describe('retry on transient error', () => {
    it('does not show error on first SRC_NOT_SUPPORTED (retries transparently)', async () => {
      vi.useFakeTimers();
      renderPlayer();
      await fireAudioError(MEDIA_ERR_SRC_NOT_SUPPORTED);
      // Error should not be shown — retry is pending
      expect(screen.queryByText(/Audio format not supported/)).not.toBeInTheDocument();
      // Loading spinner should still be visible
      expect(screen.getByTestId('spinner')).toBeInTheDocument();
      vi.useRealTimers();
    });

    it('retries loading after 500ms delay on first error', async () => {
      vi.useFakeTimers();
      renderPlayer();
      const audio = document.querySelector('audio')!;
      const loadSpy = vi.spyOn(audio, 'load');

      await fireAudioError(MEDIA_ERR_SRC_NOT_SUPPORTED);
      expect(loadSpy).not.toHaveBeenCalled();

      // Advance past retry delay
      await act(async () => { vi.advanceTimersByTime(500); });
      expect(loadSpy).toHaveBeenCalledOnce();

      loadSpy.mockRestore();
      vi.useRealTimers();
    });

    it('shows error after all retries are exhausted', async () => {
      vi.useFakeTimers();
      renderPlayer();

      // Error 1 → retry 1
      await fireAudioError(MEDIA_ERR_SRC_NOT_SUPPORTED);
      await act(async () => { vi.advanceTimersByTime(500); });

      // Error 2 → retry 2
      await fireAudioError(MEDIA_ERR_SRC_NOT_SUPPORTED);
      await act(async () => { vi.advanceTimersByTime(1000); });

      // Error 3 → retries exhausted
      await fireAudioError(MEDIA_ERR_SRC_NOT_SUPPORTED);
      expect(screen.getByText(/Audio format not supported/)).toBeInTheDocument();

      vi.useRealTimers();
    });

    it('shows non-retryable errors immediately', async () => {
      renderPlayer();
      await fireAudioError(MEDIA_ERR_DECODE);
      expect(screen.getByText(/Failed to load audio/)).toBeInTheDocument();
    });
  });

  // ── Visualization failure fallback tests ────────────────────────────

  describe('visualization failure fallback', () => {
    it('shows "Visualization unavailable" when Rust waveform decode fails', async () => {
      mockDecodeAudioWaveform.mockRejectedValueOnce(new Error('decode failed'));

      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();
      await flushMicrotasks();

      expect(screen.getByText('Visualization unavailable for this format')).toBeInTheDocument();
    });

    it('shows "FFT bars unavailable for this format" when PCM fetch fails', async () => {
      const originalFetch = globalThis.fetch;

      // Rust waveform succeeds (default mock with fftPcmPath), but PCM fetch fails
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));

      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();
      await flushMicrotasks();

      expect(screen.getByText('FFT bars unavailable for this format')).toBeInTheDocument();

      globalThis.fetch = originalFetch;
    });

    it('skips FFT when fftPcmPath is not returned by Rust', async () => {
      mockDecodeAudioWaveform.mockResolvedValueOnce({
        waveform: Array(480).fill(0.5),
        sampleRate: 44100,
        durationSecs: 120,
        channels: 2,
        // no fftPcmPath — Rust didn't write a PCM file
      });

      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();
      await flushMicrotasks();

      // Waveform works, FFT is silently skipped (no error shown)
      expect(screen.queryByText('Visualization unavailable for this format')).not.toBeInTheDocument();
    });

    it('does not show fallback when both waveform and PCM fetch succeed', async () => {
      const originalFetch = globalThis.fetch;
      // Build a valid PCM buffer: 8-byte header + f32 samples
      const pcmBuffer = new ArrayBuffer(8 + 100 * 4);
      const view = new DataView(pcmBuffer);
      view.setUint32(0, 44100, true);  // sample_rate
      view.setUint32(4, 100, true);    // total_samples
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(pcmBuffer),
      });

      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();
      await flushMicrotasks();

      expect(screen.queryByText('Visualization unavailable for this format')).not.toBeInTheDocument();
      expect(screen.queryByText(/FFT bars unavailable/)).not.toBeInTheDocument();

      globalThis.fetch = originalFetch;
    });

    it('keeps playback controls functional when visualization fails', async () => {
      mockDecodeAudioWaveform.mockRejectedValueOnce(new Error('decode failed'));

      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();
      await flushMicrotasks();

      // Play button should still be enabled and functional
      const playBtn = screen.getByLabelText('Play');
      expect(playBtn).toBeEnabled();
      await act(async () => {
        fireEvent.click(playBtn);
      });
      expect(playMock).toHaveBeenCalled();
    });
  });

  describe('duration detection', () => {
    it('sets duration from durationchange when loadedmetadata reports NaN', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;

      // Simulate WebKitGTK: duration is NaN at loadedmetadata time
      Object.defineProperty(audio, 'duration', { value: NaN, writable: true, configurable: true });
      let _ct = 0;
      Object.defineProperty(audio, 'currentTime', {
        get: () => _ct, set: (v: number) => { _ct = v; }, configurable: true,
      });

      await act(async () => {
        audio.dispatchEvent(new Event('loadedmetadata'));
      });

      // Duration should still show 00:00 (NaN was rejected)
      const ledDisplay = screen.getByTitle('Click to toggle remaining time');
      expect(ledDisplay.textContent).toContain('00:00');

      // Now GStreamer resolves the actual duration
      Object.defineProperty(audio, 'duration', { value: 180, writable: true, configurable: true });
      await act(async () => {
        audio.dispatchEvent(new Event('durationchange'));
      });

      // Duration should now show 03:00
      expect(ledDisplay.textContent).toContain('03:00');
    });

    it('falls back to timeupdate for duration when loadedmetadata and durationchange both report NaN', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;

      Object.defineProperty(audio, 'duration', { value: NaN, writable: true, configurable: true });
      let _ct = 0;
      Object.defineProperty(audio, 'currentTime', {
        get: () => _ct, set: (v: number) => { _ct = v; }, configurable: true,
      });

      await act(async () => {
        audio.dispatchEvent(new Event('loadedmetadata'));
        audio.dispatchEvent(new Event('durationchange'));
        audio.dispatchEvent(new Event('canplay'));
      });

      const ledDisplay = screen.getByTitle('Click to toggle remaining time');
      expect(ledDisplay.textContent).toContain('00:00');

      // Duration becomes available during playback
      Object.defineProperty(audio, 'duration', { value: 240, writable: true, configurable: true });
      _ct = 5;
      await act(async () => {
        audio.dispatchEvent(new Event('timeupdate'));
      });

      expect(ledDisplay.textContent).toContain('04:00');
    });

    it('does not seek to 0 in onCanPlay when currentTime is near zero', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;

      let _ct = 0.01; // Near-zero (below 0.05 threshold)
      Object.defineProperty(audio, 'currentTime', {
        get: () => _ct,
        set: (v: number) => { _ct = v; },
        configurable: true,
      });
      Object.defineProperty(audio, 'duration', { value: 120, writable: true, configurable: true });

      await act(async () => {
        audio.dispatchEvent(new Event('loadedmetadata'));
        audio.dispatchEvent(new Event('canplay'));
      });

      // Should NOT have been reset to 0 — near-zero values are left alone
      expect(_ct).toBe(0.01);
    });

    it('seeks to 0 in onCanPlay when currentTime is significantly non-zero', async () => {
      renderPlayer();
      const audio = document.querySelector('audio')!;

      let _ct = 5.0; // Significantly non-zero
      Object.defineProperty(audio, 'currentTime', {
        get: () => _ct,
        set: (v: number) => { _ct = v; },
        configurable: true,
      });
      Object.defineProperty(audio, 'duration', { value: 120, writable: true, configurable: true });

      await act(async () => {
        audio.dispatchEvent(new Event('loadedmetadata'));
        audio.dispatchEvent(new Event('canplay'));
      });

      // Should have been reset to 0
      expect(_ct).toBe(0);
    });
  });

  // ── fftInPlace() algorithm tests ──────────────────────────────────

  describe('fftInPlace', () => {
    it('DC signal produces energy only in bin 0', () => {
      const n = 1024;
      const re = new Float32Array(n).fill(1.0);
      const im = new Float32Array(n).fill(0);
      fftInPlace(re, im);

      // Bin 0 should have magnitude = n (sum of all samples)
      const mag0 = Math.sqrt(re[0] ** 2 + im[0] ** 2);
      expect(mag0).toBeCloseTo(n, 5);

      // All other bins should be ~0
      for (let i = 1; i < n; i++) {
        const mag = Math.sqrt(re[i] ** 2 + im[i] ** 2);
        expect(mag).toBeLessThan(1e-6);
      }
    });

    it('impulse signal produces flat magnitude spectrum', () => {
      const n = 1024;
      const re = new Float32Array(n);
      const im = new Float32Array(n);
      re[0] = 1.0; // Impulse at t=0

      fftInPlace(re, im);

      // Every bin should have magnitude = 1
      for (let i = 0; i < n; i++) {
        const mag = Math.sqrt(re[i] ** 2 + im[i] ** 2);
        expect(mag).toBeCloseTo(1.0, 5);
      }
    });

    it('pure sine at bin frequency produces energy in that bin and its mirror', () => {
      const n = 1024;
      const binIndex = 8; // Put energy at bin 8
      const re = new Float32Array(n);
      const im = new Float32Array(n);

      // Generate sine: x[t] = sin(2π * binIndex * t / n)
      for (let t = 0; t < n; t++) {
        re[t] = Math.sin((2 * Math.PI * binIndex * t) / n);
      }

      fftInPlace(re, im);

      // Bin `binIndex` and its mirror `n - binIndex` should have energy ≈ n/2
      const magTarget = Math.sqrt(re[binIndex] ** 2 + im[binIndex] ** 2);
      const magMirror = Math.sqrt(re[n - binIndex] ** 2 + im[n - binIndex] ** 2);
      expect(magTarget).toBeCloseTo(n / 2, 1);
      expect(magMirror).toBeCloseTo(n / 2, 1);

      // All other bins should be ~0
      for (let i = 0; i < n; i++) {
        if (i === binIndex || i === n - binIndex) continue;
        const mag = Math.sqrt(re[i] ** 2 + im[i] ** 2);
        expect(mag).toBeLessThan(1e-3);
      }
    });

    it('Parseval theorem: energy is conserved between time and frequency domains', () => {
      const n = 256;
      const re = new Float32Array(n);
      const im = new Float32Array(n);
      // Random-ish signal
      for (let i = 0; i < n; i++) re[i] = Math.sin(i * 0.1) + 0.5 * Math.cos(i * 0.3);

      // Time-domain energy
      let timeEnergy = 0;
      for (let i = 0; i < n; i++) timeEnergy += re[i] ** 2;

      fftInPlace(re, im);

      // Frequency-domain energy (scaled by n for unnormalized FFT)
      let freqEnergy = 0;
      for (let i = 0; i < n; i++) freqEnergy += re[i] ** 2 + im[i] ** 2;
      freqEnergy /= n;

      expect(freqEnergy).toBeCloseTo(timeEnergy, 3);
    });

    it('handles small power-of-2 sizes (n=4)', () => {
      const re = new Float32Array([1, 2, 3, 4]);
      const im = new Float32Array(4);
      fftInPlace(re, im);

      // Bin 0 = sum = 10
      expect(re[0]).toBeCloseTo(10, 5);
      expect(im[0]).toBeCloseTo(0, 5);
      // Bin 2 = alternating sum: (1-3) + (2-4) mapped differently
      // Just verify it produces finite values and Parseval holds
      let energy = 0;
      for (let i = 0; i < 4; i++) energy += re[i] ** 2 + im[i] ** 2;
      expect(energy / 4).toBeCloseTo(1 ** 2 + 2 ** 2 + 3 ** 2 + 4 ** 2, 3);
    });
  });

  // ── normalizeWaveform() tests ─────────────────────────────────────

  describe('normalizeWaveform', () => {
    it('normalizes peak to 1.0', () => {
      const data = new Float32Array([0.2, 0.8, 0.4]);
      const result = normalizeWaveform(data);
      expect(result[0]).toBeCloseTo(0.25, 5);
      expect(result[1]).toBeCloseTo(1.0, 5);
      expect(result[2]).toBeCloseTo(0.5, 5);
    });

    it('handles empty array', () => {
      const data = new Float32Array(0);
      const result = normalizeWaveform(data);
      expect(result.length).toBe(0);
    });

    it('handles all-zero input without division by zero', () => {
      const data = new Float32Array([0, 0, 0, 0]);
      const result = normalizeWaveform(data);
      expect(result).toEqual(new Float32Array([0, 0, 0, 0]));
    });

    it('handles single-sample buffer', () => {
      const data = new Float32Array([5.0]);
      const result = normalizeWaveform(data);
      expect(result[0]).toBeCloseTo(1.0, 5);
    });

    it('leaves already-normalized data unchanged', () => {
      const data = new Float32Array([0.5, 1.0, 0.3]);
      const result = normalizeWaveform(data);
      expect(result[0]).toBeCloseTo(0.5, 5);
      expect(result[1]).toBeCloseTo(1.0, 5);
      expect(result[2]).toBeCloseTo(0.3, 5);
    });

    it('normalizes values greater than 1.0', () => {
      const data = new Float32Array([2.0, 4.0, 1.0]);
      const result = normalizeWaveform(data);
      expect(result[0]).toBeCloseTo(0.5, 5);
      expect(result[1]).toBeCloseTo(1.0, 5);
      expect(result[2]).toBeCloseTo(0.25, 5);
    });

    it('mutates and returns the input array', () => {
      const data = new Float32Array([3.0, 6.0]);
      const result = normalizeWaveform(data);
      expect(result).toBe(data); // Same reference
    });
  });

  // ── Seek bar mouse interaction tests ──────────────────────────────

  describe('Seek bar mouse interactions', () => {
    async function setupReadyPlayer() {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();
      await flushMicrotasks();
      return audio;
    }

    /**
     * The seek bar structure:
     * - Outer div (role="slider", onMouseDown) ← fire events here
     * - Inner div (ref=seekBarRef) ← mock getBoundingClientRect here
     * handleSeekMouseDown reads rect from seekBarRef (inner div).
     */
    function getSeekElements() {
      const sliderDiv = screen.getByRole('slider', { name: /seek/i });
      // seekBarRef is the first child div inside the slider (after the tooltip)
      const innerBar = sliderDiv.querySelector('.winamp-groove')!;
      return { sliderDiv, innerBar };
    }

    function mockSeekBarRect(innerBar: Element, rect: Partial<DOMRect>) {
      (innerBar as HTMLElement).getBoundingClientRect = vi.fn().mockReturnValue({
        left: 0, right: 200, width: 200, top: 0, bottom: 20, height: 20, x: 0, y: 0,
        toJSON: () => ({}),
        ...rect,
      });
    }

    it('mousedown on seek bar sets currentTime based on click position', async () => {
      const audio = await setupReadyPlayer();
      const { sliderDiv, innerBar } = getSeekElements();
      mockSeekBarRect(innerBar, { left: 0, width: 200, right: 200 });

      fireEvent.mouseDown(sliderDiv, { clientX: 100 }); // 50% of 200

      expect(audio.currentTime).toBeCloseTo(60, 0); // 50% of duration=120

      // Clean up document listeners
      act(() => { document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    });

    it('mousemove during seek updates currentTime', async () => {
      const audio = await setupReadyPlayer();
      const { sliderDiv, innerBar } = getSeekElements();
      mockSeekBarRect(innerBar, { left: 0, width: 200, right: 200 });

      fireEvent.mouseDown(sliderDiv, { clientX: 100 });
      expect(audio.currentTime).toBeCloseTo(60, 0);

      // Simulate mousemove on document (handler attached to document)
      act(() => {
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, bubbles: true }));
      });

      expect(audio.currentTime).toBeCloseTo(90, 0); // 75% of 120

      // Clean up document listeners
      act(() => {
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
    });

    it('mouseup stops seeking', async () => {
      const audio = await setupReadyPlayer();
      const { sliderDiv, innerBar } = getSeekElements();
      mockSeekBarRect(innerBar, { left: 0, width: 200, right: 200 });

      fireEvent.mouseDown(sliderDiv, { clientX: 100 });

      act(() => {
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });

      // After mouseup, further mousemove should NOT change currentTime
      const timeAfterUp = audio.currentTime;
      act(() => {
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 180, bubbles: true }));
      });

      expect(audio.currentTime).toBe(timeAfterUp);
    });

    it('clamps seek ratio to [0, 1]', async () => {
      const audio = await setupReadyPlayer();
      const { sliderDiv, innerBar } = getSeekElements();
      mockSeekBarRect(innerBar, { left: 100, width: 200, right: 300 });

      // Click before the bar (clientX < left)
      fireEvent.mouseDown(sliderDiv, { clientX: 50 });
      expect(audio.currentTime).toBe(0);

      act(() => {
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });

      // Click past the bar (clientX > right)
      fireEvent.mouseDown(sliderDiv, { clientX: 400 });
      expect(audio.currentTime).toBe(120); // duration

      act(() => { document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    });
  });

  // ── Waveform mouse seek tests ─────────────────────────────────────

  describe('Waveform mouse seek', () => {
    async function setupReadyPlayer() {
      renderPlayer();
      const audio = document.querySelector('audio')!;
      makeAudioControllable(audio);
      await fireCanPlay();
      await flushMicrotasks();
      return audio;
    }

    function getWaveformContainer(): HTMLElement {
      // The waveform container has class "cursor-pointer" and contains canvases.
      // It's the div with ref={waveformContainerRef} and onMouseDown={handleWaveformMouseDown}.
      const canvases = document.querySelectorAll('canvas');
      expect(canvases.length).toBeGreaterThan(0);
      const container = canvases[0].parentElement!;
      return container;
    }

    it('click at 50% width seeks to 50% of duration', async () => {
      const audio = await setupReadyPlayer();
      const container = getWaveformContainer();

      container.getBoundingClientRect = vi.fn().mockReturnValue({
        left: 0, right: 480, width: 480, top: 0, bottom: 120, height: 120, x: 0, y: 0,
        toJSON: () => ({}),
      });

      fireEvent.mouseDown(container, { clientX: 240 }); // 50%
      expect(audio.currentTime).toBeCloseTo(60, 0);

      act(() => { document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    });

    it('click at left edge seeks to start', async () => {
      const audio = await setupReadyPlayer();
      const container = getWaveformContainer();

      container.getBoundingClientRect = vi.fn().mockReturnValue({
        left: 0, right: 480, width: 480, top: 0, bottom: 120, height: 120, x: 0, y: 0,
        toJSON: () => ({}),
      });

      fireEvent.mouseDown(container, { clientX: 0 }); // 0%
      expect(audio.currentTime).toBe(0);

      act(() => { document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    });

    it('click at right edge seeks to end', async () => {
      const audio = await setupReadyPlayer();
      const container = getWaveformContainer();

      container.getBoundingClientRect = vi.fn().mockReturnValue({
        left: 0, right: 480, width: 480, top: 0, bottom: 120, height: 120, x: 0, y: 0,
        toJSON: () => ({}),
      });

      fireEvent.mouseDown(container, { clientX: 480 }); // 100%
      expect(audio.currentTime).toBeCloseTo(120, 0);

      act(() => { document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    });
  });
});
