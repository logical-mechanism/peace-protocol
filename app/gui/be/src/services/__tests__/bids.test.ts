/**
 * Tests for bids service (getAllBids, getBidByToken, getBidsByUser, etc.)
 *
 * Mocks Kupo, Koios, cache, config, and logger to test the service layer in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../kupo.js', () => ({
  getKupoClient: vi.fn(),
}));

vi.mock('../koios.js', () => ({
  getKoiosClient: vi.fn(),
}));

vi.mock('../cache.js', () => {
  const store = new Map<string, { value: unknown; expiresAt: number }>();
  return {
    apiCache: {
      get: vi.fn((key: string) => {
        const entry = store.get(key);
        if (!entry) return undefined;
        if (Date.now() > entry.expiresAt) return undefined;
        return entry.value;
      }),
      getStale: vi.fn((key: string) => store.get(key)?.value),
      set: vi.fn((key: string, value: unknown) => {
        store.set(key, { value, expiresAt: Date.now() + 15_000 });
      }),
      clear: vi.fn(() => store.clear()),
      _store: store, // exposed for test manipulation
    },
  };
});

vi.mock('../../config/index.js', () => ({
  getNetworkConfig: () => ({
    contracts: {
      biddingAddress: 'addr_test1_bidding',
      biddingPolicyId: 'bidpolicy123',
      encryptionAddress: 'addr_test1_encryption',
      encryptionPolicyId: 'encpolicy123',
    },
    koiosUrl: 'https://preprod.koios.rest/api/v1',
    koiosToken: '',
    kupoUrl: 'http://localhost:44203',
  }),
}));

vi.mock('../logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getKupoClient } from '../kupo.js';
import { getKoiosClient } from '../koios.js';
import { apiCache } from '../cache.js';
import { logger } from '../logger.js';
import {
  getAllBids,
  getBidByToken,
  getBidsByUser,
  getBidsByEncryption,
  getBidsByStatus,
  parseBidCip20Fields,
  extractBidCip20FromMetadata,
} from '../bids.js';

// ── Plutus JSON builders (same as parsers.test.ts) ──────────────────

const G1_HEX = 'aa'.repeat(48);
const VKH_HEX = 'cc'.repeat(28);
const TOKEN_HEX = 'dd'.repeat(32);
const POINTER_HEX = 'ab'.repeat(32);

function mkRegister(gen = G1_HEX, pub = G1_HEX) {
  return { constructor: 0, fields: [{ bytes: gen }, { bytes: pub }] };
}

function mkBidDatumValue(overrides: { vkh?: string; pointer?: string; token?: string; locked_until?: number } = {}) {
  return {
    constructor: 0,
    fields: [
      { bytes: overrides.vkh ?? VKH_HEX },
      mkRegister(),
      { bytes: overrides.pointer ?? POINTER_HEX },
      { bytes: overrides.token ?? TOKEN_HEX },
      { int: overrides.locked_until ?? Date.now() + 12 * 60 * 60 * 1000 },
    ],
  };
}

function mkKoiosUtxo(overrides: Record<string, unknown> = {}) {
  return {
    tx_hash: 'a'.repeat(64),
    tx_index: 0,
    address: 'addr_test1_bidder',
    value: '50000000',
    stake_address: null,
    payment_cred: null,
    epoch_no: 100,
    block_height: 5000,
    block_time: 1718438400, // 2024-06-15T10:00:00Z
    datum_hash: null,
    inline_datum: { bytes: '', value: mkBidDatumValue() },
    reference_script: null,
    asset_list: [
      { policy_id: 'bidpolicy123', asset_name: 'bidtoken01', quantity: '1', decimals: 0, fingerprint: '' },
    ],
    is_spent: false,
    ...overrides,
  };
}

// ── Setup ────────────────────────────────────────────────────────────

let mockKupo: { getAddressUtxos: ReturnType<typeof vi.fn> };
let mockKoios: { getTxMetadataBatch: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (apiCache as any)._store.clear();

  mockKupo = { getAddressUtxos: vi.fn().mockResolvedValue([]) };
  mockKoios = { getTxMetadataBatch: vi.fn().mockResolvedValue(new Map()) };

  (getKupoClient as ReturnType<typeof vi.fn>).mockReturnValue(mockKupo);
  (getKoiosClient as ReturnType<typeof vi.fn>).mockReturnValue(mockKoios);
});

// ── parseBidCip20Fields ──────────────────────────────────────────────

describe('parseBidCip20Fields', () => {
  it('parses future price from msg array', () => {
    expect(parseBidCip20Fields(['10.5'])).toEqual({ futurePrice: 10.5 });
  });

  it('returns empty object for empty array', () => {
    expect(parseBidCip20Fields([])).toEqual({});
  });

  it('returns undefined futurePrice for non-numeric string', () => {
    expect(parseBidCip20Fields(['not-a-number'])).toEqual({ futurePrice: undefined });
  });

  it('returns undefined futurePrice for empty string', () => {
    expect(parseBidCip20Fields([''])).toEqual({ futurePrice: undefined });
  });
});

// ── extractBidCip20FromMetadata ──────────────────────────────────────

describe('extractBidCip20FromMetadata', () => {
  it('extracts futurePrice from CIP-20 metadata entry', () => {
    const entries = [{ key: '674', json: { msg: ['25.0'] } }];
    expect(extractBidCip20FromMetadata(entries)).toEqual({ futurePrice: 25 });
  });

  it('returns empty object when no 674 key', () => {
    expect(extractBidCip20FromMetadata([{ key: '0', json: {} }])).toEqual({});
  });

  it('returns empty object when json is null', () => {
    expect(extractBidCip20FromMetadata([{ key: '674', json: null }])).toEqual({});
  });

  it('returns empty object when msg is missing', () => {
    expect(extractBidCip20FromMetadata([{ key: '674', json: { other: 'data' } }])).toEqual({});
  });
});

// ── getAllBids ────────────────────────────────────────────────────────

describe('getAllBids', () => {
  it('returns parsed bids from Kupo UTxOs', async () => {
    const utxo = mkKoiosUtxo();
    mockKupo.getAddressUtxos.mockResolvedValue([utxo]);

    const result = await getAllBids();

    expect(result.data).toHaveLength(1);
    expect(result.data[0].tokenName).toBe('bidtoken01');
    expect(result.data[0].bidderPkh).toBe(VKH_HEX);
    expect(result.data[0].encryptionToken).toBe(TOKEN_HEX);
    expect(result.data[0].amount).toBe(50_000_000);
    expect(result.data[0].status).toBe('pending');
    expect(result.warnings).toEqual({});
  });

  it('skips UTxOs without inline datums', async () => {
    const utxo = mkKoiosUtxo({ inline_datum: null });
    mockKupo.getAddressUtxos.mockResolvedValue([utxo]);

    const result = await getAllBids();
    expect(result.data).toHaveLength(0);
  });

  it('skips malformed datums and reports warning', async () => {
    const badUtxo = mkKoiosUtxo({
      inline_datum: { bytes: '', value: { constructor: 0, fields: [{ bytes: 'too_short' }] } },
    });
    const goodUtxo = mkKoiosUtxo({ tx_hash: 'b'.repeat(64) });
    mockKupo.getAddressUtxos.mockResolvedValue([badUtxo, goodUtxo]);

    const result = await getAllBids();

    expect(result.data).toHaveLength(1);
    expect(result.warnings.skippedDatums).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to parse bid datum',
      expect.objectContaining({ txHash: 'a'.repeat(64) })
    );
  });

  it('returns bids without CIP-20 fields when Koios metadata fails', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    mockKoios.getTxMetadataBatch.mockRejectedValue(new Error('Koios down'));

    const result = await getAllBids();

    expect(result.data).toHaveLength(1);
    expect(result.data[0].futurePrice).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to batch fetch bid CIP-20 metadata',
      expect.any(Object)
    );
  });

  it('enriches bids with CIP-20 metadata', async () => {
    const utxo = mkKoiosUtxo();
    mockKupo.getAddressUtxos.mockResolvedValue([utxo]);

    const metaMap = new Map();
    metaMap.set('a'.repeat(64), [{ key: '674', json: { msg: ['15.5'] } }]);
    mockKoios.getTxMetadataBatch.mockResolvedValue(metaMap);

    const result = await getAllBids();

    expect(result.data[0].futurePrice).toBe(15.5);
  });

  it('returns cached data when cache is fresh', async () => {
    // Prime cache via a real fetch
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    await getAllBids();
    vi.clearAllMocks();

    // Second call should hit cache
    const result = await getAllBids();
    expect(result.data).toHaveLength(1);
    expect(getKupoClient).not.toHaveBeenCalled();
  });

  it('bypasses cache when skipCache is true', async () => {
    // Prime cache
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    await getAllBids();

    // Re-setup mocks for second call
    mockKupo.getAddressUtxos.mockResolvedValue([]);
    mockKoios.getTxMetadataBatch.mockResolvedValue(new Map());

    const result = await getAllBids(true);
    expect(result.data).toHaveLength(0);
  });

  it('returns stale cache with stale warning when Kupo fails', async () => {
    // Prime cache
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    await getAllBids();

    // Now make Kupo fail
    mockKupo.getAddressUtxos.mockRejectedValue(new Error('Kupo offline'));

    const result = await getAllBids(true);
    expect(result.data).toHaveLength(1);
    expect(result.warnings.stale).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      'Returning stale cache for bids',
      expect.any(Object)
    );
  });

  it('throws when Kupo fails and no stale cache exists', async () => {
    mockKupo.getAddressUtxos.mockRejectedValue(new Error('Kupo offline'));

    await expect(getAllBids()).rejects.toThrow('Kupo offline');
  });

  it('uses datum.pointer as tokenName when asset_list has no match', async () => {
    const utxo = mkKoiosUtxo({ asset_list: [] });
    mockKupo.getAddressUtxos.mockResolvedValue([utxo]);

    const result = await getAllBids();
    expect(result.data[0].tokenName).toBe(POINTER_HEX);
  });
});

// ── Filter functions ─────────────────────────────────────────────────

describe('getBidByToken', () => {
  it('returns matching bid', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    const result = await getBidByToken('bidtoken01');
    expect(result.data?.tokenName).toBe('bidtoken01');
  });

  it('returns null when no match', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    const result = await getBidByToken('nonexistent');
    expect(result.data).toBeNull();
  });
});

describe('getBidsByUser', () => {
  it('filters by bidderPkh (case-insensitive)', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    // VKH_HEX is all lowercase cc... — search uppercase
    const result = await getBidsByUser(VKH_HEX.toUpperCase());
    expect(result.data).toHaveLength(1);
  });

  it('returns empty when no match', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    const result = await getBidsByUser('ffffffffffffffff');
    expect(result.data).toHaveLength(0);
  });
});

describe('getBidsByEncryption', () => {
  it('filters by encryptionToken', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    const result = await getBidsByEncryption(TOKEN_HEX);
    expect(result.data).toHaveLength(1);
  });

  it('returns empty for unmatched token', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    const result = await getBidsByEncryption('00'.repeat(32));
    expect(result.data).toHaveLength(0);
  });
});

describe('getBidsByStatus', () => {
  it('returns all bids for pending status (all on-chain bids are pending)', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    const result = await getBidsByStatus('pending');
    expect(result.data).toHaveLength(1);
  });

  it('returns empty for non-pending status', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    const result = await getBidsByStatus('accepted');
    expect(result.data).toHaveLength(0);
  });
});
