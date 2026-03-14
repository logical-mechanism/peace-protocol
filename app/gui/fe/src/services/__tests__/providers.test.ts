// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../kupoAdapter', () => ({
  KupoAdapter: class MockKupoAdapter {
    url: string;
    constructor(url: string) {
      this.url = url;
    }
  },
}));

import { invoke } from '@tauri-apps/api/core';
const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────

describe('getKupoAdapter', () => {
  it('returns a KupoAdapter instance', async () => {
    const { getKupoAdapter } = await import('../providers');
    const adapter = getKupoAdapter();
    expect(adapter).toBeDefined();
    expect((adapter as unknown as { url: string }).url).toBe('http://127.0.0.1:44203');
  });

  it('returns the same instance on repeated calls (singleton)', async () => {
    const { getKupoAdapter } = await import('../providers');
    const adapter1 = getKupoAdapter();
    const adapter2 = getKupoAdapter();
    expect(adapter1).toBe(adapter2);
  });
});

describe('getOgmiosProvider', () => {
  it('returns an IpcOgmiosProvider instance', async () => {
    const { getOgmiosProvider } = await import('../providers');
    const provider = getOgmiosProvider();
    expect(provider).toBeDefined();
    expect(provider.evaluateTx).toBeInstanceOf(Function);
    expect(provider.submitTx).toBeInstanceOf(Function);
  });

  it('returns the same instance on repeated calls (singleton)', async () => {
    const { getOgmiosProvider } = await import('../providers');
    const provider1 = getOgmiosProvider();
    const provider2 = getOgmiosProvider();
    expect(provider1).toBe(provider2);
  });
});

describe('IpcOgmiosProvider.evaluateTx', () => {
  it('sends evaluateTransaction JSON-RPC via ogmios_post', async () => {
    mockInvoke.mockResolvedValueOnce(JSON.stringify({
      jsonrpc: '2.0',
      result: {
        'spend:0': {
          validator: { index: 0, purpose: 'spend' },
          budget: { memory: 100, cpu: 200 },
        },
      },
    }));

    const { getOgmiosProvider } = await import('../providers');
    const provider = getOgmiosProvider();
    const results = await provider.evaluateTx('tx-hex');

    expect(mockInvoke).toHaveBeenCalledWith('ogmios_post', {
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'evaluateTransaction',
        params: { transaction: { cbor: 'tx-hex' } },
        id: null,
      }),
    });

    expect(results).toHaveLength(1);
    expect(results[0].tag).toBe('SPEND');
    expect(results[0].index).toBe(0);
    expect(results[0].budget).toEqual({ mem: 100, steps: 200 });
  });

  it('remaps withdraw purpose to REWARD tag', async () => {
    mockInvoke.mockResolvedValueOnce(JSON.stringify({
      jsonrpc: '2.0',
      result: {
        'withdraw:0': {
          validator: { index: 0, purpose: 'withdraw' },
          budget: { memory: 100, cpu: 200 },
        },
      },
    }));

    const { getOgmiosProvider } = await import('../providers');
    const provider = getOgmiosProvider();
    const results = await provider.evaluateTx('tx-hex');

    expect(results[0].tag).toBe('REWARD');
  });

  it('handles mixed purposes — only withdraw is remapped', async () => {
    mockInvoke.mockResolvedValueOnce(JSON.stringify({
      jsonrpc: '2.0',
      result: {
        'spend:0': {
          validator: { index: 0, purpose: 'spend' },
          budget: { memory: 10, cpu: 20 },
        },
        'withdraw:1': {
          validator: { index: 1, purpose: 'withdraw' },
          budget: { memory: 30, cpu: 40 },
        },
        'mint:2': {
          validator: { index: 2, purpose: 'mint' },
          budget: { memory: 50, cpu: 60 },
        },
      },
    }));

    const { getOgmiosProvider } = await import('../providers');
    const provider = getOgmiosProvider();
    const results = await provider.evaluateTx('tx-hex');

    expect(results[0].tag).toBe('SPEND');
    expect(results[1].tag).toBe('REWARD');
    expect(results[2].tag).toBe('MINT');
  });

  it('handles empty result set', async () => {
    mockInvoke.mockResolvedValueOnce(JSON.stringify({
      jsonrpc: '2.0',
      result: {},
    }));

    const { getOgmiosProvider } = await import('../providers');
    const provider = getOgmiosProvider();
    const results = await provider.evaluateTx('tx-hex');

    expect(results).toEqual([]);
  });

  it('throws on Ogmios error response', async () => {
    mockInvoke.mockResolvedValueOnce(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Script failure' },
    }));

    const { getOgmiosProvider } = await import('../providers');
    const provider = getOgmiosProvider();

    await expect(provider.evaluateTx('tx-hex')).rejects.toThrow('Script failure');
  });

  it('throws on IPC error', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Ogmios POST request failed'));

    const { getOgmiosProvider } = await import('../providers');
    const provider = getOgmiosProvider();

    await expect(provider.evaluateTx('tx-hex')).rejects.toThrow('Ogmios POST request failed');
  });
});

describe('IpcOgmiosProvider.submitTx', () => {
  it('sends submitTransaction JSON-RPC via ogmios_post', async () => {
    mockInvoke.mockResolvedValueOnce(JSON.stringify({
      jsonrpc: '2.0',
      result: { transaction: { id: 'abc123' } },
    }));

    const { getOgmiosProvider } = await import('../providers');
    const provider = getOgmiosProvider();
    const txHash = await provider.submitTx('tx-hex');

    expect(mockInvoke).toHaveBeenCalledWith('ogmios_post', {
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'submitTransaction',
        params: { transaction: { cbor: 'tx-hex' } },
        id: null,
      }),
    });

    expect(txHash).toBe('abc123');
  });

  it('throws on unexpected submit response', async () => {
    mockInvoke.mockResolvedValueOnce(JSON.stringify({
      jsonrpc: '2.0',
      result: {},
    }));

    const { getOgmiosProvider } = await import('../providers');
    const provider = getOgmiosProvider();

    await expect(provider.submitTx('tx-hex')).rejects.toThrow('unexpected response');
  });

  it('throws on Ogmios error response', async () => {
    mockInvoke.mockResolvedValueOnce(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Already submitted' },
    }));

    const { getOgmiosProvider } = await import('../providers');
    const provider = getOgmiosProvider();

    await expect(provider.submitTx('tx-hex')).rejects.toThrow('Already submitted');
  });
});
