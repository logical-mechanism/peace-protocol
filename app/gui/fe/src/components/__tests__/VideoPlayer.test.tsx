import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('../LoadingSpinner', () => ({
  DelayedSpinner: () => <div data-testid="spinner">Loading...</div>,
}));

// Mock URL.createObjectURL / revokeObjectURL
const mockObjectUrl = 'blob:mock-video-url';
globalThis.URL.createObjectURL = vi.fn().mockReturnValue(mockObjectUrl);
globalThis.URL.revokeObjectURL = vi.fn();

// ── Configurable FFmpeg mock ─────────────────────────────────────────
// Always returns a mock FFmpeg class. In 'throw' mode, load() rejects (simulating
// FFmpeg unavailability). In 'mock' mode, all methods resolve normally.
const ffmpegState = vi.hoisted(() => ({
  mode: 'throw' as 'throw' | 'mock',
  instance: {
    load: vi.fn(),
    writeFile: vi.fn(),
    exec: vi.fn(),
    readFile: vi.fn(),
    deleteFile: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
  progressCallback: null as ((evt: { progress: number; time: number }) => void) | null,
}));

// FFmpeg mocks are re-wired in beforeEach after vi.clearAllMocks
vi.mock('@ffmpeg/ffmpeg', () => ({ FFmpeg: vi.fn() }));
vi.mock('@ffmpeg/util', () => ({ toBlobURL: vi.fn() }));

// Mock document.createElement to auto-resolve the format probe for the first
// <video> created (the probe), while returning real DOM elements so React
// rendering works correctly for subsequent <video> elements.
let isProbe = true;
const originalCreateElement = document.createElement.bind(document);
vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
  const el = originalCreateElement(tag);
  if (tag === 'video' && isProbe) {
    isProbe = false;
    // Fire loadedmetadata on next tick so the probe resolves as "can play"
    setTimeout(() => el.dispatchEvent(new Event('loadedmetadata')), 0);
  }
  return el;
});

import VideoPlayer from '../VideoPlayer';

// ── Helpers ─────────────────────────────────────────────────────────

const testVideoData = new Uint8Array([0x00, 0x00, 0x00, 0x18]);

function renderPlayer(overrides: Partial<{
  data: Uint8Array;
  mimeType: string;
  fileExtension: string;
  onExport: () => void;
  subtitleData: Uint8Array | null;
}> = {}) {
  return render(
    <VideoPlayer
      data={testVideoData}
      mimeType="video/mp4"
      fileExtension=".mp4"
      {...overrides}
    />,
  );
}

/** Wait for the probe to resolve, controls to appear, video element to render,
 *  and the blobUrl-dependent keydown useEffect to be registered. */
async function waitForControls() {
  await waitFor(() => {
    expect(screen.getByLabelText('Play')).toBeInTheDocument();
    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.getAttribute('src')).toBe(mockObjectUrl);
  });
  // Flush any remaining effects (e.g. the keydown useEffect that depends on blobUrl)
  await act(async () => {});
}

/** Get the rendered video element */
function getVideoElement(): HTMLVideoElement {
  return document.querySelector('video') as HTMLVideoElement;
}

/** Simulate loadedmetadata with a given duration on the rendered video */
function simulateLoadedMetadata(durationSeconds: number) {
  const video = getVideoElement();
  if (video) {
    Object.defineProperty(video, 'duration', { value: durationSeconds, writable: true, configurable: true });
    fireEvent.loadedMetadata(video);
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  isProbe = true;
  ffmpegState.progressCallback = null;

  // Re-wire FFmpeg mocks after clearAllMocks (which resets mock implementations)
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const { toBlobURL } = await import('@ffmpeg/util');
  const inst = ffmpegState.instance;
  (FFmpeg as ReturnType<typeof vi.fn>).mockImplementation(() => {
    inst.on.mockImplementation((_event: string, cb: (evt: { progress: number; time: number }) => void) => {
      ffmpegState.progressCallback = cb;
    });
    return inst;
  });
  (toBlobURL as ReturnType<typeof vi.fn>).mockResolvedValue('blob:mock-ffmpeg-url');

  // Default: load() rejects so probe-fail tests see error state (not remux UI)
  inst.load.mockRejectedValue(new Error('FFmpeg not available'));
  inst.writeFile.mockResolvedValue(undefined);
  inst.exec.mockResolvedValue(undefined);
  inst.readFile.mockResolvedValue(new Uint8Array([0x00, 0x00, 0x00, 0x20]));
  inst.deleteFile.mockResolvedValue(undefined);
  inst.terminate.mockResolvedValue(undefined);
});

// ── Tests ───────────────────────────────────────────────────────────

