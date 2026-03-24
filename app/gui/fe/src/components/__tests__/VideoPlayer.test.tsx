import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('../LoadingSpinner', () => ({
  DelayedSpinner: () => <div data-testid="spinner">Loading...</div>,
}));

// jsdom doesn't implement HTMLMediaElement.load
HTMLMediaElement.prototype.load = vi.fn();

import VideoPlayer from '../video';

// ── Helpers ─────────────────────────────────────────────────────────

const mockVideoUrl = 'asset://localhost/mock-video.mp4';

function renderPlayer(overrides: Partial<{
  src: string;
  mimeType: string;
  fileExtension: string;
  onExport: () => void;
  subtitleUrl: string | null;
}> = {}) {
  return render(
    <VideoPlayer
      src={mockVideoUrl}
      mimeType="video/mp4"
      fileExtension=".mp4"
      {...overrides}
    />,
  );
}

/** Wait for controls to appear and video element to render. */
async function waitForControls() {
  await waitFor(() => {
    expect(screen.getByLabelText('Play')).toBeInTheDocument();
    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    const source = video!.querySelector('source');
    expect(source).not.toBeNull();
    expect(source!.getAttribute('src')).toBe(mockVideoUrl);
  });
  // Flush any remaining effects
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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

// ── Tests ───────────────────────────────────────────────────────────

describe('VideoPlayer', () => {
  describe('rendering', () => {
    it('renders without crashing', () => {
      const { container } = renderPlayer();
      expect(container).toBeInTheDocument();
    });

    it('sets src URL on source element with MIME type', () => {
      renderPlayer();
      const video = getVideoElement();
      const source = video.querySelector('source');
      expect(source).not.toBeNull();
      expect(source!.getAttribute('src')).toBe(mockVideoUrl);
      expect(source!.getAttribute('type')).toBe('video/mp4');
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

  describe('loading state', () => {
    it('shows loading spinner initially', () => {
      renderPlayer();
      expect(screen.getByText('Loading video...')).toBeInTheDocument();
    });

    it('hides loading spinner after loadedmetadata', async () => {
      renderPlayer();
      await waitForControls();
      simulateLoadedMetadata(120);
      expect(screen.queryByText('Loading video...')).not.toBeInTheDocument();
    });
  });

  describe('subtitle support', () => {
    it('renders track element when subtitleUrl is provided', () => {
      renderPlayer({ subtitleUrl: 'asset://localhost/mock-subtitle.vtt' });
      const track = document.querySelector('track');
      expect(track).not.toBeNull();
      expect(track!.getAttribute('src')).toBe('asset://localhost/mock-subtitle.vtt');
    });

    it('does not render track element when subtitleUrl is null', () => {
      renderPlayer({ subtitleUrl: null });
      const track = document.querySelector('track');
      expect(track).toBeNull();
    });

    it('does not render track element when subtitleUrl is omitted', () => {
      renderPlayer();
      const track = document.querySelector('track');
      expect(track).toBeNull();
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

      expect(screen.getByLabelText(/Playback speed: 1x/)).toBeInTheDocument();

      await act(async () => { fireEvent.keyDown(document, { key: 's' }); });
      await waitFor(() => expect(screen.getByLabelText(/Playback speed: 1.25x/)).toBeInTheDocument());

      await act(async () => { fireEvent.keyDown(document, { key: 'S' }); });
      await waitFor(() => expect(screen.getByLabelText(/Playback speed: 1.5x/)).toBeInTheDocument());
    });

    it('T toggles time display between total and remaining', async () => {
      renderPlayer();
      await waitForControls();
      simulateLoadedMetadata(120);

      const timeButton = screen.getByTitle(/toggle remaining time/i);
      expect(timeButton).toBeInTheDocument();
      expect(timeButton.textContent).toContain('02:00');
      expect(timeButton.textContent).not.toContain('\u2212');

      await act(async () => { fireEvent.keyDown(document, { key: 't' }); });
      expect(timeButton.textContent).toContain('\u2212');

      await act(async () => { fireEvent.keyDown(document, { key: 'T' }); });
      expect(timeButton.textContent).not.toContain('\u2212');
      expect(timeButton.textContent).toContain('02:00');
    });

    it('double-click on video toggles fullscreen', async () => {
      renderPlayer();
      await waitForControls();
      const video = getVideoElement();

      await act(async () => { fireEvent.doubleClick(video); });
      expect(screen.getByText(/Video is expanded to fullscreen/)).toBeInTheDocument();
    });

    it('single click on video triggers play/pause after delay', async () => {
      renderPlayer();
      await waitForControls();
      const video = getVideoElement();
      const playSpy = vi.spyOn(video, 'play').mockResolvedValue(undefined);

      await act(async () => { fireEvent.click(video); });
      expect(playSpy).not.toHaveBeenCalled();

      // After 200ms delay, play/pause fires
      await new Promise(r => setTimeout(r, 250));
      await act(async () => {});
      expect(playSpy).toHaveBeenCalled();
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
      const video = getVideoElement();
      expect(video.muted).toBe(false);
      expect(parseFloat(slider.value)).toBeGreaterThanOrEqual(initialValue);
    });

    it('ArrowDown decreases volume', async () => {
      renderPlayer();
      await waitForControls();

      const video = getVideoElement();
      await act(async () => { fireEvent.keyDown(document, { key: 'ArrowDown' }); });
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
      expect(ct).toBe(25);
    });

    it('ArrowRight calls skip forward', async () => {
      renderPlayer();
      await waitForControls();
      const video = getVideoElement();
      Object.defineProperty(video, 'duration', { value: 120, writable: false, configurable: true });
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

      await act(async () => { fireEvent.keyDown(document, { key: 'l' }); });
      expect(screen.getByText(/Play\/Pause/)).toBeInTheDocument();
    });

    it('? recalls key hints after initial display dismissed', async () => {
      renderPlayer();
      await waitForControls();

      await act(async () => { fireEvent.keyDown(document, { key: 'l' }); });
      await act(async () => { fireEvent.keyDown(document, { key: '?' }); }); // toggles off
      expect(screen.queryByText(/Play\/Pause/)).not.toBeInTheDocument();

      await act(async () => { fireEvent.keyDown(document, { key: '?' }); }); // toggles on
      expect(screen.getByText(/Play\/Pause/)).toBeInTheDocument();
    });

    it('ignores shortcuts when input is focused', async () => {
      renderPlayer();
      await waitForControls();

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
      renderPlayer({ subtitleUrl: 'asset://localhost/mock-subtitle.vtt' });
      await waitForControls();

      expect(screen.getByLabelText('Show subtitles')).toBeInTheDocument();
      await act(async () => { fireEvent.keyDown(document, { key: 'c' }); });
      expect(screen.getByLabelText('Hide subtitles')).toBeInTheDocument();
    });
  });

  // ── Error state rendering ──────────────────────────────────────────

  describe('error state rendering', () => {
    it('shows error message with role="alert" when video fires error', async () => {
      renderPlayer({ fileExtension: '.mkv', mimeType: 'video/x-matroska' });
      await waitFor(() => {
        const video = getVideoElement();
        expect(video).not.toBeNull();
      });

      const video = getVideoElement();
      Object.defineProperty(video, 'error', { value: { code: 4, message: 'Format not supported' }, configurable: true });
      fireEvent.error(video);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
      expect(screen.getByText('Failed to play video')).toBeInTheDocument();
    });

    it('shows format diagnostic info with extension and MIME type', async () => {
      renderPlayer({ fileExtension: '.webm', mimeType: 'video/webm' });
      const video = getVideoElement();
      Object.defineProperty(video, 'error', { value: { code: 4, message: 'Not supported' }, configurable: true });
      fireEvent.error(video);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
      expect(screen.getByText('WEBM')).toBeInTheDocument();
      expect(screen.getByText('video/webm')).toBeInTheDocument();
    });

    it('shows Save As button when onExport is provided', async () => {
      const onExport = vi.fn();
      renderPlayer({ fileExtension: '.avi', mimeType: 'video/avi', onExport });
      const video = getVideoElement();
      Object.defineProperty(video, 'error', { value: { code: 4, message: 'Not supported' }, configurable: true });
      fireEvent.error(video);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      const saveBtn = screen.getByRole('button', { name: /Save As/i });
      expect(saveBtn).toBeInTheDocument();
      fireEvent.click(saveBtn);
      expect(onExport).toHaveBeenCalled();
    });

    it('shows text fallback when onExport is not provided', async () => {
      renderPlayer({ fileExtension: '.avi', mimeType: 'video/avi' });
      const video = getVideoElement();
      Object.defineProperty(video, 'error', { value: { code: 4, message: 'Not supported' }, configurable: true });
      fireEvent.error(video);

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

      expect(video.currentTime).toBe(0);
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

      const timeDisplay = screen.getByText('00:00 / 00:00');
      expect(timeDisplay).toBeInTheDocument();
    });

    it('formatTime handles negative duration gracefully', async () => {
      renderPlayer();
      await waitForControls();

      const video = getVideoElement();
      Object.defineProperty(video, 'duration', { value: -5, writable: true, configurable: true });
      fireEvent.durationChange(video);

      expect(screen.getByText('00:00 / 00:00')).toBeInTheDocument();
    });

    it('formatTime formats minutes and seconds correctly', async () => {
      renderPlayer();
      await waitForControls();

      simulateLoadedMetadata(125); // 2:05

      expect(screen.getByText(/02:05/)).toBeInTheDocument();
    });

    it('formatTime formats hours correctly for long videos', async () => {
      renderPlayer();
      await waitForControls();

      simulateLoadedMetadata(5423); // 1:30:23

      expect(screen.getByText(/1:30:23/)).toBeInTheDocument();
    });

    it('renders with different src URL', () => {
      const { container } = renderPlayer({ src: 'media://localhost/other-video.webm' });
      expect(container).toBeInTheDocument();
      const video = getVideoElement();
      const source = video.querySelector('source');
      expect(source).not.toBeNull();
      expect(source!.getAttribute('src')).toBe('media://localhost/other-video.webm');
    });
  });

  // ── Fullscreen Escape isolation ─────────────────────────────────────

  describe('fullscreen Escape isolation', () => {
    it('Escape exits fullscreen without propagating to parent handlers', async () => {
      renderPlayer();
      await waitForControls();

      const parentEscapeSpy = vi.fn();
      document.addEventListener('keydown', parentEscapeSpy);

      fireEvent.keyDown(document, { key: 'f' });
      expect(screen.getByText(/Video is expanded to fullscreen/)).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByText(/Video is expanded to fullscreen/)).not.toBeInTheDocument();
      });

      const escapeEvents = parentEscapeSpy.mock.calls.filter(
        (args) => (args[0] as KeyboardEvent).key === 'Escape',
      );
      expect(escapeEvents).toHaveLength(0);

      document.removeEventListener('keydown', parentEscapeSpy);
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
      expect(pipBtn).toHaveAttribute('aria-pressed', 'false');

      Object.defineProperty(document, 'pictureInPictureEnabled', {
        value: false,
        configurable: true,
      });
    });
  });

  // ── Accessibility: aria-live announcements ────────────────────────────

  describe('accessibility aria-live announcements', () => {
    function getLiveRegionTexts(): string[] {
      const regions = document.querySelectorAll('[aria-live="polite"]');
      return Array.from(regions).map(el => el.textContent ?? '');
    }

    it('announces volume on ArrowUp', async () => {
      renderPlayer();
      await waitForControls();

      await act(async () => { fireEvent.keyDown(document, { key: 'ArrowUp' }); });

      expect(getLiveRegionTexts().some(t => /Volume \d+%/.test(t))).toBe(true);
    });

    it('announces "Muted" when volume reaches 0 via ArrowDown', async () => {
      renderPlayer();
      await waitForControls();

      for (let i = 0; i < 11; i++) {
        await act(async () => { fireEvent.keyDown(document, { key: 'ArrowDown' }); });
      }

      expect(getLiveRegionTexts().some(t => t === 'Muted')).toBe(true);
    });

    it('announces speed change on S key', async () => {
      renderPlayer();
      await waitForControls();

      await act(async () => { fireEvent.keyDown(document, { key: 's' }); });

      expect(getLiveRegionTexts().some(t => /Speed [\d.]+x/.test(t))).toBe(true);
    });
  });

  // ── Fullscreen auto-hide timer ──────────────────────────────────────

  describe('fullscreen auto-hide timer', () => {
    it('hides controls after inactivity in fullscreen while playing', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      renderPlayer();
      await waitForControls();

      await act(async () => { fireEvent.keyDown(document, { key: 'f' }); });
      expect(screen.getByText(/Video is expanded to fullscreen/)).toBeInTheDocument();

      const fsVideo = getVideoElement();

      await act(async () => { fireEvent.play(fsVideo); });
      expect(screen.getByLabelText('Pause')).toBeInTheDocument();
      // Advance past one rAF frame (~16ms) so the auto-hide effect's
      // requestAnimationFrame callback fires and schedules the hide timeout
      await act(async () => { vi.advanceTimersByTime(20); });

      const overlay = () => document.querySelector('.fixed.inset-0.z-\\[60\\]') as HTMLElement | null;
      expect(overlay()!.style.cursor).toBe('auto');

      // Initial delay after entering fullscreen is 5s
      await act(async () => { vi.advanceTimersByTime(5001); });
      expect(overlay()!.style.cursor).toBe('none');

      vi.useRealTimers();
    });

    it('controls stay visible when paused in fullscreen', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      renderPlayer();
      await waitForControls();

      await act(async () => { fireEvent.keyDown(document, { key: 'f' }); });
      await act(async () => { vi.advanceTimersByTime(20); });

      const overlay = () => document.querySelector('.fixed.inset-0.z-\\[60\\]') as HTMLElement | null;
      expect(overlay()!.style.cursor).toBe('auto');

      await act(async () => { vi.advanceTimersByTime(10000); });
      expect(overlay()!.style.cursor).toBe('auto');

      vi.useRealTimers();
    });
  });

  // ── Loop-on-ended behavior ──────────────────────────────────────────

  describe('loop-on-ended behavior', () => {
    it('onEnded does NOT reset currentTime when loop is enabled', async () => {
      renderPlayer();
      await waitForControls();

      const video = getVideoElement();
      let ct = 95;
      Object.defineProperty(video, 'currentTime', {
        get: () => ct,
        set: (v: number) => { ct = v; },
        configurable: true,
      });

      await act(async () => { fireEvent.keyDown(document, { key: 'l' }); });
      expect(screen.getByLabelText('Disable repeat')).toBeInTheDocument();

      fireEvent.play(video);
      act(() => { fireEvent(video, new Event('ended')); });

      expect(ct).toBe(95);
      expect(screen.getByLabelText('Play')).toBeInTheDocument();
    });
  });

  // ── Volume boundary clamping ────────────────────────────────────────

  describe('volume boundary clamping', () => {
    it('volume does not go below 0 when pressing ArrowDown at minimum', async () => {
      renderPlayer();
      await waitForControls();

      for (let i = 0; i < 11; i++) {
        await act(async () => { fireEvent.keyDown(document, { key: 'ArrowDown' }); });
      }

      const video = getVideoElement();
      expect(video.volume).toBeGreaterThanOrEqual(0);
      expect(video.volume).toBe(0);
    });

    it('volume does not exceed 1.0 when pressing ArrowUp at maximum', async () => {
      renderPlayer();
      await waitForControls();

      await act(async () => { fireEvent.keyDown(document, { key: 'ArrowUp' }); });
      await act(async () => { fireEvent.keyDown(document, { key: 'ArrowUp' }); });

      const video = getVideoElement();
      expect(video.volume).toBeLessThanOrEqual(1);
      expect(video.volume).toBe(1);
    });
  });

  // ── Seek bar mouse click ────────────────────────────────────────────

  describe('seek bar mouse click', () => {
    it('clicking seek bar at 50% sets currentTime to 50% of duration', async () => {
      renderPlayer();
      await waitForControls();

      const video = getVideoElement();
      simulateLoadedMetadata(100);

      let ct = 0;
      Object.defineProperty(video, 'currentTime', {
        get: () => ct,
        set: (v: number) => { ct = v; },
        configurable: true,
      });

      const seekBar = screen.getByRole('slider', { name: 'Seek' });

      const innerBar = seekBar.querySelector('.h-1\\.5');
      if (innerBar) {
        vi.spyOn(innerBar, 'getBoundingClientRect').mockReturnValue({
          left: 0, right: 200, width: 200, top: 0, bottom: 10, height: 10, x: 0, y: 0, toJSON: () => {},
        });
      }

      fireEvent.mouseDown(seekBar, { clientX: 100 });

      expect(ct).toBe(50);
    });
  });

  // ── Caption track mode synchronization ──────────────────────────────

  describe('caption track mode synchronization', () => {
    it('C key toggles textTracks[0].mode between showing and hidden', async () => {
      renderPlayer({ subtitleUrl: 'asset://localhost/mock-subtitle.vtt' });
      await waitForControls();

      const video = getVideoElement();

      const mockTrack = { mode: 'hidden' as string };
      const textTracks = [mockTrack] as unknown as TextTrackList;
      Object.defineProperty(textTracks, 'length', { value: 1 });
      Object.defineProperty(video, 'textTracks', { value: textTracks, configurable: true });

      await act(async () => { fireEvent.keyDown(document, { key: 'c' }); });
      expect(mockTrack.mode).toBe('showing');

      await act(async () => { fireEvent.keyDown(document, { key: 'C' }); });
      expect(mockTrack.mode).toBe('hidden');
    });
  });

  // ── Accessibility: CC button discoverability ──────────────────────────

  describe('CC button discoverability', () => {
    it('shows disabled CC button when no subtitles are provided', async () => {
      renderPlayer();
      await waitForControls();

      const ccBtn = screen.getByLabelText('Subtitles unavailable');
      expect(ccBtn).toBeInTheDocument();
      expect(ccBtn).toBeDisabled();
    });

    it('shows enabled CC button when subtitles are provided', async () => {
      renderPlayer({ subtitleUrl: 'asset://localhost/mock-subtitle.vtt' });
      await waitForControls();

      const ccBtn = screen.getByLabelText('Show subtitles');
      expect(ccBtn).toBeInTheDocument();
      expect(ccBtn).not.toBeDisabled();
    });

    it('C key does nothing when no subtitles available', async () => {
      renderPlayer();
      await waitForControls();

      const ccBtn = screen.getByLabelText('Subtitles unavailable');
      await act(async () => { fireEvent.keyDown(document, { key: 'c' }); });
      expect(ccBtn).toHaveAttribute('aria-label', 'Subtitles unavailable');
    });
  });
});
