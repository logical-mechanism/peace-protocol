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
});

const mockDecodeAudioWaveformFast = vi.fn().mockResolvedValue({
  waveform: Array(48).fill(0.5),
  sampleRate: 44100,
  durationSecs: 120,
  channels: 2,
});

const mockDecodeAudioMetadata = vi.fn().mockResolvedValue({
  title: undefined,
  artist: undefined,
  album: undefined,
  sampleRate: 44100,
  channels: 2,
});

vi.mock('../../services/libraryService', () => ({
  decodeAudioWaveform: (...args: unknown[]) => mockDecodeAudioWaveform(...args),
  decodeAudioWaveformFast: (...args: unknown[]) => mockDecodeAudioWaveformFast(...args),
  decodeAudioMetadata: (...args: unknown[]) => mockDecodeAudioMetadata(...args),
}));

// ── Tauri IPC mock ──────────────────────────────────────────────────

const mockInvoke = vi.fn().mockImplementation(() => Promise.resolve(undefined));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

/** Default audio_get_status response. */
const defaultAudioStatus = {
  loaded: true,
  playing: false,
  finished: false,
  position_secs: 0,
  duration_secs: 120,
  volume: 0.75,
};

function setupDefaultInvokeMock() {
  mockInvoke.mockImplementation((cmd: string, _args?: Record<string, unknown>) => {
    switch (cmd) {
      case 'get_library_content_path':
        return Promise.resolve('/mock/path/to/audio.mp3');
      case 'audio_play':
        return Promise.resolve(120.0);
      case 'audio_pause':
      case 'audio_resume':
      case 'audio_stop':
      case 'audio_seek':
      case 'audio_set_volume':
      case 'audio_set_speed':
      case 'audio_set_loop':
        return Promise.resolve(undefined);
      case 'audio_get_status':
        return Promise.resolve({ ...defaultAudioStatus });
      default:
        return Promise.resolve(undefined);
    }
  });
}

import AudioPlayer from '../audio';
import { formatTime, getMimeType, getConversionHint, computeSeekRatio, computeTooltipLeft } from '../audio';
import { normalizeWaveform } from '../audio/audioPlayerUtils';

// ── Helpers ──────────────────────────────────────────────────────────

function renderPlayer(overrides: Partial<{ fileExtension: string; tokenName: string; category: string; onExport: () => void }> = {}) {
  return render(
    <AudioPlayer fileExtension=".mp3" tokenName="abc123" category="audio" {...overrides} />,
  );
}

/** Flush microtask queue so async IPC calls and state updates settle. */
async function flushMicrotasks() {
  await act(async () => {
    await new Promise(r => setTimeout(r, 0));
  });
}

/** Wait for the player to become ready (IPC load sequence completes). */
async function waitForReady() {
  await waitFor(() => {
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });
}

/** Wait for the IPC load error to appear. */
async function waitForError() {
  await waitFor(() => {
    expect(screen.getByText(/Failed to load audio/)).toBeInTheDocument();
  });
}

// Mock canvas getContext for jsdom (jsdom throws "Not implemented" otherwise)
const mockCanvasContext = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  roundRect: vi.fn(),
  fill: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  createRadialGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
  globalAlpha: 1,
  fillStyle: '',
};
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCanvasContext) as unknown as typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  mockInvoke.mockClear();
  mockDecodeAudioWaveform.mockClear();
  mockDecodeAudioWaveformFast.mockClear();
  mockDecodeAudioMetadata.mockClear();
  setupDefaultInvokeMock();
});

