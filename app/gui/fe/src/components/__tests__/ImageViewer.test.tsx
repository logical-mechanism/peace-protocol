import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('../LoadingSpinner', () => ({
  DelayedSpinner: () => <div data-testid="spinner">Loading...</div>,
}));

const mockObjectUrl = 'blob:mock-image-url';
const createObjectURLSpy = vi.fn().mockReturnValue(mockObjectUrl);
const revokeObjectURLSpy = vi.fn();
globalThis.URL.createObjectURL = createObjectURLSpy;
globalThis.URL.revokeObjectURL = revokeObjectURLSpy;

import ImageViewer from '../ImageViewer';

// ── Helpers ─────────────────────────────────────────────────────────

const testImageData = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG header

function renderViewer(overrides: Partial<{ data: Uint8Array; mimeType: string; onExport: () => void }> = {}) {
  return render(
    <ImageViewer data={testImageData} mimeType="image/png" {...overrides} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────

describe('ImageViewer', () => {
  describe('rendering', () => {
    it('creates blob URL from data', () => {
      renderViewer();
      expect(createObjectURLSpy).toHaveBeenCalled();
    });

    it('revokes blob URL on unmount', () => {
      const { unmount } = renderViewer();
      unmount();
      expect(revokeObjectURLSpy).toHaveBeenCalledWith(mockObjectUrl);
    });

    it('renders an img element with the blob URL', () => {
      renderViewer();
      const img = document.querySelector('img');
      expect(img).not.toBeNull();
      expect(img?.src).toBe(mockObjectUrl);
    });

    it('shows loading spinner initially', () => {
      renderViewer();
      expect(screen.getByTestId('spinner')).toBeInTheDocument();
    });
  });

  describe('zoom controls', () => {
    it('renders zoom in and zoom out buttons', () => {
      renderViewer();
      expect(screen.getByLabelText('Zoom in')).toBeInTheDocument();
      expect(screen.getByLabelText('Zoom out')).toBeInTheDocument();
    });

    it('renders fit to screen button', () => {
      renderViewer();
      expect(screen.getByLabelText('Fit to screen')).toBeInTheDocument();
    });
  });

  describe('transform controls', () => {
    it('renders rotate button', () => {
      renderViewer();
      expect(screen.getByLabelText('Rotate clockwise')).toBeInTheDocument();
    });

    it('renders flip button', () => {
      renderViewer();
      expect(screen.getByLabelText('Flip horizontal')).toBeInTheDocument();
    });
  });

  describe('fullscreen', () => {
    it('renders fullscreen toggle button', () => {
      renderViewer();
      expect(screen.getByLabelText('Expand')).toBeInTheDocument();
    });
  });

  describe('export', () => {
    it('renders Save As button when onExport is provided', () => {
      const onExport = vi.fn();
      renderViewer({ onExport });
      expect(screen.getByLabelText('Save image to file')).toBeInTheDocument();
    });

    it('calls onExport when Save As is clicked', () => {
      const onExport = vi.fn();
      renderViewer({ onExport });
      fireEvent.click(screen.getByLabelText('Save image to file'));
      expect(onExport).toHaveBeenCalledOnce();
    });

    it('does not render Save As when onExport is not provided', () => {
      renderViewer();
      expect(screen.queryByLabelText('Save image to file')).not.toBeInTheDocument();
    });
  });
});
