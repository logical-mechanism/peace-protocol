/**
 * Tests for encryptions service (getAllEncryptions, getEncryptionsByUser,
 * getEncryptionsByStatus, getEncryptionLevels, parseCip20Fields).
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
      _store: store,
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
  getAllEncryptions,
  getEncryptionByToken,
  getEncryptionsByUser,
  getEncryptionsByStatus,
  getEncryptionLevels,
  parseCip20Fields,
  extractCip20FromMetadata,
} from '../encryptions.js';

// ── Plutus JSON builders ─────────────────────────────────────────────

const G1_HEX = 'aa'.repeat(48);
const G2_HEX = 'bb'.repeat(96);
const VKH_HEX = 'cc'.repeat(28);
const TOKEN_HEX = 'dd'.repeat(32);
const NONCE_HEX = 'ee'.repeat(12);
const AAD_HEX = 'ff'.repeat(32);
const CT_HEX = '11'.repeat(64);

function mkRegister(gen = G1_HEX, pub = G1_HEX) {
  return { constructor: 0, fields: [{ bytes: gen }, { bytes: pub }] };
}

function mkHalfLevel(r1b = G1_HEX, r2_g1b = G1_HEX, r4b = G2_HEX) {
  return { constructor: 0, fields: [{ bytes: r1b }, { bytes: r2_g1b }, { bytes: r4b }] };
}

function mkFullLevel(r1b = G1_HEX, r2_g1b = G1_HEX, r2_g2b = G2_HEX, r4b = G2_HEX) {
  return { constructor: 0, fields: [{ bytes: r1b }, { bytes: r2_g1b }, { bytes: r2_g2b }, { bytes: r4b }] };
}

function mkCapsule(nonce = NONCE_HEX, aad = AAD_HEX, ct = CT_HEX) {
  return { constructor: 0, fields: [{ bytes: nonce }, { bytes: aad }, { bytes: ct }] };
}

function mkGrothProof() {
  return {
    constructor: 0,
    fields: [
      { bytes: 'a1'.repeat(48) },
      { bytes: 'b2'.repeat(96) },
      { bytes: 'c3'.repeat(48) },
      { list: [{ bytes: 'd4'.repeat(48) }] },
      { bytes: 'e5'.repeat(48) },
    ],
  };
}

function mkStatusOpen() {
  return { constructor: 0, fields: [] };
}

function mkStatusPending(ttl = 1000) {
  return {
    constructor: 1,
    fields: [mkGrothProof(), { list: [{ int: 42 }, { int: 99 }] }, { int: ttl }],
  };
}

function mkNone() {
  return { constructor: 1, fields: [] };
}

function mkSome(inner: unknown) {
  return { constructor: 0, fields: [inner] };
}

function mkEncryptionDatumValue(overrides: { status?: unknown; fullLevel?: unknown; vkh?: string } = {}) {
  return {
    constructor: 0,
    fields: [
      { bytes: overrides.vkh ?? VKH_HEX },
      mkRegister(),
      { bytes: TOKEN_HEX },
      mkHalfLevel(),
      overrides.fullLevel ?? mkNone(),
      mkCapsule(),
      overrides.status ?? mkStatusOpen(),
    ],
  };
}

function mkKoiosUtxo(overrides: Record<string, unknown> = {}) {
  return {
    tx_hash: 'a'.repeat(64),
    tx_index: 0,
    address: 'addr_test1_seller',
    value: '5000000',
    stake_address: null,
    payment_cred: null,
    epoch_no: 100,
    block_height: 5000,
    block_time: 1718438400,
    datum_hash: null,
    inline_datum: { bytes: '', value: mkEncryptionDatumValue() },
    reference_script: null,
    asset_list: [
      { policy_id: 'encpolicy123', asset_name: 'enctoken01', quantity: '1', decimals: 0, fingerprint: '' },
    ],
    is_spent: false,
    ...overrides,
  };
}

// ── Setup ────────────────────────────────────────────────────────────

let mockKupo: { getAddressUtxos: ReturnType<typeof vi.fn> };
let mockKoios: {
  getTxMetadataBatch: ReturnType<typeof vi.fn>;
  getAssetTxs: ReturnType<typeof vi.fn>;
  getTxInfoBatch: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (apiCache as any)._store.clear();

  mockKupo = { getAddressUtxos: vi.fn().mockResolvedValue([]) };
  mockKoios = {
    getTxMetadataBatch: vi.fn().mockResolvedValue(new Map()),
    getAssetTxs: vi.fn().mockResolvedValue([]),
    getTxInfoBatch: vi.fn().mockResolvedValue([]),
  };

  (getKupoClient as ReturnType<typeof vi.fn>).mockReturnValue(mockKupo);
  (getKoiosClient as ReturnType<typeof vi.fn>).mockReturnValue(mockKoios);
});

// ── parseCip20Fields ─────────────────────────────────────────────────

describe('parseCip20Fields', () => {
  it('parses old flat-array format', () => {
    const result = parseCip20Fields(['My file', '10.5', 'on-chain', 'https://img.png', 'text']);
    expect(result).toEqual({
      description: 'My file',
      suggestedPrice: 10.5,
      storageLayer: 'on-chain',
      imageLink: 'https://img.png',
      category: 'text',
    });
  });

  it('parses new structured format (detected by p key)', () => {
    const fullJson = {
      msg: ['Desc chunk1', 'Desc chunk2'],
      p: '25.0',
      s: 'iagon',
      i: ['https://example.com/', 'image.png'],
      c: 'document',
    };
    const result = parseCip20Fields(fullJson.msg, fullJson);
    expect(result).toEqual({
      description: 'Desc chunk1Desc chunk2',
      suggestedPrice: 25,
      storageLayer: 'iagon',
      imageLink: 'https://example.com/image.png',
      category: 'document',
    });
  });

  it('returns empty description for empty msg chunks', () => {
    const fullJson = { msg: [], p: '5' };
    const result = parseCip20Fields([], fullJson);
    expect(result.description).toBeUndefined();
  });

  it('handles non-numeric price in old format', () => {
    const result = parseCip20Fields(['desc', 'not-a-number']);
    expect(result.suggestedPrice).toBeUndefined();
  });

  it('handles missing optional fields in old format', () => {
    const result = parseCip20Fields(['desc']);
    expect(result.description).toBe('desc');
    expect(result.suggestedPrice).toBeUndefined();
    expect(result.storageLayer).toBeUndefined();
    expect(result.imageLink).toBeUndefined();
    expect(result.category).toBeUndefined();
  });

  it('handles empty strings as undefined', () => {
    const result = parseCip20Fields(['', '', '', '', '']);
    expect(result.description).toBeUndefined();
    expect(result.storageLayer).toBeUndefined();
    expect(result.imageLink).toBeUndefined();
    expect(result.category).toBeUndefined();
  });
});

// ── extractCip20FromMetadata ─────────────────────────────────────────

describe('extractCip20FromMetadata', () => {
  it('extracts structured format from metadata entries', () => {
    const entries = [
      { key: '674', json: { msg: ['hello'], p: '5', s: 'iagon', i: [], c: 'text' } },
    ];
    const result = extractCip20FromMetadata(entries);
    expect(result.description).toBe('hello');
    expect(result.suggestedPrice).toBe(5);
  });

  it('returns empty object for missing 674 key', () => {
    expect(extractCip20FromMetadata([])).toEqual({});
  });

  it('returns empty object for non-object json', () => {
    expect(extractCip20FromMetadata([{ key: '674', json: 'not-an-object' }])).toEqual({});
  });
});

// ── getAllEncryptions ─────────────────────────────────────────────────

describe('getAllEncryptions', () => {
  it('returns parsed encryptions from Kupo UTxOs', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);

    const result = await getAllEncryptions();

    expect(result.data).toHaveLength(1);
    expect(result.data[0].tokenName).toBe('enctoken01');
    expect(result.data[0].sellerPkh).toBe(VKH_HEX);
    expect(result.data[0].status).toBe('active');
    expect(result.warnings).toEqual({});
  });

  it('maps Pending datum status to pending display status', async () => {
    const utxo = mkKoiosUtxo({
      inline_datum: { bytes: '', value: mkEncryptionDatumValue({ status: mkStatusPending() }) },
    });
    mockKupo.getAddressUtxos.mockResolvedValue([utxo]);

    const result = await getAllEncryptions();
    expect(result.data[0].status).toBe('pending');
  });

  it('skips UTxOs without inline datums', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo({ inline_datum: null })]);
    const result = await getAllEncryptions();
    expect(result.data).toHaveLength(0);
  });

  it('skips malformed datums and reports warning', async () => {
    const badUtxo = mkKoiosUtxo({
      inline_datum: { bytes: '', value: { constructor: 0, fields: [{ bytes: 'short' }] } },
    });
    const goodUtxo = mkKoiosUtxo({ tx_hash: 'b'.repeat(64) });
    mockKupo.getAddressUtxos.mockResolvedValue([badUtxo, goodUtxo]);

    const result = await getAllEncryptions();

    expect(result.data).toHaveLength(1);
    expect(result.warnings.skippedDatums).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to parse encryption datum',
      expect.objectContaining({ txHash: 'a'.repeat(64) })
    );
  });

  it('returns encryptions without CIP-20 when Koios fails', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    mockKoios.getTxMetadataBatch.mockRejectedValue(new Error('Koios down'));

    const result = await getAllEncryptions();

    expect(result.data).toHaveLength(1);
    expect(result.data[0].description).toBeUndefined();
  });

  it('enriches with CIP-20 metadata', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    const metaMap = new Map();
    metaMap.set('a'.repeat(64), [{ key: '674', json: { msg: ['My listing'], p: '10', s: 'on-chain', i: [], c: 'text' } }]);
    mockKoios.getTxMetadataBatch.mockResolvedValue(metaMap);

    const result = await getAllEncryptions();
    expect(result.data[0].description).toBe('My listing');
    expect(result.data[0].suggestedPrice).toBe(10);
  });

  it('returns cached data on cache hit', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    await getAllEncryptions();
    vi.clearAllMocks();

    const result = await getAllEncryptions();
    expect(result.data).toHaveLength(1);
    expect(getKupoClient).not.toHaveBeenCalled();
  });

  it('bypasses cache when skipCache is true', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    await getAllEncryptions();

    mockKupo.getAddressUtxos.mockResolvedValue([]);
    mockKoios.getTxMetadataBatch.mockResolvedValue(new Map());

    const result = await getAllEncryptions(true);
    expect(result.data).toHaveLength(0);
  });

  it('returns stale cache with stale warning on Kupo failure', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    await getAllEncryptions();

    mockKupo.getAddressUtxos.mockRejectedValue(new Error('Kupo offline'));

    const result = await getAllEncryptions(true);
    expect(result.data).toHaveLength(1);
    expect(result.warnings.stale).toBe(true);
  });

  it('throws when Kupo fails and no stale cache', async () => {
    mockKupo.getAddressUtxos.mockRejectedValue(new Error('Kupo offline'));
    await expect(getAllEncryptions()).rejects.toThrow('Kupo offline');
  });
});

// ── Filter functions ─────────────────────────────────────────────────

describe('getEncryptionByToken', () => {
  it('returns matching encryption', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    const result = await getEncryptionByToken('enctoken01');
    expect(result.data?.tokenName).toBe('enctoken01');
  });

  it('returns null when no match', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    const result = await getEncryptionByToken('nonexistent');
    expect(result.data).toBeNull();
  });
});

describe('getEncryptionsByUser', () => {
  it('filters by sellerPkh (case-insensitive)', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    const result = await getEncryptionsByUser(VKH_HEX.toUpperCase());
    expect(result.data).toHaveLength(1);
  });

  it('returns empty when no match', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    const result = await getEncryptionsByUser('ffffffffffff');
    expect(result.data).toHaveLength(0);
  });
});

describe('getEncryptionsByStatus', () => {
  it('returns active encryptions (Open status)', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    const result = await getEncryptionsByStatus('active');
    expect(result.data).toHaveLength(1);
  });

  it('returns pending encryptions (Pending status)', async () => {
    const utxo = mkKoiosUtxo({
      inline_datum: { bytes: '', value: mkEncryptionDatumValue({ status: mkStatusPending() }) },
    });
    mockKupo.getAddressUtxos.mockResolvedValue([utxo]);
    const result = await getEncryptionsByStatus('pending');
    expect(result.data).toHaveLength(1);
  });

  it('returns empty for completed (no on-chain completed state)', async () => {
    mockKupo.getAddressUtxos.mockResolvedValue([mkKoiosUtxo()]);
    const result = await getEncryptionsByStatus('completed');
    expect(result.data).toHaveLength(0);
  });
});

// ── getEncryptionLevels ──────────────────────────────────────────────

describe('getEncryptionLevels', () => {
  function mkTxInfo(blockHeight: number, datumFields: unknown[]) {
    return {
      tx_hash: blockHeight.toString(16).repeat(32).slice(0, 64),
      block_height: blockHeight,
      outputs: [
        {
          payment_addr: { bech32: 'addr_test1_encryption', cred: '' },
          value: '5000000',
          inline_datum: {
            bytes: '',
            value: { constructor: 0, fields: datumFields },
          },
        },
      ],
    };
  }

  it('throws when no transactions found', async () => {
    mockKoios.getAssetTxs.mockResolvedValue([]);
    await expect(getEncryptionLevels('sometoken')).rejects.toThrow('No transactions found');
  });

  it('extracts half_level from newest transaction', async () => {
    const r1 = '11'.repeat(48);
    const r2g1 = '22'.repeat(48);
    const r4 = '33'.repeat(96);

    mockKoios.getAssetTxs.mockResolvedValue([{ tx_hash: 'a'.repeat(64) }]);
    mockKoios.getTxInfoBatch.mockResolvedValue([
      mkTxInfo(100, [
        { bytes: VKH_HEX },
        mkRegister(),
        { bytes: TOKEN_HEX },
        mkHalfLevel(r1, r2g1, r4),
        mkNone(),
        mkCapsule(),
        mkStatusOpen(),
      ]),
    ]);

    const levels = await getEncryptionLevels('sometoken');

    expect(levels).toHaveLength(1);
    expect(levels[0].r1).toBe(r1);
    expect(levels[0].r2_g1).toBe(r2g1);
    expect(levels[0].r2_g2).toBeUndefined();
  });

  it('extracts full_level from older transactions', async () => {
    const r1a = '11'.repeat(48);
    const r2g1a = '22'.repeat(48);
    const r4a = '33'.repeat(96);
    const r1b = '44'.repeat(48);
    const r2g1b = '55'.repeat(48);
    const r2g2b = '66'.repeat(96);
    const r4b = '77'.repeat(96);

    mockKoios.getAssetTxs.mockResolvedValue([
      { tx_hash: 'a'.repeat(64) },
      { tx_hash: 'b'.repeat(64) },
    ]);
    mockKoios.getTxInfoBatch.mockResolvedValue([
      // Newest tx (block 200) — half_level extracted
      mkTxInfo(200, [
        { bytes: VKH_HEX },
        mkRegister(),
        { bytes: TOKEN_HEX },
        mkHalfLevel(r1a, r2g1a, r4a),
        mkNone(),
        mkCapsule(),
        mkStatusOpen(),
      ]),
      // Older tx (block 100) — full_level extracted
      mkTxInfo(100, [
        { bytes: VKH_HEX },
        mkRegister(),
        { bytes: TOKEN_HEX },
        mkHalfLevel(),
        mkSome(mkFullLevel(r1b, r2g1b, r2g2b, r4b)),
        mkCapsule(),
        mkStatusOpen(),
      ]),
    ]);

    const levels = await getEncryptionLevels('sometoken');

    // half_level from newest + full_level from older
    expect(levels).toHaveLength(2);
    expect(levels[0].r1).toBe(r1a);
    expect(levels[0].r2_g2).toBeUndefined(); // half level — no r2_g2
    expect(levels[1].r1).toBe(r1b);
    expect(levels[1].r2_g2).toBe(r2g2b); // full level
  });

  it('deduplicates consecutive identical full_levels', async () => {
    const r1 = '44'.repeat(48);
    const r2g1 = '55'.repeat(48);
    const r2g2 = '66'.repeat(96);
    const r4 = '77'.repeat(96);

    mockKoios.getAssetTxs.mockResolvedValue([
      { tx_hash: 'a'.repeat(64) },
      { tx_hash: 'b'.repeat(64) },
    ]);
    mockKoios.getTxInfoBatch.mockResolvedValue([
      mkTxInfo(200, [
        { bytes: VKH_HEX }, mkRegister(), { bytes: TOKEN_HEX },
        mkHalfLevel(r1, r2g1, r4),
        mkSome(mkFullLevel(r1, r2g1, r2g2, r4)),
        mkCapsule(), mkStatusOpen(),
      ]),
      mkTxInfo(100, [
        { bytes: VKH_HEX }, mkRegister(), { bytes: TOKEN_HEX },
        mkHalfLevel(),
        mkSome(mkFullLevel(r1, r2g1, r2g2, r4)), // same full_level as above
        mkCapsule(), mkStatusOpen(),
      ]),
    ]);

    const levels = await getEncryptionLevels('sometoken');

    // half_level + one full_level (duplicate removed)
    expect(levels).toHaveLength(2);
  });

  it('skips outputs not at encryption address', async () => {
    mockKoios.getAssetTxs.mockResolvedValue([{ tx_hash: 'a'.repeat(64) }]);
    mockKoios.getTxInfoBatch.mockResolvedValue([{
      tx_hash: 'a'.repeat(64),
      block_height: 100,
      outputs: [{
        payment_addr: { bech32: 'addr_test1_other_address', cred: '' },
        value: '5000000',
        inline_datum: { bytes: '', value: mkEncryptionDatumValue() },
      }],
    }]);

    const levels = await getEncryptionLevels('sometoken');
    expect(levels).toHaveLength(0);
  });

  it('skips outputs without inline datums', async () => {
    mockKoios.getAssetTxs.mockResolvedValue([{ tx_hash: 'a'.repeat(64) }]);
    mockKoios.getTxInfoBatch.mockResolvedValue([{
      tx_hash: 'a'.repeat(64),
      block_height: 100,
      outputs: [{
        payment_addr: { bech32: 'addr_test1_encryption', cred: '' },
        value: '5000000',
        inline_datum: null,
      }],
    }]);

    const levels = await getEncryptionLevels('sometoken');
    expect(levels).toHaveLength(0);
  });

  it('logs warning on half_level parse failure', async () => {
    mockKoios.getAssetTxs.mockResolvedValue([{ tx_hash: 'a'.repeat(64) }]);
    mockKoios.getTxInfoBatch.mockResolvedValue([{
      tx_hash: 'a'.repeat(64),
      block_height: 100,
      outputs: [{
        payment_addr: { bech32: 'addr_test1_encryption', cred: '' },
        value: '5000000',
        inline_datum: {
          bytes: '',
          value: {
            constructor: 0,
            fields: [
              { bytes: VKH_HEX }, mkRegister(), { bytes: TOKEN_HEX },
              { bytes: 'broken' }, // invalid half_level
              mkNone(),
              mkCapsule(), mkStatusOpen(),
            ],
          },
        },
      }],
    }]);

    const levels = await getEncryptionLevels('sometoken');
    expect(levels).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to parse half_level',
      expect.objectContaining({ txHash: 'a'.repeat(64) })
    );
  });
});
