// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KupoAdapter } from '../kupoAdapter';

const BASE_URL = 'http://127.0.0.1:44203';

let adapter: KupoAdapter;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  adapter = new KupoAdapter(BASE_URL);
  mockFetch = vi.fn();
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function kupoMatch(overrides: Record<string, unknown> = {}) {
  return {
    transaction_index: 0,
    transaction_id: 'aabb00',
    output_index: 0,
    address: 'addr_test1_contract',
    value: { coins: 5_000_000 },
    datum_hash: null,
    datum_type: undefined,
    datum: null,
    script_hash: null,
    created_at: { slot_no: 100, header_hash: '0000' },
    spent_at: null,
    ...overrides,
  };
}

function okResponse(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

function errorResponse(status: number, statusText: string) {
  return { ok: false, status, statusText, json: () => Promise.resolve({}) };
}

describe('KupoAdapter', () => {
  describe('fetchAddressUTxOs', () => {
    it('calls correct Kupo URL with ?unspent&resolve_hashes', async () => {
      mockFetch.mockResolvedValue(okResponse([]));

      await adapter.fetchAddressUTxOs('addr_test1_abc');

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/matches/addr_test1_abc?unspent&resolve_hashes`
      );
    });

    it('converts lovelace to amount array', async () => {
      mockFetch.mockResolvedValue(okResponse([kupoMatch()]));

      const [utxo] = await adapter.fetchAddressUTxOs('addr');
      expect(utxo.output.amount).toEqual([
        { unit: 'lovelace', quantity: '5000000' },
      ]);
    });

    it('converts dot-separated assets to concatenated units', async () => {
      mockFetch.mockResolvedValue(
        okResponse([
          kupoMatch({
            value: {
              coins: 2_000_000,
              assets: { 'abc123.token01': 1 },
            },
          }),
        ])
      );

      const [utxo] = await adapter.fetchAddressUTxOs('addr');
      expect(utxo.output.amount).toContainEqual({
        unit: 'abc123token01',
        quantity: '1',
      });
    });

    it('handles policy-only tokens (no dot separator)', async () => {
      mockFetch.mockResolvedValue(
        okResponse([
          kupoMatch({
            value: { coins: 1_000_000, assets: { policyonly: 5 } },
          }),
        ])
      );

      const [utxo] = await adapter.fetchAddressUTxOs('addr');
      expect(utxo.output.amount).toContainEqual({
        unit: 'policyonly',
        quantity: '5',
      });
    });

    it('filters by asset when provided', async () => {
      mockFetch.mockResolvedValue(
        okResponse([
          kupoMatch({
            value: { coins: 2_000_000, assets: { 'abc.tok1': 1 } },
          }),
          kupoMatch({
            transaction_id: 'other',
            value: { coins: 3_000_000 },
          }),
        ])
      );

      const utxos = await adapter.fetchAddressUTxOs('addr', 'abctok1');
      expect(utxos).toHaveLength(1);
      expect(utxos[0].output.amount).toContainEqual({
        unit: 'abctok1',
        quantity: '1',
      });
    });

    it('returns all UTxOs when no asset filter', async () => {
      mockFetch.mockResolvedValue(
        okResponse([kupoMatch(), kupoMatch({ transaction_id: 'bb' })])
      );

      const utxos = await adapter.fetchAddressUTxOs('addr');
      expect(utxos).toHaveLength(2);
    });

    it('extracts inline datum when datum_type is inline', async () => {
      mockFetch.mockResolvedValue(
        okResponse([
          kupoMatch({ datum_type: 'inline', datum: 'deadbeef' }),
        ])
      );

      const [utxo] = await adapter.fetchAddressUTxOs('addr');
      expect(utxo.output.plutusData).toBe('deadbeef');
    });

    it('does not set plutusData for hash-referenced datums', async () => {
      mockFetch.mockResolvedValue(
        okResponse([
          kupoMatch({ datum_type: 'hash', datum_hash: 'abc123', datum: null }),
        ])
      );

      const [utxo] = await adapter.fetchAddressUTxOs('addr');
      expect(utxo.output.plutusData).toBeUndefined();
      expect(utxo.output.dataHash).toBe('abc123');
    });

    it('fetches script when script_hash is present', async () => {
      mockFetch
        .mockResolvedValueOnce(
          okResponse([kupoMatch({ script_hash: 'script_abc' })])
        )
        .mockResolvedValueOnce(
          okResponse({ script: 'cafebabe', language: 'plutus:v3' })
        );

      const [utxo] = await adapter.fetchAddressUTxOs('addr');
      expect(utxo.output.scriptRef).toBe('cafebabe');
      expect(mockFetch).toHaveBeenCalledWith(`${BASE_URL}/scripts/script_abc`);
    });

    it('throws on HTTP error from Kupo', async () => {
      mockFetch.mockResolvedValue(errorResponse(500, 'Internal Server Error'));

      await expect(adapter.fetchAddressUTxOs('addr')).rejects.toThrow(
        'Kupo query failed'
      );
    });
  });

  describe('fetchUTxOs', () => {
    it('queries by tx hash with wildcard index', async () => {
      mockFetch.mockResolvedValue(okResponse([]));

      await adapter.fetchUTxOs('txhash123');

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/matches/*@txhash123?unspent&resolve_hashes`
      );
    });

    it('queries by tx hash with specific index', async () => {
      mockFetch.mockResolvedValue(okResponse([]));

      await adapter.fetchUTxOs('txhash123', 2);

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/matches/2@txhash123?unspent&resolve_hashes`
      );
    });
  });

  describe('get', () => {
    it('returns JSON response for valid URL', async () => {
      mockFetch.mockResolvedValue(okResponse({ tip: { slot: 42 } }));

      const result = await adapter.get('http://example.com/api');
      expect(result).toEqual({ tip: { slot: 42 } });
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValue(errorResponse(404, 'Not Found'));

      await expect(adapter.get('http://example.com/missing')).rejects.toThrow(
        'HTTP GET failed: 404 Not Found'
      );
    });
  });

  describe('unimplemented IFetcher methods', () => {
    it('fetchAccountInfo throws', async () => {
      await expect(adapter.fetchAccountInfo('addr')).rejects.toThrow(
        'not implemented'
      );
    });

    it('fetchAssetAddresses throws', async () => {
      await expect(adapter.fetchAssetAddresses('asset')).rejects.toThrow(
        'not implemented'
      );
    });

    it('fetchAssetMetadata throws', async () => {
      await expect(adapter.fetchAssetMetadata('asset')).rejects.toThrow(
        'not implemented'
      );
    });

    it('fetchBlockInfo throws', async () => {
      await expect(adapter.fetchBlockInfo('hash')).rejects.toThrow(
        'not implemented'
      );
    });

    it('fetchCollectionAssets throws', async () => {
      await expect(adapter.fetchCollectionAssets('policy')).rejects.toThrow(
        'not implemented'
      );
    });

    it('fetchProtocolParameters throws', async () => {
      await expect(adapter.fetchProtocolParameters(100)).rejects.toThrow(
        'not implemented'
      );
    });

    it('fetchTxInfo throws', async () => {
      await expect(adapter.fetchTxInfo('hash')).rejects.toThrow(
        'not implemented'
      );
    });

    it('fetchGovernanceProposal throws', async () => {
      await expect(adapter.fetchGovernanceProposal('hash', 0)).rejects.toThrow(
        'not implemented'
      );
    });
  });
});
