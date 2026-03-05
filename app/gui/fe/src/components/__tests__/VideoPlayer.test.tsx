import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('../LoadingSpinner', () => ({
  DelayedSpinner: () => <div data-testid="spinner">Loading...</div>,
}));

// Mock URL.createObjectURL / revokeObjectURL
const mockObjectUrl = 'blob:mock-video-url';
globalThis.URL.createObjectURL = vi.fn().mockReturnValue(mockObjectUrl);
globalThis.URL.revokeObjectURL = vi.fn();

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

beforeEach(() => {
  vi.clearAllMocks();
  isProbe = true;
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
});
