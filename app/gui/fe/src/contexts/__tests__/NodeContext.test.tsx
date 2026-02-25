import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { invoke, listen } from '@tauri-apps/api/core';
import { NodeProvider, useNode } from '../NodeContext';

beforeEach(() => {
  vi.clearAllMocks();

  // Mock listen to return unlisten function
  (listen as ReturnType<typeof vi.fn>).mockImplementation(
    async (_eventName: string, _callback: (event: { payload: unknown }) => void) => {
      return vi.fn(); // unlisten
    }
  );

  // Default: poll returns stopped state
  (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
    overall: 'Stopped',
    sync_progress: 0,
    kupo_sync_progress: 0,
    tip_slot: null,
    tip_height: null,
    network: 'preprod',
    processes: [],
    needs_bootstrap: false,
  });
});

function wrapper({ children }: { children: ReactNode }) {
  return <NodeProvider>{children}</NodeProvider>;
}

describe('NodeContext', () => {
  it('starts in stopped stage and polls get_node_status', async () => {
    const { result } = renderHook(() => useNode(), { wrapper });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('get_node_status');
    });

    expect(result.current.stage).toBe('stopped');
    expect(result.current.network).toBe('preprod');
  });

  it('maps Syncing status from poll to syncing stage', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      overall: 'Syncing',
      sync_progress: 0.75,
      kupo_sync_progress: 0.5,
      tip_slot: 42000,
      tip_height: 1000,
      network: 'preprod',
      processes: [],
      needs_bootstrap: false,
    });

    const { result } = renderHook(() => useNode(), { wrapper });

    await waitFor(() => {
      expect(result.current.stage).toBe('syncing');
    });

    expect(result.current.syncProgress).toBe(75);
    expect(result.current.kupoSyncProgress).toBe(50);
    expect(result.current.tipSlot).toBe(42000);
    expect(result.current.tipHeight).toBe(1000);
  });

  it('maps Synced status from poll', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      overall: 'Synced',
      sync_progress: 1,
      kupo_sync_progress: 1,
      tip_slot: 50000,
      tip_height: 2000,
      network: 'preprod',
      processes: [],
      needs_bootstrap: false,
    });

    const { result } = renderHook(() => useNode(), { wrapper });

    await waitFor(() => {
      expect(result.current.stage).toBe('synced');
    });
  });

  it('startNode calls invoke and sets stage to starting', async () => {
    const { result } = renderHook(() => useNode(), { wrapper });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('get_node_status');
    });

    await act(async () => {
      await result.current.startNode('addr_test1...');
    });

    expect(invoke).toHaveBeenCalledWith('start_node', { walletAddress: 'addr_test1...' });
  });

  it('startNode error sets error state', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string) => {
      if (cmd === 'start_node') throw new Error('Port in use');
      return {
        overall: 'Stopped',
        sync_progress: 0,
        kupo_sync_progress: 0,
        tip_slot: null,
        tip_height: null,
        network: 'preprod',
        processes: [],
        needs_bootstrap: false,
      };
    });

    const { result } = renderHook(() => useNode(), { wrapper });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('get_node_status');
    });

    await act(async () => {
      await result.current.startNode('addr');
    });

    expect(result.current.stage).toBe('error');
    expect(result.current.error).toBe('Port in use');
  });

  it('stopNode calls invoke and resets progress', async () => {
    const { result } = renderHook(() => useNode(), { wrapper });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('get_node_status');
    });

    await act(async () => {
      await result.current.stopNode();
    });

    expect(invoke).toHaveBeenCalledWith('stop_node');
    expect(result.current.stage).toBe('stopped');
  });

  it('startBootstrap calls invoke and sets bootstrapping stage', async () => {
    const { result } = renderHook(() => useNode(), { wrapper });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('get_node_status');
    });

    await act(async () => {
      await result.current.startBootstrap();
    });

    expect(invoke).toHaveBeenCalledWith('start_mithril_bootstrap');
  });

  it('throws when used outside NodeProvider', () => {
    expect(() => {
      renderHook(() => useNode());
    }).toThrow('useNode must be used within NodeProvider');
  });
});
