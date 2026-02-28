import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────

const mockEvaluateTx = vi.fn();

vi.mock('@meshsdk/provider', () => ({
  OgmiosProvider: class MockOgmiosProvider {
    url: string;
    constructor(url: string) {
      this.url = url;
    }
    async evaluateTx(tx: string) {
      return mockEvaluateTx(tx);
    }
  },
}));

vi.mock('../kupoAdapter', () => ({
  KupoAdapter: class MockKupoAdapter {
    url: string;
    constructor(url: string) {
      this.url = url;
    }
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────

describe('getKupoAdapter', () => {
  it('returns a KupoAdapter instance', async () => {
    // Dynamic import to get fresh module per test group
    const { getKupoAdapter } = await import('../providers');
    const adapter = getKupoAdapter();
    expect(adapter).toBeDefined();
    expect((adapter as unknown as { url: string }).url).toBe('http://127.0.0.1:1442');
  });

  it('returns the same instance on repeated calls (singleton)', async () => {
    const { getKupoAdapter } = await import('../providers');
    const adapter1 = getKupoAdapter();
    const adapter2 = getKupoAdapter();
    expect(adapter1).toBe(adapter2);
  });
});

describe('getOgmiosProvider', () => {
  it('returns a FixedOgmiosProvider instance', async () => {
    const { getOgmiosProvider } = await import('../providers');
    const provider = getOgmiosProvider();
    expect(provider).toBeDefined();
    expect((provider as unknown as { url: string }).url).toBe('ws://127.0.0.1:1337');
  });

  it('returns the same instance on repeated calls (singleton)', async () => {
    const { getOgmiosProvider } = await import('../providers');
    const provider1 = getOgmiosProvider();
    const provider2 = getOgmiosProvider();
    expect(provider1).toBe(provider2);
  });
});

describe('FixedOgmiosProvider.evaluateTx', () => {
  it('remaps WITHDRAW tag to REWARD', async () => {
    mockEvaluateTx.mockResolvedValueOnce([
      { tag: 'WITHDRAW', index: 0, budget: { mem: 100, steps: 200 } },
    ]);

    const { getOgmiosProvider } = await import('../providers');
    const provider = getOgmiosProvider();
    const results = await provider.evaluateTx('tx-hex');

    expect(results).toHaveLength(1);
    expect(results[0].tag).toBe('REWARD');
    expect(results[0].index).toBe(0);
    expect(results[0].budget).toEqual({ mem: 100, steps: 200 });
  });

  it('passes non-WITHDRAW tags through unchanged', async () => {
    mockEvaluateTx.mockResolvedValueOnce([
      { tag: 'SPEND', index: 0, budget: { mem: 50, steps: 100 } },
      { tag: 'MINT', index: 1, budget: { mem: 60, steps: 110 } },
    ]);

    const { getOgmiosProvider } = await import('../providers');
    const provider = getOgmiosProvider();
    const results = await provider.evaluateTx('tx-hex');

    expect(results[0].tag).toBe('SPEND');
    expect(results[1].tag).toBe('MINT');
  });

  it('handles mixed tags — only WITHDRAW is remapped', async () => {
    mockEvaluateTx.mockResolvedValueOnce([
      { tag: 'SPEND', index: 0, budget: { mem: 10, steps: 20 } },
      { tag: 'WITHDRAW', index: 1, budget: { mem: 30, steps: 40 } },
      { tag: 'MINT', index: 2, budget: { mem: 50, steps: 60 } },
    ]);

    const { getOgmiosProvider } = await import('../providers');
    const provider = getOgmiosProvider();
    const results = await provider.evaluateTx('tx-hex');

    expect(results[0].tag).toBe('SPEND');
    expect(results[1].tag).toBe('REWARD');
    expect(results[2].tag).toBe('MINT');
  });

  it('handles empty result set', async () => {
    mockEvaluateTx.mockResolvedValueOnce([]);

    const { getOgmiosProvider } = await import('../providers');
    const provider = getOgmiosProvider();
    const results = await provider.evaluateTx('tx-hex');

    expect(results).toEqual([]);
  });

  it('propagates errors from parent evaluateTx', async () => {
    mockEvaluateTx.mockRejectedValueOnce(new Error('Ogmios connection failed'));

    const { getOgmiosProvider } = await import('../providers');
    const provider = getOgmiosProvider();

    await expect(provider.evaluateTx('tx-hex')).rejects.toThrow('Ogmios connection failed');
  });
});
