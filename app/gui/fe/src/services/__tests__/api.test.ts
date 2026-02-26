// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiCache } from '../apiCache';

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  globalThis.fetch = mockFetch;
  apiCache.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function okResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  };
}

function errorResponse(status: number, body: unknown) {
  return {
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve(body),
  };
}

// Dynamic import so the module picks up the mocked fetch
async function loadApi() {
  // Reset module cache so API_URL constant is re-evaluated
  const mod = await import('../api');
  return mod;
}

describe('encryptionsApi', () => {
  it('getAll calls /api/encryptions and returns data array', async () => {
    mockFetch.mockResolvedValue(okResponse({ data: [{ tokenName: 'tk1' }] }));
    const { encryptionsApi } = await loadApi();

    const result = await encryptionsApi.getAll();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/encryptions'),
      expect.any(Object)
    );
    expect(result).toEqual([{ tokenName: 'tk1' }]);
  });

  it('getByToken calls /api/encryptions/:tokenName', async () => {
    mockFetch.mockResolvedValue(okResponse({ data: { tokenName: 'abc' } }));
    const { encryptionsApi } = await loadApi();

    const result = await encryptionsApi.getByToken('abc');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/encryptions/abc'),
      expect.any(Object)
    );
    expect(result.tokenName).toBe('abc');
  });

  it('getByUser calls /api/encryptions/user/:pkh', async () => {
    mockFetch.mockResolvedValue(okResponse({ data: [] }));
    const { encryptionsApi } = await loadApi();

    await encryptionsApi.getByUser('aabb');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/encryptions/user/aabb'),
      expect.any(Object)
    );
  });

  it('getByStatus calls /api/encryptions/status/:status', async () => {
    mockFetch.mockResolvedValue(okResponse({ data: [] }));
    const { encryptionsApi } = await loadApi();

    await encryptionsApi.getByStatus('active');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/encryptions/status/active'),
      expect.any(Object)
    );
  });

  it('getLevels calls /api/encryptions/:tokenName/levels', async () => {
    mockFetch.mockResolvedValue(okResponse({ data: [] }));
    const { encryptionsApi } = await loadApi();

    await encryptionsApi.getLevels('tok1');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/encryptions/tok1/levels'),
      expect.any(Object)
    );
  });
});

describe('bidsApi', () => {
  it('getAll calls /api/bids', async () => {
    mockFetch.mockResolvedValue(okResponse({ data: [] }));
    const { bidsApi } = await loadApi();

    await bidsApi.getAll();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/bids'),
      expect.any(Object)
    );
  });

  it('getByToken calls /api/bids/:tokenName', async () => {
    mockFetch.mockResolvedValue(okResponse({ data: { tokenName: 'bid1' } }));
    const { bidsApi } = await loadApi();

    const result = await bidsApi.getByToken('bid1');
    expect(result.tokenName).toBe('bid1');
  });

  it('getByUser calls /api/bids/user/:pkh', async () => {
    mockFetch.mockResolvedValue(okResponse({ data: [] }));
    const { bidsApi } = await loadApi();

    await bidsApi.getByUser('cc11');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/bids/user/cc11'),
      expect.any(Object)
    );
  });

  it('getByEncryption calls /api/bids/encryption/:token', async () => {
    mockFetch.mockResolvedValue(okResponse({ data: [] }));
    const { bidsApi } = await loadApi();

    await bidsApi.getByEncryption('enc_tok');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/bids/encryption/enc_tok'),
      expect.any(Object)
    );
  });

  it('getByStatus calls /api/bids/status/:status', async () => {
    mockFetch.mockResolvedValue(okResponse({ data: [] }));
    const { bidsApi } = await loadApi();

    await bidsApi.getByStatus('pending');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/bids/status/pending'),
      expect.any(Object)
    );
  });
});

describe('protocolApi', () => {
  it('getConfig calls /api/protocol/config', async () => {
    mockFetch.mockResolvedValue(okResponse({ data: { network: 'preprod' } }));
    const { protocolApi } = await loadApi();

    const result = await protocolApi.getConfig();
    expect(result.network).toBe('preprod');
  });

  it('getReferenceScripts calls /api/protocol/reference', async () => {
    mockFetch.mockResolvedValue(okResponse({ data: {} }));
    const { protocolApi } = await loadApi();

    await protocolApi.getReferenceScripts();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/protocol/reference'),
      expect.any(Object)
    );
  });

  it('getScripts calls /api/protocol/scripts', async () => {
    mockFetch.mockResolvedValue(okResponse({ data: {} }));
    const { protocolApi } = await loadApi();

    await protocolApi.getScripts();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/protocol/scripts'),
      expect.any(Object)
    );
  });

  it('getParams calls /api/protocol/params', async () => {
    mockFetch.mockResolvedValue(okResponse({ data: {} }));
    const { protocolApi } = await loadApi();

    await protocolApi.getParams();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/protocol/params'),
      expect.any(Object)
    );
  });
});

describe('chainApi', () => {
  it('getConfirmations calls /api/chain/confirmations/:txHash', async () => {
    mockFetch.mockResolvedValue(
      okResponse({ data: { confirmations: 42 } })
    );
    const { chainApi } = await loadApi();

    const result = await chainApi.getConfirmations('tx_abc');
    expect(result.confirmations).toBe(42);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/chain/confirmations/tx_abc'),
      expect.any(Object)
    );
  });
});

describe('checkHealth', () => {
  it('calls /health and returns response directly', async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        status: 'healthy',
        uptimeSeconds: 42,
        kupo: { reachable: true, latencyMs: 10, lastSuccess: '2025-01-01T00:00:00.000Z' },
        koios: { reachable: true, latencyMs: 20, lastSuccess: '2025-01-01T00:00:00.000Z' },
        network: 'preprod',
        useStubs: false,
        timestamp: '2025-01-01',
      })
    );
    const { checkHealth } = await loadApi();

    const result = await checkHealth();
    expect(result.status).toBe('healthy');
    expect(result.uptimeSeconds).toBe(42);
    expect(result.kupo.reachable).toBe(true);
    expect(result.koios.reachable).toBe(true);
  });
});

describe('error handling', () => {
  it('throws with error message from API error response', async () => {
    mockFetch.mockResolvedValue(
      errorResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'Something broke' } })
    );
    const { encryptionsApi } = await loadApi();

    await expect(encryptionsApi.getAll()).rejects.toThrow('Something broke');
  });

  it('throws with statusText when error body is unparseable', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.reject(new Error('bad json')),
    });
    const { encryptionsApi } = await loadApi();

    await expect(encryptionsApi.getAll()).rejects.toThrow('Internal Server Error');
  });

  it('throws with fallback when error body has no message', async () => {
    mockFetch.mockResolvedValue(errorResponse(400, {}));
    const { encryptionsApi } = await loadApi();

    await expect(encryptionsApi.getAll()).rejects.toThrow('API request failed');
  });
});