// ── Pure utility function tests (testing real exports from audio/) ───

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

  it('returns --:-- when unknownPlaceholder is true and value is 0', () => {
    expect(formatTime(0, true)).toBe('--:--');
  });

  it('returns --:-- for invalid inputs with unknownPlaceholder', () => {
    expect(formatTime(NaN, true)).toBe('--:--');
    expect(formatTime(-5, true)).toBe('--:--');
  });

  it('returns normal time when unknownPlaceholder is true but value is positive', () => {
    expect(formatTime(65, true)).toBe('01:05');
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

  it('returns hints for .ogg and .mp3', () => {
    expect(getConversionHint('.ogg')).toContain('ffmpeg');
    expect(getConversionHint('.mp3')).toContain('corrupted');
  });

  it('returns null for unknown extensions', () => {
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

/** Helper to create a partial DOMRect for testing. */
function makeRect(left: number, width: number): DOMRect {
  return { left, width, right: left + width, top: 0, bottom: 20, height: 20, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
}

describe('computeSeekRatio', () => {
  it('computes correct ratio for mid-bar positions', () => {
    const rect = makeRect(100, 200);
    expect(computeSeekRatio(150, rect)).toBeCloseTo(0.25);
    expect(computeSeekRatio(200, rect)).toBeCloseTo(0.5);
    expect(computeSeekRatio(250, rect)).toBeCloseTo(0.75);
  });

  it('clamps to 0 when clicking left of the container', () => {
    const rect = makeRect(100, 200);
    expect(computeSeekRatio(50, rect)).toBe(0);
    expect(computeSeekRatio(0, rect)).toBe(0);
  });

  it('clamps to 1 when clicking right of the container', () => {
    const rect = makeRect(100, 200);
    expect(computeSeekRatio(350, rect)).toBe(1);
    expect(computeSeekRatio(500, rect)).toBe(1);
  });

  it('returns 0 for exact left edge', () => {
    expect(computeSeekRatio(100, makeRect(100, 200))).toBe(0);
  });

  it('returns 1 for exact right edge', () => {
    expect(computeSeekRatio(300, makeRect(100, 200))).toBe(1);
  });
});

describe('computeTooltipLeft', () => {
  const halfW = 28;
  const rect = makeRect(50, 400);

  it('positions tooltip at cursor when in middle of container', () => {
    expect(computeTooltipLeft(250, rect, halfW)).toBe(200);
  });

  it('clamps tooltip to left edge to prevent overflow', () => {
    expect(computeTooltipLeft(60, rect, halfW)).toBe(halfW);
  });

  it('clamps tooltip to right edge to prevent overflow', () => {
    expect(computeTooltipLeft(445, rect, halfW)).toBe(400 - halfW);
  });

  it('returns halfWidth when cursor is at container left edge', () => {
    expect(computeTooltipLeft(50, rect, halfW)).toBe(halfW);
  });

  it('returns rectWidth - halfWidth when cursor is at container right edge', () => {
    expect(computeTooltipLeft(450, rect, halfW)).toBe(400 - halfW);
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

function getStatusText(isReady: boolean, isPlaying: boolean, currentTime: number): string {
  if (!isReady) return 'Loading';
  if (isPlaying) return 'Playing';
  if (currentTime > 0) return 'Paused';
  return 'Ready';
}

describe('LED status display priority', () => {
  it('shows Loading when not ready', () => {
    expect(getStatusText(false, false, 0)).toBe('Loading');
  });

  it('Loading takes priority over all other states', () => {
    expect(getStatusText(false, true, 100)).toBe('Loading');
  });

  it('shows Playing when playing', () => {
    expect(getStatusText(true, true, 50)).toBe('Playing');
  });

  it('shows Paused when stopped with progress', () => {
    expect(getStatusText(true, false, 30)).toBe('Paused');
  });

  it('shows Ready at initial state', () => {
    expect(getStatusText(true, false, 0)).toBe('Ready');
  });
});

// ── Component rendering tests ───────────────────────────────────────

describe('AudioPlayer component', () => {
  describe('rendering', () => {
    it('renders without crashing', () => {
      const { container } = renderPlayer();
      expect(container).toBeInTheDocument();
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

    it('shows Ready status after IPC load completes', async () => {
      renderPlayer();
      await waitForReady();
      expect(screen.getByText('Ready')).toBeInTheDocument();
    });

    it('hides loading spinner after IPC load completes', async () => {
      renderPlayer();
      await waitForReady();
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    });

    it('play button is disabled before ready', () => {
      renderPlayer();
      expect(screen.getByLabelText('Play')).toBeDisabled();
    });

    it('play button is enabled after ready', async () => {
      renderPlayer();
      await waitForReady();
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
      await waitForReady();
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

    it('renders error state when IPC load fails', async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'audio_stop') return Promise.resolve(undefined);
        if (cmd === 'get_library_content_path') return Promise.reject('File not found');
        return Promise.resolve(undefined);
      });
      renderPlayer({ fileExtension: '.flac' });
      await waitForError();
      expect(screen.getByText(/Failed to load audio/)).toBeInTheDocument();
    });

    it('shows format badge in error state', async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'audio_stop') return Promise.resolve(undefined);
        if (cmd === 'get_library_content_path') return Promise.reject('File not found');
        return Promise.resolve(undefined);
      });
      renderPlayer({ fileExtension: '.flac' });
      await waitForError();
      expect(screen.getByText('FLAC')).toBeInTheDocument();
    });

    it('shows Save As button in error state when onExport provided', async () => {
      const onExport = vi.fn();
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'audio_stop') return Promise.resolve(undefined);
        if (cmd === 'get_library_content_path') return Promise.reject('File not found');
        return Promise.resolve(undefined);
      });
      renderPlayer({ onExport });
      await waitForError();
      expect(screen.getByText(/Save As/)).toBeInTheDocument();
    });

    it('hides Save As in error state when onExport not provided', async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'audio_stop') return Promise.resolve(undefined);
        if (cmd === 'get_library_content_path') return Promise.reject('File not found');
        return Promise.resolve(undefined);
      });
      renderPlayer();
      await waitForError();
      expect(screen.queryByText(/Save As/)).not.toBeInTheDocument();
    });

    it('calls onExport when Save As is clicked in error state', async () => {
      const onExport = vi.fn();
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'audio_stop') return Promise.resolve(undefined);
        if (cmd === 'get_library_content_path') return Promise.reject('File not found');
        return Promise.resolve(undefined);
      });
      renderPlayer({ onExport });
      await waitForError();
      fireEvent.click(screen.getByText(/Save As/));
      expect(onExport).toHaveBeenCalledOnce();
    });

    it('invokes correct IPC commands on mount', async () => {
      renderPlayer();
      await waitForReady();

      // Should have called: audio_stop (cleanup), get_library_content_path, audio_play, audio_pause
      expect(mockInvoke).toHaveBeenCalledWith('audio_stop');
      expect(mockInvoke).toHaveBeenCalledWith('get_library_content_path', { tokenName: 'abc123', category: 'audio' });
      expect(mockInvoke).toHaveBeenCalledWith('audio_play', { path: '/mock/path/to/audio.mp3', volume: 0.75 });
      expect(mockInvoke).toHaveBeenCalledWith('audio_pause');
    });
  });

  // ── Interaction tests ───────────────────────────────────────────────

  describe('keyboard interactions', () => {
    it('Space key calls play (invokes audio_resume)', async () => {
      renderPlayer();
      await waitForReady();

      await act(async () => {
        fireEvent.keyDown(document, { key: ' ' });
      });
      await flushMicrotasks();
      expect(mockInvoke).toHaveBeenCalledWith('audio_resume');
    });

    it('Space key calls pause when playing', async () => {
      renderPlayer();
      await waitForReady();

      // Play
      await act(async () => {
        fireEvent.keyDown(document, { key: ' ' });
      });
      await flushMicrotasks();
      // Pause
      await act(async () => {
        fireEvent.keyDown(document, { key: ' ' });
      });
      await flushMicrotasks();
      expect(mockInvoke).toHaveBeenCalledWith('audio_pause');
    });

    it('Space key does not trigger play when INPUT is focused', async () => {
      renderPlayer();
      await waitForReady();

      const volumeSlider = screen.getByLabelText('Volume');
      mockInvoke.mockClear();
      await act(async () => {
        fireEvent.keyDown(volumeSlider, { key: ' ' });
      });
      expect(mockInvoke).not.toHaveBeenCalledWith('audio_resume');
    });

    // ArrowLeft/Right/Up/Down are NOT global shortcuts — they conflict with
    // Library prev/next navigation. Seek via focused seek bar or waveform only.

    it('M key toggles mute on', async () => {
      renderPlayer();
      await waitForReady();

      await act(async () => {
        fireEvent.keyDown(document, { key: 'm' });
      });
      expect(screen.getByLabelText('Unmute')).toBeInTheDocument();
      expect(mockInvoke).toHaveBeenCalledWith('audio_set_volume', { volume: 0.0 });
    });

    it('M key toggles mute off', async () => {
      renderPlayer();
      await waitForReady();

      // Mute
      await act(async () => {
        fireEvent.keyDown(document, { key: 'm' });
      });
      // Unmute
      await act(async () => {
        fireEvent.keyDown(document, { key: 'M' });
      });
      expect(screen.getByLabelText('Mute')).toBeInTheDocument();
    });

    it('L key toggles loop on', async () => {
      renderPlayer();
      await waitForReady();

      expect(screen.getByLabelText('Enable repeat')).toHaveAttribute('aria-pressed', 'false');
      await act(async () => {
        fireEvent.keyDown(document, { key: 'l' });
      });
      expect(screen.getByLabelText('Disable repeat')).toHaveAttribute('aria-pressed', 'true');
    });

    it('L key toggles loop off', async () => {
      renderPlayer();
      await waitForReady();

      // Enable loop
      await act(async () => {
        fireEvent.keyDown(document, { key: 'l' });
      });
      // Disable loop
      await act(async () => {
        fireEvent.keyDown(document, { key: 'L' });
      });
      expect(screen.getByLabelText('Enable repeat')).toHaveAttribute('aria-pressed', 'false');
    });

    it('S key cycles playback speed', async () => {
      renderPlayer();
      await waitForReady();

      expect(screen.getByLabelText('Playback speed: 1x')).toBeInTheDocument();
      await act(async () => {
        fireEvent.keyDown(document, { key: 's' });
      });
      expect(screen.getByLabelText('Playback speed: 1.25x')).toBeInTheDocument();
      expect(mockInvoke).toHaveBeenCalledWith('audio_set_speed', { speed: 1.25 });
    });
  });

  describe('seek bar keyboard', () => {
    it('ArrowLeft on seek bar seeks -5s', async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'audio_get_status') return Promise.resolve({ ...defaultAudioStatus, position_secs: 30 });
        if (cmd === 'get_library_content_path') return Promise.resolve('/mock/path/to/audio.mp3');
        if (cmd === 'audio_play') return Promise.resolve(120.0);
        return Promise.resolve(undefined);
      });
      renderPlayer();
      await waitForReady();
      // Poll interval is 1000ms when paused
      await act(async () => { await new Promise(r => setTimeout(r, 1100)); });

      const seekBar = screen.getByRole('slider', { name: 'Seek position' });
      mockInvoke.mockClear();
      setupDefaultInvokeMock();
      await act(async () => {
        fireEvent.keyDown(seekBar, { key: 'ArrowLeft' });
      });
      expect(mockInvoke).toHaveBeenCalledWith('audio_seek', { positionSecs: 25 });
    });

    it('ArrowRight on seek bar seeks +5s', async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'audio_get_status') return Promise.resolve({ ...defaultAudioStatus, position_secs: 30 });
        if (cmd === 'get_library_content_path') return Promise.resolve('/mock/path/to/audio.mp3');
        if (cmd === 'audio_play') return Promise.resolve(120.0);
        return Promise.resolve(undefined);
      });
      renderPlayer();
      await waitForReady();
      // Poll interval is 1000ms when paused
      await act(async () => { await new Promise(r => setTimeout(r, 1100)); });

      const seekBar = screen.getByRole('slider', { name: 'Seek position' });
      mockInvoke.mockClear();
      setupDefaultInvokeMock();
      await act(async () => {
        fireEvent.keyDown(seekBar, { key: 'ArrowRight' });
      });
      expect(mockInvoke).toHaveBeenCalledWith('audio_seek', { positionSecs: 35 });
    });

    it('Home on seek bar seeks to start', async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'audio_get_status') return Promise.resolve({ ...defaultAudioStatus, position_secs: 60 });
        if (cmd === 'get_library_content_path') return Promise.resolve('/mock/path/to/audio.mp3');
        if (cmd === 'audio_play') return Promise.resolve(120.0);
        return Promise.resolve(undefined);
      });
      renderPlayer();
      await waitForReady();
      // Poll interval is 1000ms when paused
      await act(async () => { await new Promise(r => setTimeout(r, 1100)); });

      const seekBar = screen.getByRole('slider', { name: 'Seek position' });
      mockInvoke.mockClear();
      setupDefaultInvokeMock();
      await act(async () => {
        fireEvent.keyDown(seekBar, { key: 'Home' });
      });
      expect(mockInvoke).toHaveBeenCalledWith('audio_seek', { positionSecs: 0 });
    });

    it('End on seek bar seeks to duration', async () => {
      renderPlayer();
      await waitForReady();

      const seekBar = screen.getByRole('slider', { name: 'Seek position' });
      mockInvoke.mockClear();
      await act(async () => {
        fireEvent.keyDown(seekBar, { key: 'End' });
      });
      expect(mockInvoke).toHaveBeenCalledWith('audio_seek', { positionSecs: 120 });
    });

    it('ArrowLeft on seek bar does not double-fire global handler', async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'audio_get_status') return Promise.resolve({ ...defaultAudioStatus, position_secs: 30 });
        if (cmd === 'get_library_content_path') return Promise.resolve('/mock/path/to/audio.mp3');
        if (cmd === 'audio_play') return Promise.resolve(120.0);
        return Promise.resolve(undefined);
      });
      renderPlayer();
      await waitForReady();
      // Poll interval is 1000ms when paused
      await act(async () => { await new Promise(r => setTimeout(r, 1100)); });

      const seekBar = screen.getByRole('slider', { name: 'Seek position' });
      mockInvoke.mockClear();
      setupDefaultInvokeMock();
      await act(async () => {
        fireEvent.keyDown(seekBar, { key: 'ArrowLeft' });
      });
      // Should be exactly one audio_seek call at 25 (-5s from seek bar), not also 20 (-10s from global)
      const seekCalls = mockInvoke.mock.calls.filter(
        (c: unknown[]) => c[0] === 'audio_seek'
      );
      expect(seekCalls.length).toBe(1);
      expect(seekCalls[0][1]).toEqual({ positionSecs: 25 });
    });
  });

  describe('button interactions', () => {
    it('click play button calls audio_resume', async () => {
      renderPlayer();
      await waitForReady();

      mockInvoke.mockClear();
      setupDefaultInvokeMock();
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Play'));
      });
      await flushMicrotasks();
      expect(mockInvoke).toHaveBeenCalledWith('audio_resume');
    });

    it('shows inline error when audio_resume rejects, keeps player controls visible', async () => {
      renderPlayer();
      await waitForReady();

      // Make audio_resume fail
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'audio_resume') return Promise.reject(new Error('GStreamer pipeline error'));
        if (cmd === 'audio_get_status') return Promise.resolve({ ...defaultAudioStatus });
        return Promise.resolve(undefined);
      });

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
      renderPlayer();
      await waitForReady();

      // First play fails
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'audio_resume') return Promise.reject(new Error('fail'));
        if (cmd === 'audio_get_status') return Promise.resolve({ ...defaultAudioStatus });
        return Promise.resolve(undefined);
      });
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Play'));
      });
      await flushMicrotasks();
      expect(screen.getByRole('alert')).toBeInTheDocument();

      // Second play succeeds
      setupDefaultInvokeMock();
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Play'));
      });
      await flushMicrotasks();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('dismiss button removes play error', async () => {
      renderPlayer();
      await waitForReady();

      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'audio_resume') return Promise.reject(new Error('fail'));
        if (cmd === 'audio_get_status') return Promise.resolve({ ...defaultAudioStatus });
        return Promise.resolve(undefined);
      });
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

    it('click stop invokes audio_pause and audio_seek to 0', async () => {
      renderPlayer();
      await waitForReady();

      mockInvoke.mockClear();
      setupDefaultInvokeMock();
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Stop'));
      });
      expect(mockInvoke).toHaveBeenCalledWith('audio_pause');
      expect(mockInvoke).toHaveBeenCalledWith('audio_seek', { positionSecs: 0.0 });
    });

    it('click mute button toggles mute', async () => {
      renderPlayer();
      await waitForReady();

      await act(async () => {
        fireEvent.click(screen.getByLabelText('Mute'));
      });
      expect(screen.getByLabelText('Unmute')).toHaveAttribute('aria-pressed', 'true');
      expect(mockInvoke).toHaveBeenCalledWith('audio_set_volume', { volume: 0.0 });
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

    it('speed button cycles through options', async () => {
      renderPlayer();
      await waitForReady();

      expect(screen.getByLabelText('Playback speed: 1x')).toBeInTheDocument();

      // 1x -> 1.25x
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Playback speed: 1x'));
      });
      expect(screen.getByLabelText('Playback speed: 1.25x')).toBeInTheDocument();

      // 1.25x -> 1.5x
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Playback speed: 1.25x'));
      });
      expect(screen.getByLabelText('Playback speed: 1.5x')).toBeInTheDocument();
    });

    it('speed button invokes audio_set_speed', async () => {
      renderPlayer();
      await waitForReady();

      mockInvoke.mockClear();
      setupDefaultInvokeMock();
      // 1x -> 1.25x
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Playback speed: 1x'));
      });
      expect(mockInvoke).toHaveBeenCalledWith('audio_set_speed', { speed: 1.25 });
    });
  });

  describe('LED time toggle', () => {
    it('click toggles from total to remaining time', async () => {
      renderPlayer();
      await waitForReady();

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
      await waitForReady();

      const ledDisplay = screen.getByTitle('Click to toggle remaining time');
      expect(ledDisplay.tagName).toBe('BUTTON');
      expect(ledDisplay.textContent).not.toContain('\u2212');

      // Native <button> handles Enter/Space -> click; jsdom doesn't simulate this,
      // so we fire click directly (the semantic test is that it's a <button>).
      await act(async () => {
        fireEvent.click(ledDisplay);
      });
      expect(ledDisplay.textContent).toContain('\u2212');
    });

    it('LED time display is a native button element', async () => {
      renderPlayer();
      await waitForReady();

      const ledDisplay = screen.getByTitle('Click to toggle remaining time');
      expect(ledDisplay.tagName).toBe('BUTTON');
      expect(ledDisplay.getAttribute('type')).toBe('button');
    });
  });

  describe('volume interactions', () => {
    it('volume slider invokes audio_set_volume', async () => {
      renderPlayer();
      await waitForReady();

      const volumeSlider = screen.getByLabelText('Volume');
      mockInvoke.mockClear();
      setupDefaultInvokeMock();
      await act(async () => {
        fireEvent.change(volumeSlider, { target: { value: '0.3' } });
      });
      expect(mockInvoke).toHaveBeenCalledWith('audio_set_volume', expect.objectContaining({ volume: expect.closeTo(0.3, 2) }));
    });

    it('volume slider unmutes when adjusted while muted', async () => {
      renderPlayer();
      await waitForReady();

      // Mute first
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Mute'));
      });
      expect(screen.getByLabelText('Unmute')).toBeInTheDocument();

      // Drag volume slider up
      const volumeSlider = screen.getByLabelText('Volume');
      await act(async () => {
        fireEvent.change(volumeSlider, { target: { value: '0.5' } });
      });
      // Should be unmuted now
      expect(screen.getByLabelText('Mute')).toBeInTheDocument();
    });

  });

  // ── Visualization failure fallback tests ────────────────────────────

  describe('visualization failure fallback', () => {
    it('shows "Visualization unavailable" when Rust waveform decode fails', async () => {
      mockDecodeAudioWaveformFast.mockRejectedValueOnce(new Error('fast decode failed'));
      mockDecodeAudioWaveform.mockRejectedValueOnce(new Error('decode failed'));
      // Return 0 duration from audio_play to prevent effectiveDuration oscillation
      // which causes an infinite effect re-run cycle when waveformDuration is 0.
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'get_library_content_path') return Promise.resolve('/mock/path/to/audio.mp3');
        if (cmd === 'audio_play') return Promise.resolve(0);
        if (cmd === 'audio_get_status') return Promise.resolve({ ...defaultAudioStatus, duration_secs: 0 });
        return Promise.resolve(undefined);
      });

      renderPlayer();
      await waitForReady();
      await flushMicrotasks();

      expect(screen.getByText('Visualization unavailable for this format')).toBeInTheDocument();
    });

    it('does not show fallback when waveform decode succeeds', async () => {
      renderPlayer();
      await waitForReady();
      await flushMicrotasks();

      expect(screen.queryByText('Visualization unavailable for this format')).not.toBeInTheDocument();
    });

    it('keeps playback controls functional when visualization fails', async () => {
      mockDecodeAudioWaveformFast.mockRejectedValueOnce(new Error('fast decode failed'));
      mockDecodeAudioWaveform.mockRejectedValueOnce(new Error('decode failed'));
      // Return 0 duration to prevent infinite effect cycle (see startPolling deps)
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'get_library_content_path') return Promise.resolve('/mock/path/to/audio.mp3');
        if (cmd === 'audio_play') return Promise.resolve(0);
        if (cmd === 'audio_get_status') return Promise.resolve({ ...defaultAudioStatus, duration_secs: 0 });
        return Promise.resolve(undefined);
      });

      renderPlayer();
      await waitForReady();
      await flushMicrotasks();

      // Play button should still be enabled and functional
      const playBtn = screen.getByLabelText('Play');
      expect(playBtn).toBeEnabled();
      mockInvoke.mockClear();
      setupDefaultInvokeMock();
      await act(async () => {
        fireEvent.click(playBtn);
      });
      await flushMicrotasks();
      expect(mockInvoke).toHaveBeenCalledWith('audio_resume');
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
      await waitForReady();
      await flushMicrotasks();
    }

    /**
     * The seek bar structure:
     * - Outer div (role="slider", onMouseDown) <- fire events here
     * - Inner div (ref=seekBarRef) <- mock getBoundingClientRect here
     * handleSeekMouseDown reads rect from seekBarRef (inner div).
     */
    function getSeekElements() {
      const sliderDiv = screen.getByRole('slider', { name: 'Seek position' });
      // seekBarRef is the last child div inside the slider (after the tooltip)
      const innerBar = sliderDiv.querySelector('div:last-child')!;
      return { sliderDiv, innerBar };
    }

    function mockSeekBarRect(innerBar: Element, rect: Partial<DOMRect>) {
      (innerBar as HTMLElement).getBoundingClientRect = vi.fn().mockReturnValue({
        left: 0, right: 200, width: 200, top: 0, bottom: 20, height: 20, x: 0, y: 0,
        toJSON: () => ({}),
        ...rect,
      });
    }

    it('mousedown on seek bar invokes audio_seek based on click position', async () => {
      await setupReadyPlayer();
      const { sliderDiv, innerBar } = getSeekElements();
      mockSeekBarRect(innerBar, { left: 0, width: 200, right: 200 });

      mockInvoke.mockClear();
      setupDefaultInvokeMock();
      fireEvent.mouseDown(sliderDiv, { clientX: 100 }); // 50% of 200

      // Should seek to 50% of duration=120 => 60
      expect(mockInvoke).toHaveBeenCalledWith('audio_seek', { positionSecs: 60 });

      // Clean up document listeners
      act(() => { document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    });

    it('mousemove during seek invokes audio_seek', async () => {
      await setupReadyPlayer();
      const { sliderDiv, innerBar } = getSeekElements();
      mockSeekBarRect(innerBar, { left: 0, width: 200, right: 200 });

      mockInvoke.mockClear();
      setupDefaultInvokeMock();
      fireEvent.mouseDown(sliderDiv, { clientX: 100 });
      expect(mockInvoke).toHaveBeenCalledWith('audio_seek', { positionSecs: 60 });

      // Simulate mousemove on document (handler attached to document)
      mockInvoke.mockClear();
      setupDefaultInvokeMock();
      act(() => {
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, bubbles: true }));
      });

      expect(mockInvoke).toHaveBeenCalledWith('audio_seek', { positionSecs: 90 }); // 75% of 120

      // Clean up document listeners
      act(() => {
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
    });

    it('mouseup stops seeking', async () => {
      await setupReadyPlayer();
      const { sliderDiv, innerBar } = getSeekElements();
      mockSeekBarRect(innerBar, { left: 0, width: 200, right: 200 });

      fireEvent.mouseDown(sliderDiv, { clientX: 100 });

      act(() => {
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });

      // After mouseup, further mousemove should NOT invoke additional audio_seek
      mockInvoke.mockClear();
      setupDefaultInvokeMock();
      act(() => {
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 180, bubbles: true }));
      });

      // No new seek calls after mouseup
      expect(mockInvoke).not.toHaveBeenCalledWith('audio_seek', expect.anything());
    });

    it('clamps seek ratio to [0, 1]', async () => {
      await setupReadyPlayer();
      const { sliderDiv, innerBar } = getSeekElements();
      mockSeekBarRect(innerBar, { left: 100, width: 200, right: 300 });

      mockInvoke.mockClear();
      setupDefaultInvokeMock();
      // Click before the bar (clientX < left)
      fireEvent.mouseDown(sliderDiv, { clientX: 50 });
      expect(mockInvoke).toHaveBeenCalledWith('audio_seek', { positionSecs: 0 });

      act(() => {
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });

      mockInvoke.mockClear();
      setupDefaultInvokeMock();
      // Click past the bar (clientX > right)
      fireEvent.mouseDown(sliderDiv, { clientX: 400 });
      expect(mockInvoke).toHaveBeenCalledWith('audio_seek', { positionSecs: 120 }); // duration

      act(() => { document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    });
  });

  // ── Waveform mouse seek tests ─────────────────────────────────────

  describe('Waveform mouse seek', () => {
    async function setupReadyPlayer() {
      renderPlayer();
      await waitForReady();
      await flushMicrotasks();
    }

    function getWaveformContainer(): HTMLElement {
      const canvases = document.querySelectorAll('canvas');
      expect(canvases.length).toBeGreaterThan(0);
      const container = canvases[0].parentElement!;
      return container;
    }

    it('click at 50% width seeks to 50% of duration', async () => {
      await setupReadyPlayer();
      const container = getWaveformContainer();

      container.getBoundingClientRect = vi.fn().mockReturnValue({
        left: 0, right: 480, width: 480, top: 0, bottom: 120, height: 120, x: 0, y: 0,
        toJSON: () => ({}),
      });

      mockInvoke.mockClear();
      setupDefaultInvokeMock();
      fireEvent.mouseDown(container, { clientX: 240 }); // 50%
      expect(mockInvoke).toHaveBeenCalledWith('audio_seek', { positionSecs: 60 });

      act(() => { document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    });

    it('click at left edge seeks to start', async () => {
      await setupReadyPlayer();
      const container = getWaveformContainer();

      container.getBoundingClientRect = vi.fn().mockReturnValue({
        left: 0, right: 480, width: 480, top: 0, bottom: 120, height: 120, x: 0, y: 0,
        toJSON: () => ({}),
      });

      mockInvoke.mockClear();
      setupDefaultInvokeMock();
      fireEvent.mouseDown(container, { clientX: 0 }); // 0%
      expect(mockInvoke).toHaveBeenCalledWith('audio_seek', { positionSecs: 0 });

      act(() => { document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    });

    it('click at right edge seeks to end', async () => {
      await setupReadyPlayer();
      const container = getWaveformContainer();

      container.getBoundingClientRect = vi.fn().mockReturnValue({
        left: 0, right: 480, width: 480, top: 0, bottom: 120, height: 120, x: 0, y: 0,
        toJSON: () => ({}),
      });

      mockInvoke.mockClear();
      setupDefaultInvokeMock();
      fireEvent.mouseDown(container, { clientX: 480 }); // 100%
      expect(mockInvoke).toHaveBeenCalledWith('audio_seek', { positionSecs: 120 });

      act(() => { document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    });
  });
});
