import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { WasmProvider, useWasm } from '../WasmContext';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: listen returns unlisten
  (listen as ReturnType<typeof vi.fn>).mockResolvedValue(vi.fn());
});

function wrapper({ children }: { children: ReactNode }) {
  return <WasmProvider>{children}</WasmProvider>;
}

describe('WasmContext', () => {
  it('auto-checks setup on mount and transitions to ready if setup exists', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(true); // snark_check_setup

    const { result } = renderHook(() => useWasm(), { wrapper });

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    expect(result.current.stage).toBe('ready');
    expect(result.current.progress).toBe(100);
    expect(invoke).toHaveBeenCalledWith('snark_check_setup');
  });

  it('transitions through decompressing when setup does not exist', async () => {
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false) // snark_check_setup → not found
      .mockResolvedValueOnce(undefined); // snark_decompress_setup → success

    const { result } = renderHook(() => useWasm(), { wrapper });

    await waitFor(() => {
      expect(result.current.stage).toBe('ready');
    });

    expect(result.current.isReady).toBe(true);
    expect(invoke).toHaveBeenCalledWith('snark_check_setup');
    expect(invoke).toHaveBeenCalledWith('snark_decompress_setup');
  });

  it('sets error state on invoke failure', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('decompress failed')
    );

    const { result } = renderHook(() => useWasm(), { wrapper });

    await waitFor(() => {
      expect(result.current.stage).toBe('error');
    });

    expect(result.current.error).toBe('decompress failed');
    expect(result.current.isReady).toBe(false);
  });

  it('clearError resets to idle from error state', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('failed')
    );

    const { result } = renderHook(() => useWasm(), { wrapper });

    await waitFor(() => {
      expect(result.current.stage).toBe('error');
    });

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.stage).toBe('idle');
  });

  it('returns safe defaults when used outside WasmProvider', () => {
    const { result } = renderHook(() => useWasm());

    // useWasm returns defaults, doesn't throw
    expect(result.current.isReady).toBe(false);
    expect(result.current.stage).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('checkCache returns boolean from snark_check_setup', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const { result } = renderHook(() => useWasm(), { wrapper });

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    let cached: boolean | undefined;
    await act(async () => {
      cached = await result.current.checkCache();
    });

    expect(cached).toBe(true);
  });

  it('checkCache returns false when invoke throws', async () => {
    // First: setup exists (ready), then checkCache call throws
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(true) // auto-init
      .mockRejectedValueOnce(new Error('no binary'));

    const { result } = renderHook(() => useWasm(), { wrapper });

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    let cached: boolean | undefined;
    await act(async () => {
      cached = await result.current.checkCache();
    });

    expect(cached).toBe(false);
  });

  it('startLoading returns early when already ready', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const { result } = renderHook(() => useWasm(), { wrapper });

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    // Reset mock to track new calls
    (invoke as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      await result.current.startLoading();
    });

    // Should not call snark_check_setup again
    expect(invoke).not.toHaveBeenCalledWith('snark_check_setup');
  });

  it('clearError does nothing when not in error state', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const { result } = renderHook(() => useWasm(), { wrapper });

    await waitFor(() => {
      expect(result.current.stage).toBe('ready');
    });

    act(() => {
      result.current.clearError();
    });

    // Stage should still be ready, not idle
    expect(result.current.stage).toBe('ready');
  });

  it('handles non-Error exception in startLoading', async () => {
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false)  // check: not cached
      .mockRejectedValueOnce('string error'); // decompress fails

    const { result } = renderHook(() => useWasm(), { wrapper });

    await waitFor(() => {
      expect(result.current.stage).toBe('error');
    });

    expect(result.current.error).toBe('string error');
  });

  it('snark-setup-progress event updates progress', async () => {
    let progressCallback: ((event: { payload: { stage: string; message: string; percent: number } }) => void) | null = null;

    (listen as ReturnType<typeof vi.fn>).mockImplementation(
      async (eventName: string, callback: (event: { payload: unknown }) => void) => {
        if (eventName === 'snark-setup-progress') {
          progressCallback = callback as typeof progressCallback;
        }
        return vi.fn();
      }
    );

    // Start decompressing (not found → decompress which we'll never resolve)
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false)  // check: not cached
      .mockImplementationOnce(() => new Promise(() => {})); // decompress hangs

    const { result } = renderHook(() => useWasm(), { wrapper });

    await waitFor(() => {
      expect(result.current.stage).toBe('decompressing');
    });

    // Simulate progress event
    act(() => {
      progressCallback?.({
        payload: { stage: 'decompressing', message: 'Extracting...', percent: 50 },
      });
    });

    expect(result.current.progress).toBe(50);

    // Simulate complete event
    act(() => {
      progressCallback?.({
        payload: { stage: 'complete', message: 'Done', percent: 100 },
      });
    });

    expect(result.current.stage).toBe('ready');
  });
});
