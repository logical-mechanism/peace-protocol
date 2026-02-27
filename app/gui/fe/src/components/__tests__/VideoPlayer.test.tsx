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

// Mock document.createElement('video') for the probe
const mockProbeVideo = {
  preload: '',
  muted: false,
  src: '',
  load: vi.fn(),
  removeAttribute: vi.fn(),
  addEventListener: vi.fn(),
};

const originalCreateElement = document.createElement.bind(document);
vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
  if (tag === 'video') {
    // Schedule loadedmetadata event on next tick
    setTimeout(() => {
      const handler = mockProbeVideo.addEventListener.mock.calls.find(
        ([event]: [string]) => event === 'loadedmetadata'
      );
      if (handler) handler[1]();
    }, 0);
    return mockProbeVideo as unknown as HTMLElement;
  }
  return originalCreateElement(tag);
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
  mockProbeVideo.addEventListener.mockReset();
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
  });
});
