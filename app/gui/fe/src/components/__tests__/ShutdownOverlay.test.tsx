import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ShutdownOverlay from '../ShutdownOverlay';
import { listen } from '@tauri-apps/api/event';

// ── Helpers ──────────────────────────────────────────────────────────

type EventCallback = (event: { payload: unknown }) => void;

/**
 * Captures the callbacks registered via listen() so we can fire them in tests.
 * Returns a map of event name → callback.
 */
function captureListeners() {
  const callbacks: Record<string, EventCallback> = {};
  const unlistenFns: Record<string, ReturnType<typeof vi.fn>> = {};

  (listen as ReturnType<typeof vi.fn>).mockImplementation(
    (eventName: string, cb: EventCallback) => {
      callbacks[eventName] = cb;
      const unlisten = vi.fn();
      unlistenFns[eventName] = unlisten;
      return Promise.resolve(unlisten);
    }
  );

  return { callbacks, unlistenFns };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────

describe('ShutdownOverlay', () => {
  it('renders nothing initially', () => {
    captureListeners();
    const { container } = render(<ShutdownOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('registers listeners for app-shutting-down and shutdown-progress', () => {
    captureListeners();
    render(<ShutdownOverlay />);
    expect(listen).toHaveBeenCalledWith('app-shutting-down', expect.any(Function));
    expect(listen).toHaveBeenCalledWith('shutdown-progress', expect.any(Function));
  });

  it('shows overlay when app-shutting-down event fires', async () => {
    const { callbacks } = captureListeners();
    render(<ShutdownOverlay />);

    await act(async () => {
      callbacks['app-shutting-down']({ payload: undefined });
    });

    expect(screen.getByText('Shutting down...')).toBeInTheDocument();
    expect(screen.getByText(/Stopping services safely/)).toBeInTheDocument();
  });

  it('shows remaining process count from shutdown-progress event', async () => {
    const { callbacks } = captureListeners();
    render(<ShutdownOverlay />);

    await act(async () => {
      callbacks['app-shutting-down']({ payload: undefined });
    });

    await act(async () => {
      callbacks['shutdown-progress']({
        payload: { elapsed_secs: 2, timeout_secs: 45, remaining_processes: 3 },
      });
    });

    expect(screen.getByText('3 processes remaining')).toBeInTheDocument();
  });

  it('uses singular "process" when remaining_processes is 1', async () => {
    const { callbacks } = captureListeners();
    render(<ShutdownOverlay />);

    await act(async () => {
      callbacks['app-shutting-down']({ payload: undefined });
    });

    await act(async () => {
      callbacks['shutdown-progress']({
        payload: { elapsed_secs: 5, timeout_secs: 45, remaining_processes: 1 },
      });
    });

    expect(screen.getByText('1 process remaining')).toBeInTheDocument();
  });

  it('does not show process count when remaining_processes is 0', async () => {
    const { callbacks } = captureListeners();
    render(<ShutdownOverlay />);

    await act(async () => {
      callbacks['app-shutting-down']({ payload: undefined });
    });

    await act(async () => {
      callbacks['shutdown-progress']({
        payload: { elapsed_secs: 10, timeout_secs: 45, remaining_processes: 0 },
      });
    });

    expect(screen.queryByText(/remaining/)).not.toBeInTheDocument();
  });

  it('does not show process count before shutdown-progress fires', async () => {
    const { callbacks } = captureListeners();
    render(<ShutdownOverlay />);

    await act(async () => {
      callbacks['app-shutting-down']({ payload: undefined });
    });

    // Overlay is visible but no process count yet
    expect(screen.getByText('Shutting down...')).toBeInTheDocument();
    expect(screen.queryByText(/remaining/)).not.toBeInTheDocument();
  });

  it('calls unlisten functions on unmount', async () => {
    const { unlistenFns } = captureListeners();
    const { unmount } = render(<ShutdownOverlay />);

    // Wait for listen promises to resolve
    await act(async () => {});

    unmount();

    // Allow cleanup promises to resolve
    await act(async () => {});

    expect(unlistenFns['app-shutting-down']).toHaveBeenCalled();
    expect(unlistenFns['shutdown-progress']).toHaveBeenCalled();
  });
});
