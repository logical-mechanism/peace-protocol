import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('../../config/index.js', () => ({
  getNetworkConfig: () => ({
    koiosUrl: 'https://preprod.koios.rest/api/v1',
    koiosToken: 'test-token',
  }),
}));

const mockFetchWithRetry = vi.fn();
vi.mock('../fetchWithRetry.js', () => ({
  fetchWithRetry: (...args: unknown[]) => mockFetchWithRetry(...args),
}));

const mockExecute = vi.fn();
vi.mock('../circuitBreaker.js', () => ({
  CircuitBreaker: vi.fn().mockImplementation(() => ({
    execute: (fn: () => Promise<unknown>) => mockExecute(fn),
    currentState: 'CLOSED',
    consecutiveFailures: 0,
  })),
}));

import { getKoiosClient } from '../koios.js';

// ── Helpers ─────────────────────────────────────────────────────────

function mockJsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Make circuit breaker pass through to the actual function
  mockExecute.mockImplementation((fn: () => Promise<unknown>) => fn());
});

// ── Tests ───────────────────────────────────────────────────────────

describe('KoiosClient', () => {
  describe('request headers', () => {
    it('includes Authorization header when token is set', async () => {
      const client = getKoiosClient();
      mockFetchWithRetry.mockResolvedValueOnce(mockJsonResponse([]));
      await client.getAddressUtxos('addr1test');

      const [, options] = mockFetchWithRetry.mock.calls[0];
      expect(options.headers['Authorization']).toBe('Bearer test-token');
      expect(options.headers['Content-Type']).toBe('application/json');
    });
  });

  describe('getAddressUtxos', () => {
    it('posts to /address_utxos with correct body', async () => {
      const client = getKoiosClient();
      const utxos = [{ tx_hash: 'abc', tx_index: 0 }];
      mockFetchWithRetry.mockResolvedValueOnce(mockJsonResponse(utxos));

      const result = await client.getAddressUtxos('addr1test');

      const [url, options] = mockFetchWithRetry.mock.calls[0];
      expect(url).toBe('https://preprod.koios.rest/api/v1/address_utxos');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({
        _addresses: ['addr1test'],
        _extended: true,
      });
      expect(result).toEqual(utxos);
    });
  });

  describe('getAssetUtxos', () => {
    it('posts to /asset_utxos with policy and asset name', async () => {
      const client = getKoiosClient();
      mockFetchWithRetry.mockResolvedValueOnce(mockJsonResponse([]));

      await client.getAssetUtxos('policy123', 'asset456');

      const body = JSON.parse(mockFetchWithRetry.mock.calls[0][1].body);
      expect(body).toEqual({
        _asset_list: [['policy123', 'asset456']],
        _extended: true,
      });
    });

    it('defaults asset name to empty string', async () => {
      const client = getKoiosClient();
      mockFetchWithRetry.mockResolvedValueOnce(mockJsonResponse([]));

      await client.getAssetUtxos('policy123');

      const body = JSON.parse(mockFetchWithRetry.mock.calls[0][1].body);
      expect(body._asset_list[0][1]).toBe('');
    });
  });

  describe('getTxInfo', () => {
    it('returns the first tx info result', async () => {
      const client = getKoiosClient();
      const txInfo = { tx_hash: 'abc', block_height: 100, outputs: [] };
      mockFetchWithRetry.mockResolvedValueOnce(mockJsonResponse([txInfo]));

      const result = await client.getTxInfo('abc');
      expect(result).toEqual(txInfo);
    });

    it('throws when transaction not found', async () => {
      const client = getKoiosClient();
      mockFetchWithRetry.mockResolvedValueOnce(mockJsonResponse([]));

      await expect(client.getTxInfo('missing')).rejects.toThrow('Transaction not found');
    });
  });

  describe('getTxMetadata', () => {
    it('converts object metadata to array format', async () => {
      const client = getKoiosClient();
      mockFetchWithRetry.mockResolvedValueOnce(
        mockJsonResponse([{
          tx_hash: 'abc',
          metadata: { '674': { msg: ['hello'] } },
        }]),
      );

      const result = await client.getTxMetadata('abc');
      expect(result).toEqual([{ key: '674', json: { msg: ['hello'] } }]);
    });

    it('returns empty array when no metadata', async () => {
      const client = getKoiosClient();
      mockFetchWithRetry.mockResolvedValueOnce(
        mockJsonResponse([{ tx_hash: 'abc', metadata: null }]),
      );

      const result = await client.getTxMetadata('abc');
      expect(result).toEqual([]);
    });
  });

  describe('getTxMetadataBatch', () => {
    it('returns empty map for empty input', async () => {
      const client = getKoiosClient();
      const result = await client.getTxMetadataBatch([]);
      expect(result.size).toBe(0);
      expect(mockFetchWithRetry).not.toHaveBeenCalled();
    });

    it('maps multiple tx hashes to metadata', async () => {
      const client = getKoiosClient();
      mockFetchWithRetry.mockResolvedValueOnce(
        mockJsonResponse([
          { tx_hash: 'tx1', metadata: { '674': { msg: ['a'] } } },
          { tx_hash: 'tx2', metadata: null },
        ]),
      );

      const result = await client.getTxMetadataBatch(['tx1', 'tx2']);
      expect(result.get('tx1')).toEqual([{ key: '674', json: { msg: ['a'] } }]);
      expect(result.get('tx2')).toEqual([]);
    });
  });

  describe('getAssetTxs', () => {
    it('sends GET request with query params', async () => {
      const client = getKoiosClient();
      mockFetchWithRetry.mockResolvedValueOnce(
        mockJsonResponse([{ tx_hash: 'abc', block_height: 50 }]),
      );

      const result = await client.getAssetTxs('policy1', 'asset1');
      const [url] = mockFetchWithRetry.mock.calls[0];
      expect(url).toContain('/asset_txs?_asset_policy=policy1&_asset_name=asset1&_history=true');
      expect(result).toEqual([{ tx_hash: 'abc', block_height: 50 }]);
    });
  });

  describe('getTxInfoBatch', () => {
    it('returns empty array for empty input', async () => {
      const client = getKoiosClient();
      const result = await client.getTxInfoBatch([]);
      expect(result).toEqual([]);
      expect(mockFetchWithRetry).not.toHaveBeenCalled();
    });

    it('sends batch request with correct flags', async () => {
      const client = getKoiosClient();
      mockFetchWithRetry.mockResolvedValueOnce(mockJsonResponse([]));

      await client.getTxInfoBatch(['tx1', 'tx2']);
      const body = JSON.parse(mockFetchWithRetry.mock.calls[0][1].body);
      expect(body._tx_hashes).toEqual(['tx1', 'tx2']);
      expect(body._inputs).toBe(false);
      expect(body._scripts).toBe(true);
    });
  });

  describe('getTip', () => {
    it('returns the first tip result', async () => {
      const client = getKoiosClient();
      const tip = { block_no: 1000, block_time: 12345, epoch_no: 5, abs_slot: 99 };
      mockFetchWithRetry.mockResolvedValueOnce(mockJsonResponse([tip]));

      const result = await client.getTip();
      expect(result).toEqual(tip);
    });

    it('throws when no tip data returned', async () => {
      const client = getKoiosClient();
      mockFetchWithRetry.mockResolvedValueOnce(mockJsonResponse([]));

      await expect(client.getTip()).rejects.toThrow('No tip data returned');
    });
  });

  describe('getProtocolParams', () => {
    it('returns first epoch params result', async () => {
      const client = getKoiosClient();
      const params = { min_fee_a: 44, min_fee_b: 155381 };
      mockFetchWithRetry.mockResolvedValueOnce(mockJsonResponse([params]));

      const result = await client.getProtocolParams();
      expect(result).toEqual(params);
    });

    it('throws when no params returned', async () => {
      const client = getKoiosClient();
      mockFetchWithRetry.mockResolvedValueOnce(mockJsonResponse([]));

      await expect(client.getProtocolParams()).rejects.toThrow('No protocol parameters returned');
    });
  });

  describe('error handling', () => {
    it('throws on non-200 response', async () => {
      const client = getKoiosClient();
      mockFetchWithRetry.mockResolvedValueOnce(mockJsonResponse('Bad Request', 400));

      await expect(client.getAddressUtxos('addr')).rejects.toThrow('Koios API error: 400');
    });
  });

  describe('circuit breaker', () => {
    it('exposes circuit breaker state', () => {
      const client = getKoiosClient();
      const state = client.getCircuitBreakerState();
      expect(state).toEqual({ state: 'CLOSED', failureCount: 0 });
    });
  });
});