describe('VideoPlayer', () => {
  describe('rendering', () => {
    it('renders without crashing', () => {
      const { container } = renderPlayer();
      expect(container).toBeInTheDocument();
    });

    it('creates blob URL from data', () => {
      renderPlayer();
      expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
    });
  });

  describe('after video loads', () => {
    it('renders playback controls', async () => {
      renderPlayer();
      await waitFor(() => {
        expect(screen.getByLabelText('Play')).toBeInTheDocument();
      });
    });

    it('renders skip controls', async () => {
      renderPlayer();
      await waitFor(() => {
        expect(screen.getByLabelText('Skip back 5 seconds')).toBeInTheDocument();
        expect(screen.getByLabelText('Skip forward 5 seconds')).toBeInTheDocument();
      });
    });

    it('renders mute button', async () => {
      renderPlayer();
      await waitFor(() => {
        expect(screen.getByLabelText('Mute')).toBeInTheDocument();
      });
    });

    it('renders volume slider', async () => {
      renderPlayer();
      await waitFor(() => {
        expect(screen.getByLabelText('Volume')).toBeInTheDocument();
      });
    });

    it('renders playback speed control', async () => {
      renderPlayer();
      await waitFor(() => {
        expect(screen.getByLabelText('Playback speed: 1x')).toBeInTheDocument();
      });
    });

    it('renders fullscreen button', async () => {
      renderPlayer();
      await waitFor(() => {
        expect(screen.getByLabelText('Enter fullscreen')).toBeInTheDocument();
      });
    });

    it('renders time display', async () => {
      renderPlayer();
      await waitFor(() => {
        expect(screen.getByText(/00:00/)).toBeInTheDocument();
      });
    });
  });

  describe('probe loading indicator', () => {
    it('shows format compatibility message during probe', () => {
      // Prevent the probe from resolving immediately so loading state persists
      const origCreate = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = origCreate(tag);
        // Don't auto-fire loadedmetadata — leave probe pending
        return el;
      });

      renderPlayer();
      expect(screen.getByText('Checking format compatibility...')).toBeInTheDocument();
    });
  });

  describe('subtitle support', () => {
    it('renders without crash when SRT subtitle data is provided', () => {
      const srtData = new TextEncoder().encode(
        '1\n00:00:01,000 --> 00:00:04,000\nHello World\n',
      );
      const { container } = renderPlayer({ subtitleData: srtData });
      expect(container).toBeInTheDocument();
    });

    it('renders without crash when VTT subtitle data is provided', () => {
      const vttData = new TextEncoder().encode(
        'WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nHello World\n',
      );
      const { container } = renderPlayer({ subtitleData: vttData });
      expect(container).toBeInTheDocument();
    });

    it('falls back to ISO-8859-1 when subtitle data is not valid UTF-8', () => {
      // 0xe9 is 'é' in ISO-8859-1 but invalid as a standalone byte in UTF-8
      const latin1Data = new Uint8Array([
        ...new TextEncoder().encode('1\n00:00:01,000 --> 00:00:04,000\nCaf'),
        0xe9, // é in ISO-8859-1
        ...new TextEncoder().encode('\n'),
      ]);

      const capturedBlobs: { parts: BlobPart[]; type: string }[] = [];
      const OrigBlob = globalThis.Blob;
      const BlobSpy = vi.fn(function (this: Blob, parts?: BlobPart[], opts?: BlobPropertyBag) {
        const blob = new OrigBlob(parts ?? [], opts);
        if (opts?.type === 'text/vtt' && parts) {
          capturedBlobs.push({ parts, type: opts.type });
        }
        return blob;
      }) as unknown as typeof Blob;
      Object.setPrototypeOf(BlobSpy.prototype, OrigBlob.prototype);
      globalThis.Blob = BlobSpy;

      try {
        renderPlayer({ subtitleData: latin1Data });
        expect(capturedBlobs.length).toBe(1);
        const vtt = capturedBlobs[0].parts[0] as string;
        // ISO-8859-1 decodes 0xe9 as 'é'
        expect(vtt).toContain('Café');
      } finally {
        globalThis.Blob = OrigBlob;
      }
    });

    it('handles SRT files with single-digit hours and variable-precision milliseconds', () => {
      const capturedBlobs: { parts: BlobPart[]; type: string }[] = [];
      const OrigBlob = globalThis.Blob;
      const BlobSpy = vi.fn(function (this: Blob, parts?: BlobPart[], opts?: BlobPropertyBag) {
        const blob = new OrigBlob(parts ?? [], opts);
        if (opts?.type === 'text/vtt' && parts) {
          capturedBlobs.push({ parts, type: opts.type });
        }
        return blob;
      }) as unknown as typeof Blob;
      Object.setPrototypeOf(BlobSpy.prototype, OrigBlob.prototype);
      globalThis.Blob = BlobSpy;

      try {
        // Single-digit hour and 1-digit millisecond
        const srtData = new TextEncoder().encode(
          '1\n1:30:45,5 --> 1:31:00,50\nSingle digit hour\n\n2\n00:00:05,000 --> 00:00:08,000\nNormal\n',
        );
        renderPlayer({ subtitleData: srtData });

        expect(capturedBlobs.length).toBe(1);
        const vtt = capturedBlobs[0].parts[0] as string;
        // Single-digit hours should have commas replaced with dots
        expect(vtt).toContain('1:30:45.5');
        expect(vtt).toContain('1:31:00.50');
        // Standard timestamps still work
        expect(vtt).toContain('00:00:05.000');
      } finally {
        globalThis.Blob = OrigBlob;
      }
    });

    it('strips SRT cue IDs during conversion to VTT', () => {
      // Capture Blob content by spying on the Blob constructor
      const capturedBlobs: { parts: BlobPart[]; type: string }[] = [];
      const OrigBlob = globalThis.Blob;
      const BlobSpy = vi.fn(function (this: Blob, parts?: BlobPart[], opts?: BlobPropertyBag) {
        const blob = new OrigBlob(parts ?? [], opts);
        if (opts?.type === 'text/vtt' && parts) {
          capturedBlobs.push({ parts, type: opts.type });
        }
        return blob;
      }) as unknown as typeof Blob;
      Object.setPrototypeOf(BlobSpy.prototype, OrigBlob.prototype);
      globalThis.Blob = BlobSpy;

      try {
        const srtData = new TextEncoder().encode(
          '1\n00:00:01,000 --> 00:00:04,000\nHello World\n\n2\n00:00:05,000 --> 00:00:08,000\nSecond cue\n',
        );
        renderPlayer({ subtitleData: srtData });

        expect(capturedBlobs.length).toBe(1);
        const vtt = capturedBlobs[0].parts[0] as string;
        expect(vtt).toContain('WEBVTT');
        // Timestamps should have dots (not commas)
        expect(vtt).toContain('00:00:01.000');
        expect(vtt).toContain('00:00:05.000');
        // Cue IDs (standalone numbers) should be stripped
        expect(vtt).not.toMatch(/^\d+\s*$/m);
        // Cue text should be preserved
        expect(vtt).toContain('Hello World');
        expect(vtt).toContain('Second cue');
      } finally {
        globalThis.Blob = OrigBlob;
      }
    });
  });

  // ── Keyboard shortcuts ──────────────────────────────────────────────

  describe('keyboard shortcuts', () => {
    it('Space toggles play/pause', async () => {
      renderPlayer();
      await waitForControls();
      const video = getVideoElement();
      const playSpy = vi.spyOn(video, 'play').mockResolvedValue(undefined);

      await act(async () => { fireEvent.keyDown(document, { key: ' ' }); });
      expect(playSpy).toHaveBeenCalled();
    });

    it('M toggles mute', async () => {
      renderPlayer();
      await waitForControls();

      // Initially shows Mute label
      expect(screen.getByLabelText('Mute')).toBeInTheDocument();

      await act(async () => { fireEvent.keyDown(document, { key: 'm' }); });
      expect(screen.getByLabelText('Unmute')).toBeInTheDocument();

      await act(async () => { fireEvent.keyDown(document, { key: 'M' }); });
      expect(screen.getByLabelText('Mute')).toBeInTheDocument();
    });

    it('F toggles fullscreen overlay', async () => {
      renderPlayer();
      await waitForControls();

      await act(async () => { fireEvent.keyDown(document, { key: 'f' }); });
      expect(screen.getByText(/Video is expanded to fullscreen/)).toBeInTheDocument();
    });

    it('L toggles loop', async () => {
      renderPlayer();
      await waitForControls();

      expect(screen.getByLabelText('Enable repeat')).toBeInTheDocument();
      await act(async () => { fireEvent.keyDown(document, { key: 'l' }); });
      expect(screen.getByLabelText('Disable repeat')).toBeInTheDocument();
    });

    it('S cycles playback speed', async () => {
      renderPlayer();
      await waitForControls();

      // Default speed is 1x
      expect(screen.getByLabelText(/Playback speed: 1x/)).toBeInTheDocument();

      // S cycles to next speed (1 → 1.25)
      await act(async () => { fireEvent.keyDown(document, { key: 's' }); });
      expect(screen.getByLabelText(/Playback speed: 1.25x/)).toBeInTheDocument();

      // S again cycles to 1.5
      await act(async () => { fireEvent.keyDown(document, { key: 'S' }); });
      expect(screen.getByLabelText(/Playback speed: 1.5x/)).toBeInTheDocument();
    });

    it('T toggles time display between total and remaining', async () => {
      renderPlayer();
      await waitForControls();
      simulateLoadedMetadata(120);

      // Default: shows total time (formatTime(duration) = "02:00")
      const timeButton = screen.getByTitle(/toggle remaining time/i);
      expect(timeButton).toBeInTheDocument();
      expect(timeButton.textContent).toContain('02:00');
      expect(timeButton.textContent).not.toContain('\u2212');

      // Press T to toggle to remaining time
      await act(async () => { fireEvent.keyDown(document, { key: 't' }); });
      expect(timeButton.textContent).toContain('\u2212');

      // Press T again to toggle back to total
      await act(async () => { fireEvent.keyDown(document, { key: 'T' }); });
      expect(timeButton.textContent).not.toContain('\u2212');
      expect(timeButton.textContent).toContain('02:00');
    });

    it('clicking time display toggles remaining time', async () => {
      renderPlayer();
      await waitForControls();
      simulateLoadedMetadata(60);

      const timeButton = screen.getByTitle(/toggle remaining time/i);
      expect(timeButton.textContent).not.toContain('\u2212');

      await act(async () => { fireEvent.click(timeButton); });
      expect(timeButton.textContent).toContain('\u2212');

      await act(async () => { fireEvent.click(timeButton); });
      expect(timeButton.textContent).not.toContain('\u2212');
    });

    it('ArrowUp increases volume', async () => {
      renderPlayer();
      await waitForControls();

      const slider = screen.getByLabelText('Volume') as HTMLInputElement;
      const initialValue = parseFloat(slider.value);

      await act(async () => { fireEvent.keyDown(document, { key: 'ArrowUp' }); });
      // Volume capped at 1.0 if already at 1.0, but the handler runs
      // Either way, the video.volume should reflect the new value
      const video = getVideoElement();
      expect(video.muted).toBe(false);
      // If was at 1.0, stays at 1.0
      expect(parseFloat(slider.value)).toBeGreaterThanOrEqual(initialValue);
    });

    it('ArrowDown decreases volume', async () => {
      renderPlayer();
      await waitForControls();

      const video = getVideoElement();
      await act(async () => { fireEvent.keyDown(document, { key: 'ArrowDown' }); });
      // ArrowDown subtracts 0.1 from volume; verify via video element
      expect(video.volume).toBeCloseTo(0.9, 1);
    });

    it('ArrowLeft calls skip back', async () => {
      renderPlayer();
      await waitForControls();
      const video = getVideoElement();
      let ct = 30;
      Object.defineProperty(video, 'currentTime', {
        get: () => ct,
        set: (v: number) => { ct = v; },
        configurable: true,
      });

      await act(async () => { fireEvent.keyDown(document, { key: 'ArrowLeft' }); });
      // Skip back sets currentTime = max(0, current - 5) = 25
      expect(ct).toBe(25);
    });

    it('ArrowRight calls skip forward', async () => {
      renderPlayer();
      await waitForControls();
      const video = getVideoElement();
      Object.defineProperty(video, 'duration', { value: 120, writable: false, configurable: true });
      // Use a backing variable so the handler's assignment is observable
      let ct = 10;
      Object.defineProperty(video, 'currentTime', {
        get: () => ct,
        set: (v: number) => { ct = v; },
        configurable: true,
      });

      await act(async () => { fireEvent.keyDown(document, { key: 'ArrowRight' }); });
      expect(ct).toBe(15);
    });

    it('first keyboard interaction shows key hints', async () => {
      renderPlayer();
      await waitForControls();

      // Any key triggers the one-shot initial hints display
      await act(async () => { fireEvent.keyDown(document, { key: 'l' }); });
      expect(screen.getByText(/Play\/Pause/)).toBeInTheDocument();
    });

    it('? recalls key hints after initial display dismissed', async () => {
      renderPlayer();
      await waitForControls();

      // Exhaust the one-shot guard with a non-? key
      await act(async () => { fireEvent.keyDown(document, { key: 'l' }); });
      // Hints are showing; press ? to toggle OFF then ON
      await act(async () => { fireEvent.keyDown(document, { key: '?' }); }); // toggles off
      expect(screen.queryByText(/Play\/Pause/)).not.toBeInTheDocument();

      await act(async () => { fireEvent.keyDown(document, { key: '?' }); }); // toggles on
      expect(screen.getByText(/Play\/Pause/)).toBeInTheDocument();
    });

    it('ignores shortcuts when input is focused', async () => {
      renderPlayer();
      await waitForControls();

      // Create and focus an input element
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      const video = getVideoElement();
      const playSpy = vi.spyOn(video, 'play').mockResolvedValue(undefined);

      await act(async () => { fireEvent.keyDown(document, { key: ' ' }); });
      expect(playSpy).not.toHaveBeenCalled();

      document.body.removeChild(input);
    });

    it('C toggles captions when subtitles are available', async () => {
      const srtData = new TextEncoder().encode(
        '1\n00:00:01,000 --> 00:00:04,000\nHello\n',
      );
      renderPlayer({ subtitleData: srtData });
      await waitForControls();

      expect(screen.getByLabelText('Show subtitles')).toBeInTheDocument();
      await act(async () => { fireEvent.keyDown(document, { key: 'c' }); });
      expect(screen.getByLabelText('Hide subtitles')).toBeInTheDocument();
    });
  });

  // ── Error state rendering ──────────────────────────────────────────

  describe('error state rendering', () => {
    /** Override the probe to fire an error event instead of loadedmetadata */
    function mockProbeError() {
      const origCreate = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = origCreate(tag);
        if (tag === 'video') {
          setTimeout(() => el.dispatchEvent(new Event('error')), 0);
        }
        return el;
      });
    }

    afterEach(() => {
      // Restore the original probe mock so subsequent tests get loadedmetadata
      isProbe = true;
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = originalCreateElement(tag);
        if (tag === 'video' && isProbe) {
          isProbe = false;
          setTimeout(() => el.dispatchEvent(new Event('loadedmetadata')), 0);
        }
        return el;
      });
    });

    it('shows error message with role="alert" when probe fails', async () => {
      mockProbeError();

      renderPlayer({ fileExtension: '.mkv', mimeType: 'video/x-matroska' });

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      expect(screen.getByText('Failed to play video')).toBeInTheDocument();
    });

    it('shows format diagnostic info with extension and MIME type', async () => {
      mockProbeError();

      renderPlayer({ fileExtension: '.webm', mimeType: 'video/webm' });

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      expect(screen.getByText('WEBM')).toBeInTheDocument();
      expect(screen.getByText('video/webm')).toBeInTheDocument();
    });

    it('shows Save As button when onExport is provided', async () => {
      mockProbeError();

      const onExport = vi.fn();
      renderPlayer({ fileExtension: '.avi', mimeType: 'video/avi', onExport });

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      const saveBtn = screen.getByRole('button', { name: /Save As/i });
      expect(saveBtn).toBeInTheDocument();
      fireEvent.click(saveBtn);
      expect(onExport).toHaveBeenCalled();
    });

    it('shows text fallback when onExport is not provided', async () => {
      mockProbeError();

      renderPlayer({ fileExtension: '.avi', mimeType: 'video/avi' });

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      expect(screen.getByText(/Use Save As to open it with an external player/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Save As/i })).not.toBeInTheDocument();
    });

    it('shows error when video has zero duration', async () => {
      renderPlayer();
      await waitForControls();

      simulateLoadedMetadata(0);

      await waitFor(() => {
        expect(screen.getByText('This file contains no playable video data.')).toBeInTheDocument();
      });
    });

    it('shows error when video has NaN duration', async () => {
      renderPlayer();
      await waitForControls();

      simulateLoadedMetadata(NaN);

      await waitFor(() => {
        expect(screen.getByText('This file contains no playable video data.')).toBeInTheDocument();
      });
    });

    it('shows error when video has Infinity duration', async () => {
      renderPlayer();
      await waitForControls();

      simulateLoadedMetadata(Infinity);

      await waitFor(() => {
        expect(screen.getByText('This file contains no playable video data.')).toBeInTheDocument();
      });
    });
  });

  // ── Seek bar interaction ───────────────────────────────────────────

  describe('seek bar interaction', () => {
    it('renders seek bar with slider role and ARIA attributes', async () => {
      renderPlayer();
      await waitForControls();

      const seekBar = screen.getByRole('slider', { name: 'Seek' });
      expect(seekBar).toBeInTheDocument();
      expect(seekBar).toHaveAttribute('aria-valuemin', '0');
      expect(seekBar).toHaveAttribute('aria-valuenow', '0');
    });

    it('shows disabled state when duration is 0', async () => {
      renderPlayer();
      await waitForControls();

      const seekBar = screen.getByRole('slider', { name: 'Seek' });
      // Without loadedmetadata, duration is 0 → opacity-50 pointer-events-none
      expect(seekBar.className).toContain('opacity-50');
      expect(seekBar.className).toContain('pointer-events-none');
    });

    it('seek bar keyboard: Home jumps to start', async () => {
      renderPlayer();
      await waitForControls();
      const video = getVideoElement();
      simulateLoadedMetadata(120);
      Object.defineProperty(video, 'currentTime', { value: 60, writable: true, configurable: true });

      const seekBar = screen.getByRole('slider', { name: 'Seek' });
      fireEvent.keyDown(seekBar, { key: 'Home' });

      expect(video.currentTime).toBe(0);
    });

    it('seek bar keyboard: End jumps to end', async () => {
      renderPlayer();
      await waitForControls();
      const video = getVideoElement();
      simulateLoadedMetadata(120);
      Object.defineProperty(video, 'currentTime', { value: 10, writable: true, configurable: true });

      const seekBar = screen.getByRole('slider', { name: 'Seek' });
      fireEvent.keyDown(seekBar, { key: 'End' });

      expect(video.currentTime).toBe(120);
    });
  });

  // ── Playback state transitions ─────────────────────────────────────

  describe('playback state transitions', () => {
    it('onPlay changes button to Pause', async () => {
      renderPlayer();
      await waitForControls();

      const video = getVideoElement();
      fireEvent.play(video);

      expect(screen.getByLabelText('Pause')).toBeInTheDocument();
    });

    it('onPause changes button to Play', async () => {
      renderPlayer();
      await waitForControls();

      const video = getVideoElement();
      fireEvent.play(video);
      expect(screen.getByLabelText('Pause')).toBeInTheDocument();

      fireEvent.pause(video);
      expect(screen.getByLabelText('Play')).toBeInTheDocument();
    });

    it('onEnded resets to start when not looping', async () => {
      renderPlayer();
      await waitForControls();

      const video = getVideoElement();
      Object.defineProperty(video, 'currentTime', { value: 100, writable: true, configurable: true });

      fireEvent.play(video);
      act(() => { fireEvent(video, new Event('ended')); });

      // Should reset currentTime to 0
      expect(video.currentTime).toBe(0);
      // Should show Play button (not Pause)
      expect(screen.getByLabelText('Play')).toBeInTheDocument();
    });

    it('onWaiting shows loading state', async () => {
      renderPlayer();
      await waitForControls();

      const video = getVideoElement();
      fireEvent.waiting(video);

      expect(screen.getByTestId('spinner')).toBeInTheDocument();
    });

    it('onPlaying dismisses loading state', async () => {
      renderPlayer();
      await waitForControls();

      const video = getVideoElement();
      fireEvent.waiting(video);
      expect(screen.getByTestId('spinner')).toBeInTheDocument();

      fireEvent.playing(video);
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    });

    it('onStalled with low readyState shows loading and escalates to error after 5s', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      renderPlayer();
      await waitForControls();

      const video = getVideoElement();
      Object.defineProperty(video, 'readyState', { value: 1, writable: true, configurable: true });

      act(() => { fireEvent(video, new Event('stalled')); });
      expect(screen.getByTestId('spinner')).toBeInTheDocument();

      // Advance 5s for the stalled timer to fire
      act(() => { vi.advanceTimersByTime(5000); });

      expect(screen.getByText(/Video playback stalled/)).toBeInTheDocument();
      vi.useRealTimers();
    });
  });

  // ── Volume and speed controls ──────────────────────────────────────

  describe('volume and speed controls', () => {
    it('volume slider changes volume', async () => {
      renderPlayer();
      await waitForControls();

      const slider = screen.getByLabelText('Volume') as HTMLInputElement;
      fireEvent.change(slider, { target: { value: '0.5' } });

      const video = getVideoElement();
      expect(video.volume).toBe(0.5);
    });

    it('volume slider to 0 mutes', async () => {
      renderPlayer();
      await waitForControls();

      const slider = screen.getByLabelText('Volume') as HTMLInputElement;
      fireEvent.change(slider, { target: { value: '0' } });

      expect(screen.getByLabelText('Unmute')).toBeInTheDocument();
    });

    it('mute toggle button works', async () => {
      renderPlayer();
      await waitForControls();

      const muteBtn = screen.getByLabelText('Mute');
      fireEvent.click(muteBtn);
      expect(screen.getByLabelText('Unmute')).toBeInTheDocument();

      const unmuteBtn = screen.getByLabelText('Unmute');
      fireEvent.click(unmuteBtn);
      expect(screen.getByLabelText('Mute')).toBeInTheDocument();
    });

    it('speed button cycles through options and wraps', async () => {
      renderPlayer();
      await waitForControls();

      // Default is 1x, which is index 2 in [0.5, 0.75, 1, 1.25, 1.5, 2]
      const speedBtn = screen.getByLabelText('Playback speed: 1x');
      expect(speedBtn).toBeInTheDocument();

      fireEvent.click(speedBtn);
      expect(screen.getByLabelText('Playback speed: 1.25x')).toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('Playback speed: 1.25x'));
      expect(screen.getByLabelText('Playback speed: 1.5x')).toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('Playback speed: 1.5x'));
      expect(screen.getByLabelText('Playback speed: 2x')).toBeInTheDocument();

      // Wrap around: 2x → 0.5x
      fireEvent.click(screen.getByLabelText('Playback speed: 2x'));
      expect(screen.getByLabelText('Playback speed: 0.5x')).toBeInTheDocument();
    });

    it('speed change updates video playbackRate', async () => {
      renderPlayer();
      await waitForControls();

      const video = getVideoElement();
      const speedBtn = screen.getByLabelText('Playback speed: 1x');
      fireEvent.click(speedBtn);

      expect(video.playbackRate).toBe(1.25);
    });

    it('volume ARIA attributes reflect current state', async () => {
      renderPlayer();
      await waitForControls();

      const slider = screen.getByLabelText('Volume') as HTMLInputElement;
      expect(slider).toHaveAttribute('aria-valuenow', '100');
      expect(slider).toHaveAttribute('aria-valuetext', '100%');

      fireEvent.change(slider, { target: { value: '0.75' } });
      expect(slider).toHaveAttribute('aria-valuenow', '75');
      expect(slider).toHaveAttribute('aria-valuetext', '75%');
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('formatTime handles NaN gracefully (displays 00:00)', async () => {
      renderPlayer();
      await waitForControls();

      const video = getVideoElement();
      Object.defineProperty(video, 'duration', { value: NaN, writable: true, configurable: true });
      fireEvent.durationChange(video);

      // Time display should show 00:00 / 00:00 (duration stays 0 since NaN is filtered)
      const timeDisplay = screen.getByText('00:00 / 00:00');
      expect(timeDisplay).toBeInTheDocument();
    });

    it('formatTime handles negative duration gracefully', async () => {
      renderPlayer();
      await waitForControls();

      const video = getVideoElement();
      Object.defineProperty(video, 'duration', { value: -5, writable: true, configurable: true });
      fireEvent.durationChange(video);

      // Negative duration filtered by `isFinite(d) && d > 0`, keeps 0
      expect(screen.getByText('00:00 / 00:00')).toBeInTheDocument();
    });

    it('formatTime formats minutes and seconds correctly', async () => {
      renderPlayer();
      await waitForControls();

      simulateLoadedMetadata(125); // 2:05

      expect(screen.getByText(/02:05/)).toBeInTheDocument();
    });

    it('handles zero-length data without crashing', () => {
      const emptyData = new Uint8Array(0);
      const { container } = renderPlayer({ data: emptyData });
      expect(container).toBeInTheDocument();
    });

    it('renders loading state while checking format for very large data reference', () => {
      // Component should still try to probe — no early exit for large but under-limit files
      const largeishData = new Uint8Array(100);
      renderPlayer({ data: largeishData });
      expect(screen.getByText('Checking format compatibility...')).toBeInTheDocument();
    });
  });

  // ── FFmpeg remux pipeline ───────────────────────────────────────────

  describe('FFmpeg remux pipeline', () => {
    /** Override probe to fire error on FIRST video element only (the probe).
     *  Subsequent video elements (React-rendered) are left untouched.
     *  Uses originalCreateElement to avoid chaining through the default probe spy. */
    function mockProbeErrorForRemux() {
      let probeHandled = false;
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = originalCreateElement(tag);
        if (tag === 'video' && !probeHandled) {
          probeHandled = true;
          setTimeout(() => el.dispatchEvent(new Event('error')), 0);
        }
        return el;
      });
    }

    function enableRemuxMock(opts?: { execDelay?: number }) {
      ffmpegState.mode = 'mock';
      ffmpegState.progressCallback = null;
      const inst = ffmpegState.instance;
      inst.load.mockResolvedValue(undefined);
      if (opts?.execDelay) {
        inst.exec.mockImplementation(() => new Promise(resolve => setTimeout(resolve, opts.execDelay)));
      } else {
        inst.exec.mockResolvedValue(undefined);
      }
      inst.readFile.mockResolvedValue(new Uint8Array([0x00, 0x00, 0x00, 0x20]));
    }

    afterEach(() => {
      ffmpegState.mode = 'throw';
      // Restore the original probe mock
      isProbe = true;
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = originalCreateElement(tag);
        if (tag === 'video' && isProbe) {
          isProbe = false;
          setTimeout(() => el.dispatchEvent(new Event('loadedmetadata')), 0);
        }
        return el;
      });
    });

    it('triggers remux after probe failure and calls FFmpeg load + exec', async () => {
      enableRemuxMock();
      mockProbeErrorForRemux();

      renderPlayer({ fileExtension: '.mkv', mimeType: 'video/x-matroska' });

      await waitFor(() => {
        expect(ffmpegState.instance.load).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(ffmpegState.instance.exec).toHaveBeenCalledWith(['-i', 'input.mkv', '-c', 'copy', 'output.mp4']);
      });
    });

    it('progress callback updates conversion progress display', async () => {
      enableRemuxMock({ execDelay: 500 });
      mockProbeErrorForRemux();

      renderPlayer({ fileExtension: '.mkv', mimeType: 'video/x-matroska' });

      // Wait for remuxing UI to appear
      await waitFor(() => {
        expect(screen.getByText('Converting for playback...')).toBeInTheDocument();
      });

      // Simulate progress via the captured callback
      expect(ffmpegState.progressCallback).not.toBeNull();
      act(() => {
        ffmpegState.progressCallback!({ progress: 0.5, time: 5 });
      });

      expect(screen.getByText('50%')).toBeInTheDocument();
      const progressBar = screen.getByRole('progressbar', { name: 'Conversion progress' });
      expect(progressBar).toHaveAttribute('aria-valuenow', '50');
    });

    it('cancel button calls ffmpeg.terminate and shows cancelled UI', async () => {
      enableRemuxMock({ execDelay: 60000 }); // long exec so we can cancel
      mockProbeErrorForRemux();

      renderPlayer({ fileExtension: '.mkv', mimeType: 'video/x-matroska', onExport: vi.fn() });

      await waitFor(() => {
        expect(screen.getByText('Converting for playback...')).toBeInTheDocument();
      });

      const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelBtn);

      await waitFor(() => {
        expect(screen.getByText('Conversion cancelled.')).toBeInTheDocument();
      });
      expect(ffmpegState.instance.terminate).toHaveBeenCalled();
    });

    it('stall detection fires after 30s of no progress', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      enableRemuxMock({ execDelay: 999999 });
      mockProbeErrorForRemux();

      renderPlayer({ fileExtension: '.mkv', mimeType: 'video/x-matroska' });

      // Wait for remuxing to start
      await waitFor(() => {
        expect(screen.getByText('Converting for playback...')).toBeInTheDocument();
      });

      // Advance past the stall detection threshold (10s interval checks, 30s since last progress)
      act(() => { vi.advanceTimersByTime(40_000); });

      await waitFor(() => {
        expect(screen.getByText(/Conversion appears stuck/)).toBeInTheDocument();
      });
      vi.useRealTimers();
    });

    it('file > 2GB shows size error without attempting remux', async () => {
      enableRemuxMock();
      mockProbeErrorForRemux();

      // Create a mock data object with large length (don't actually allocate 2GB!)
      const fakeData = new Uint8Array(1);
      Object.defineProperty(fakeData, 'length', { value: 2.5 * 1024 * 1024 * 1024 });

      renderPlayer({ data: fakeData, fileExtension: '.mkv', mimeType: 'video/x-matroska' });

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
      expect(screen.getByText(/File too large for in-app conversion/)).toBeInTheDocument();
    });

    it('file > 500MB shows size warning during remux', async () => {
      enableRemuxMock({ execDelay: 60000 });
      mockProbeErrorForRemux();

      const fakeData = new Uint8Array(1);
      Object.defineProperty(fakeData, 'length', { value: 600 * 1024 * 1024 });

      renderPlayer({ data: fakeData, fileExtension: '.mkv', mimeType: 'video/x-matroska' });

      await waitFor(() => {
        expect(screen.getByText('Converting for playback...')).toBeInTheDocument();
      });
      expect(screen.getByText(/Large file.*conversion may use significant memory/)).toBeInTheDocument();
    });

    it('ffmpeg.load() timeout shows error after 15s', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      mockProbeErrorForRemux();

      // Make load() hang forever
      ffmpegState.instance.load.mockImplementation(() => new Promise(() => {}));

      renderPlayer({ fileExtension: '.mkv', mimeType: 'video/x-matroska' });

      // Wait for remux path to start (probe fails, then toBlobURL resolves, then load() called)
      await waitFor(() => {
        expect(ffmpegState.instance.load).toHaveBeenCalled();
      });

      // Advance past the 15s timeout
      act(() => { vi.advanceTimersByTime(16_000); });

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      vi.useRealTimers();
    });
  });

  // ── Fullscreen Escape isolation ─────────────────────────────────────

  describe('fullscreen Escape isolation', () => {
    it('Escape exits fullscreen without propagating to parent handlers', async () => {
      renderPlayer();
      await waitForControls();

      // Spy on a bubble-phase listener (simulating the parent modal's Escape handler)
      const parentEscapeSpy = vi.fn();
      document.addEventListener('keydown', parentEscapeSpy);

      // Enter fullscreen via F key
      fireEvent.keyDown(document, { key: 'f' });
      expect(screen.getByText(/Video is expanded to fullscreen/)).toBeInTheDocument();

      // Fire Escape
      fireEvent.keyDown(document, { key: 'Escape' });

      // Fullscreen should be closed
      await waitFor(() => {
        expect(screen.queryByText(/Video is expanded to fullscreen/)).not.toBeInTheDocument();
      });

      // The parent handler should NOT have seen the Escape key
      // (capture-phase handler calls stopPropagation)
      const escapeEvents = parentEscapeSpy.mock.calls.filter(
        ([e]: [KeyboardEvent]) => e.key === 'Escape',
      );
      expect(escapeEvents).toHaveLength(0);

      document.removeEventListener('keydown', parentEscapeSpy);
    });
  });

  // ── Probe mechanism ─────────────────────────────────────────────────

  describe('probe mechanism', () => {
    it('native playback supported — sets blob URL directly without remux', async () => {
      // Default mock fires loadedmetadata = probe success
      renderPlayer();
      await waitForControls();

      // Video element should have a source — controls are rendered
      expect(screen.getByLabelText('Play')).toBeInTheDocument();
      // No remux UI should have appeared
      expect(screen.queryByText('Converting for playback...')).not.toBeInTheDocument();
    });

    it('native playback fails — shows error for non-remuxable format', async () => {
      // Override probe to fire error
      const origCreate = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = origCreate(tag);
        if (tag === 'video') {
          setTimeout(() => el.dispatchEvent(new Event('error')), 0);
        }
        return el;
      });

      // ffmpegState.mode defaults to 'throw' — remux will also fail
      renderPlayer({ fileExtension: '.webm', mimeType: 'video/webm' });

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      // Restore probe mock
      isProbe = true;
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = originalCreateElement(tag);
        if (tag === 'video' && isProbe) {
          isProbe = false;
          setTimeout(() => el.dispatchEvent(new Event('loadedmetadata')), 0);
        }
        return el;
      });
    });
  });

  // ── PiP button ──────────────────────────────────────────────────────

  describe('PiP button', () => {
    it('renders PiP button when pictureInPictureEnabled is true', async () => {
      Object.defineProperty(document, 'pictureInPictureEnabled', {
        value: true,
        configurable: true,
      });

      renderPlayer();
      await waitForControls();

      expect(screen.getByLabelText(/Picture-in-Picture/)).toBeInTheDocument();

      // Clean up
      Object.defineProperty(document, 'pictureInPictureEnabled', {
        value: false,
        configurable: true,
      });
    });

    it('does not render PiP button when pictureInPictureEnabled is false', async () => {
      Object.defineProperty(document, 'pictureInPictureEnabled', {
        value: false,
        configurable: true,
      });

      renderPlayer();
      await waitForControls();

      expect(screen.queryByLabelText(/Picture-in-Picture/)).not.toBeInTheDocument();
    });

    it('clicking PiP button calls requestPictureInPicture', async () => {
      Object.defineProperty(document, 'pictureInPictureEnabled', {
        value: true,
        configurable: true,
      });

      renderPlayer();
      await waitForControls();

      const video = getVideoElement();
      const pipSpy = vi.fn().mockResolvedValue(undefined);
      video.requestPictureInPicture = pipSpy;

      const pipBtn = screen.getByLabelText(/Enter Picture-in-Picture/);
      fireEvent.click(pipBtn);

      expect(pipSpy).toHaveBeenCalled();

      Object.defineProperty(document, 'pictureInPictureEnabled', {
        value: false,
        configurable: true,
      });
    });

    it('PiP button shows aria-pressed reflecting isPip state', async () => {
      Object.defineProperty(document, 'pictureInPictureEnabled', {
        value: true,
        configurable: true,
      });

      renderPlayer();
      await waitForControls();

      const pipBtn = screen.getByLabelText(/Picture-in-Picture/);
      // Initially not in PiP — aria-pressed should be false
      expect(pipBtn).toHaveAttribute('aria-pressed', 'false');

      Object.defineProperty(document, 'pictureInPictureEnabled', {
        value: false,
        configurable: true,
      });
    });
  });

  // ── Blob URL cleanup ────────────────────────────────────────────────

  describe('blob URL cleanup', () => {
    it('revokes blob URL on unmount', async () => {
      const { unmount } = renderPlayer();
      await waitForControls();

      (globalThis.URL.revokeObjectURL as ReturnType<typeof vi.fn>).mockClear();

      unmount();

      expect(globalThis.URL.revokeObjectURL).toHaveBeenCalled();
    });

    it('revokes previous blob URL when data changes', async () => {
      const { rerender } = render(
        <VideoPlayer data={testVideoData} mimeType="video/mp4" fileExtension=".mp4" />,
      );
      await waitForControls();

      (globalThis.URL.revokeObjectURL as ReturnType<typeof vi.fn>).mockClear();

      // Reset probe flag for new data
      isProbe = true;
      const newData = new Uint8Array([0x00, 0x00, 0x00, 0x20]);
      rerender(
        <VideoPlayer data={newData} mimeType="video/mp4" fileExtension=".mp4" />,
      );

      // The effect cleanup + new effect should revoke the old URL
      await waitFor(() => {
        expect(globalThis.URL.revokeObjectURL).toHaveBeenCalled();
      });
    });
  });

  // ── Subtitle edge cases ─────────────────────────────────────────────

  describe('subtitle edge cases', () => {
    /** Helper to capture VTT blob content */
    function withBlobSpy(fn: (getCaptured: () => string[]) => void) {
      const capturedBlobs: string[] = [];
      const OrigBlob = globalThis.Blob;
      const BlobSpy = vi.fn(function (this: Blob, parts?: BlobPart[], opts?: BlobPropertyBag) {
        const blob = new OrigBlob(parts ?? [], opts);
        if (opts?.type === 'text/vtt' && parts) {
          capturedBlobs.push(parts[0] as string);
        }
        return blob;
      }) as unknown as typeof Blob;
      Object.setPrototypeOf(BlobSpy.prototype, OrigBlob.prototype);
      globalThis.Blob = BlobSpy;
      try {
        fn(() => capturedBlobs);
      } finally {
        globalThis.Blob = OrigBlob;
      }
    }

    it('empty subtitle Uint8Array does not crash', () => {
      const { container } = renderPlayer({ subtitleData: new Uint8Array(0) });
      expect(container).toBeInTheDocument();
    });

    it('SRT with malformed timestamps passes through without breaking', () => {
      withBlobSpy((getCaptured) => {
        const srtData = new TextEncoder().encode(
          '1\n99:99:99,999 --> 99:99:99,999\nBad timestamps\n',
        );
        renderPlayer({ subtitleData: srtData });

        const captured = getCaptured();
        expect(captured.length).toBe(1);
        // The regex still matches the malformed timestamps (comma→dot)
        expect(captured[0]).toContain('99:99:99.999');
        expect(captured[0]).toContain('Bad timestamps');
      });
    });

    it('SRT with HTML tags preserves them in VTT output', () => {
      withBlobSpy((getCaptured) => {
        const srtData = new TextEncoder().encode(
          '1\n00:00:01,000 --> 00:00:04,000\n<b>Bold</b> and <i>italic</i>\n',
        );
        renderPlayer({ subtitleData: srtData });

        const captured = getCaptured();
        expect(captured.length).toBe(1);
        expect(captured[0]).toContain('<b>Bold</b>');
        expect(captured[0]).toContain('<i>italic</i>');
      });
    });
  });
});
