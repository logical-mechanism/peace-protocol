import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
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
    epoch: null,
    era: null,
    slot_in_epoch: null,
    slots_to_epoch_end: null,
    kupo_connection_status: null,
    kupo_seconds_since_last_block: null,
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
      epoch: 150,
      era: 'Conway',
      slot_in_epoch: 200000,
      slots_to_epoch_end: 232000,
      kupo_connection_status: true,
      kupo_seconds_since_last_block: 5.0,
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
      epoch: 150,
      era: 'Conway',
      slot_in_epoch: 300000,
      slots_to_epoch_end: 132000,
      kupo_connection_status: true,
      kupo_seconds_since_last_block: 2.0,
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
        epoch: null,
        era: null,
        slot_in_epoch: null,
        slots_to_epoch_end: null,
        kupo_connection_status: null,
        kupo_seconds_since_last_block: null,
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

  it('process-status event with Error sets error state', async () => {
    let processStatusCallback: ((event: { payload: unknown }) => void) | null = null;

    (listen as ReturnType<typeof vi.fn>).mockImplementation(
      async (eventName: string, callback: (event: { payload: unknown }) => void) => {
        if (eventName === 'process-status') {
          processStatusCallback = callback;
        }
        return vi.fn();
      }
    );

    const { result } = renderHook(() => useNode(), { wrapper });

    await waitFor(() => {
      expect(processStatusCallback).not.toBeNull();
    });

    act(() => {
      processStatusCallback!({
        payload: {
          name: 'cardano-node',
          status: { type: 'Error', message: 'Socket closed' },
          log_line: 'error log line',
        },
      });
    });

    expect(result.current.error).toBe('cardano-node: Socket closed');
    expect(result.current.logs.length).toBeGreaterThan(0);
  });

  it('process-status event with null log_line does not append', async () => {
    let processStatusCallback: ((event: { payload: unknown }) => void) | null = null;

    (listen as ReturnType<typeof vi.fn>).mockImplementation(
      async (eventName: string, callback: (event: { payload: unknown }) => void) => {
        if (eventName === 'process-status') {
          processStatusCallback = callback;
        }
        return vi.fn();
      }
    );

    const { result } = renderHook(() => useNode(), { wrapper });

    await waitFor(() => {
      expect(processStatusCallback).not.toBeNull();
    });

    const logsBefore = result.current.logs.length;

    act(() => {
      processStatusCallback!({
        payload: {
          name: 'ogmios',
          status: { type: 'Running' },
          log_line: null,
        },
      });
    });

    expect(result.current.logs.length).toBe(logsBefore);
  });

  it('stopNode error with non-Error object still sets error', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string) => {
      if (cmd === 'stop_node') throw 'string error';
      return {
        overall: 'Stopped', sync_progress: 0, kupo_sync_progress: 0,
        tip_slot: null, tip_height: null, network: 'preprod',
        processes: [], needs_bootstrap: false,
        epoch: null, era: null, slot_in_epoch: null, slots_to_epoch_end: null,
        kupo_connection_status: null, kupo_seconds_since_last_block: null,
      };
    });

    const { result } = renderHook(() => useNode(), { wrapper });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('get_node_status');
    });

    await act(async () => {
      await result.current.stopNode();
    });

    expect(result.current.error).toBe('string error');
  });

  it('startNode error with non-Error object still sets error', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string) => {
      if (cmd === 'start_node') throw 42;
      return {
        overall: 'Stopped', sync_progress: 0, kupo_sync_progress: 0,
        tip_slot: null, tip_height: null, network: 'preprod',
        processes: [], needs_bootstrap: false,
        epoch: null, era: null, slot_in_epoch: null, slots_to_epoch_end: null,
        kupo_connection_status: null, kupo_seconds_since_last_block: null,
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
    expect(result.current.error).toBe('42');
  });

  it('startBootstrap error with non-Error sets error', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string) => {
      if (cmd === 'start_mithril_bootstrap') throw 'bootstrap failed';
      return {
        overall: 'Stopped', sync_progress: 0, kupo_sync_progress: 0,
        tip_slot: null, tip_height: null, network: 'preprod',
        processes: [], needs_bootstrap: false,
        epoch: null, era: null, slot_in_epoch: null, slots_to_epoch_end: null,
        kupo_connection_status: null, kupo_seconds_since_last_block: null,
      };
    });

    const { result } = renderHook(() => useNode(), { wrapper });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('get_node_status');
    });

    await act(async () => {
      await result.current.startBootstrap();
    });

    expect(result.current.stage).toBe('error');
    expect(result.current.error).toBe('bootstrap failed');
  });

  it('maps Error status from poll to error stage', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      overall: 'Error',
      sync_progress: 0,
      kupo_sync_progress: 0,
      tip_slot: null,
      tip_height: null,
      network: 'preprod',
      processes: [],
      needs_bootstrap: false,
      epoch: null,
      era: null,
      slot_in_epoch: null,
      slots_to_epoch_end: null,
      kupo_connection_status: null,
      kupo_seconds_since_last_block: null,
    });

    const { result } = renderHook(() => useNode(), { wrapper });

    await waitFor(() => {
      expect(result.current.stage).toBe('error');
    });
  });
});
