import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { clearTxBlockHeightCache } from '../../routes/chain.js';
import { apiCache } from '../../services/cache.js';

const mockKoiosClient = {
  getTxInfo: vi.fn(),
  getTip: vi.fn(),
  getProtocolParams: vi.fn(),
  getCredentialTxs: vi.fn(),
  getAddressTxs: vi.fn(),
  getTxInfoWithAssets: vi.fn(),
};

vi.mock('../../services/koios.js', () => ({
  getKoiosClient: () => mockKoiosClient,
}));

vi.mock('../../config/index.js', () => ({
  config: {
    useStubs: false,
    network: 'preprod',
    nodeEnv: 'test',
    cors: { origins: ['*'] },
  },
  getNetworkConfig: vi.fn(() => ({
    contracts: {
      encryptionAddress: 'addr_test_encryption',
      biddingAddress: 'addr_test_bidding',
      encryptionPolicyId: 'enc_policy',
      biddingPolicyId: 'bid_policy',
    },
  })),
}));

vi.mock('../../stubs/index.js', () => ({
  STUB_ENCRYPTIONS: [],
  STUB_BIDS: [],
  STUB_PROTOCOL_CONFIG: {},
}));

vi.mock('../../services/encryptions.js', () => ({
  getAllEncryptions: vi.fn(),
  getEncryptionByToken: vi.fn(),
  getEncryptionsByUser: vi.fn(),
  getEncryptionsByStatus: vi.fn(),
  getEncryptionLevels: vi.fn(),
}));

vi.mock('../../services/bids.js', () => ({
  getAllBids: vi.fn(),
  getBidByToken: vi.fn(),
  getBidsByUser: vi.fn(),
  getBidsByEncryption: vi.fn(),
  getBidsByStatus: vi.fn(),
}));

vi.mock('../../services/kupo.js', () => ({
  getKupoClient: vi.fn(() => ({ getAddressUtxos: vi.fn() })),
}));

const app = createApp();

beforeEach(() => {
  vi.clearAllMocks();
  clearTxBlockHeightCache();
  apiCache.clear();
});

describe('GET /api/chain/confirmations/:txHash', () => {
  const validTxHash = 'a'.repeat(64);

  it('returns confirmation count, blockHeight, and status for confirmed tx', async () => {
    mockKoiosClient.getTxInfo.mockResolvedValue({ block_height: 100 });
    mockKoiosClient.getTip.mockResolvedValue({ block_no: 120 });

    const res = await request(app).get(`/api/chain/confirmations/${validTxHash}`);

    expect(res.status).toBe(200);
    expect(res.body.data.confirmations).toBe(20);
    expect(res.body.data.blockHeight).toBe(100);
    expect(res.body.data.status).toBe('confirmed');
  });

  it('returns 0 confirmations with pending status when tx not found', async () => {
    mockKoiosClient.getTxInfo.mockRejectedValue(new Error('not found'));
    mockKoiosClient.getTip.mockResolvedValue({ block_no: 120 });

    const res = await request(app).get(`/api/chain/confirmations/${validTxHash}`);

    expect(res.status).toBe(200);
    expect(res.body.data.confirmations).toBe(0);
    expect(res.body.data.status).toBe('pending');
  });

  it('returns 0 with pending status when block_height is not a number', async () => {
    mockKoiosClient.getTxInfo.mockResolvedValue({ block_height: null });
    mockKoiosClient.getTip.mockResolvedValue({ block_no: 120 });

    const res = await request(app).get(`/api/chain/confirmations/${validTxHash}`);

    expect(res.status).toBe(200);
    expect(res.body.data.confirmations).toBe(0);
    expect(res.body.data.status).toBe('pending');
  });

  it('returns 400 for invalid tx hash (too short)', async () => {
    const res = await request(app).get('/api/chain/confirmations/abc');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAM');
  });

  it('returns 400 for invalid tx hash (too long)', async () => {
    const res = await request(app).get(`/api/chain/confirmations/${'a'.repeat(65)}`);

    expect(res.status).toBe(400);
  });

  it('returns confirmations as 0 (never negative) when tip is behind', async () => {
    mockKoiosClient.getTxInfo.mockResolvedValue({ block_height: 120 });
    mockKoiosClient.getTip.mockResolvedValue({ block_no: 100 });

    const res = await request(app).get(`/api/chain/confirmations/${validTxHash}`);

    expect(res.status).toBe(200);
    expect(res.body.data.confirmations).toBe(0);
    expect(res.body.data.status).toBe('confirmed');
  });

  it('returns pending when tx lookup fails (Koios unreachable)', async () => {
    mockKoiosClient.getTxInfo.mockRejectedValue(new Error('network error'));

    const res = await request(app).get(`/api/chain/confirmations/${validTxHash}`);

    // When getTxInfo fails, the tx is treated as pending (not yet on-chain)
    expect(res.status).toBe(200);
    expect(res.body.data.confirmations).toBe(0);
    expect(res.body.data.status).toBe('pending');
  });

  it('returns 503 when confirmed tx tip lookup fails without tipHeight param', async () => {
    // First call: tx is found and cached with block_height=100
    mockKoiosClient.getTxInfo.mockResolvedValueOnce({ block_height: 100 });
    mockKoiosClient.getTip.mockRejectedValueOnce(new Error('network error'));

    const res = await request(app).get(`/api/chain/confirmations/${validTxHash}`);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('TIP_UNAVAILABLE');
  });
});

describe('GET /api/chain/activity/:pkh', () => {
  const userPkh = 'a'.repeat(56);
  const otherPkh = 'b'.repeat(56);

  it('returns 400 for an invalid pkh', async () => {
    const res = await request(app).get('/api/chain/activity/short');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAM');
  });

  it('returns empty array when user has no credential txs', async () => {
    mockKoiosClient.getCredentialTxs.mockResolvedValue([]);
    mockKoiosClient.getAddressTxs.mockResolvedValue([]);

    const res = await request(app).get(`/api/chain/activity/${userPkh}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('classifies a tx with user in inputs as send and records counterparty + net amount', async () => {
    mockKoiosClient.getCredentialTxs.mockResolvedValue([
      { tx_hash: 'c'.repeat(64), block_height: 100, block_time: 1700000000 },
    ]);
    mockKoiosClient.getAddressTxs.mockResolvedValue([]);
    mockKoiosClient.getTxInfoWithAssets.mockResolvedValue([
      {
        tx_hash: 'c'.repeat(64),
        block_height: 100,
        block_time: 1700000000,
        inputs: [
          { tx_hash: 'd'.repeat(64), tx_index: 0, payment_addr: { cred: userPkh }, value: '5000000' },
        ],
        outputs: [
          { payment_addr: { bech32: 'addr_other', cred: otherPkh }, value: '3000000', inline_datum: null },
          { payment_addr: { bech32: 'addr_user', cred: userPkh }, value: '1800000', inline_datum: null },
        ],
      },
    ]);

    const res = await request(app).get(`/api/chain/activity/${userPkh}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      type: 'send',
      counterparty: otherPkh,
      // |outputs - inputs| = |1.8M - 5M| = 3.2M
      amountLovelace: 3_200_000,
      confirmedAtBlock: 100,
      status: 'confirmed',
    });
  });

  it('classifies a tx with user only in outputs as receive', async () => {
    mockKoiosClient.getCredentialTxs.mockResolvedValue([
      { tx_hash: 'e'.repeat(64), block_height: 200, block_time: 1700000000 },
    ]);
    mockKoiosClient.getAddressTxs.mockResolvedValue([]);
    mockKoiosClient.getTxInfoWithAssets.mockResolvedValue([
      {
        tx_hash: 'e'.repeat(64),
        block_height: 200,
        block_time: 1700000000,
        inputs: [
          { tx_hash: 'f'.repeat(64), tx_index: 0, payment_addr: { cred: otherPkh }, value: '10000000' },
        ],
        outputs: [
          { payment_addr: { bech32: 'addr_user', cred: userPkh }, value: '9500000', inline_datum: null },
          { payment_addr: { bech32: 'addr_other', cred: otherPkh }, value: '300000', inline_datum: null },
        ],
      },
    ]);

    const res = await request(app).get(`/api/chain/activity/${userPkh}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({
      type: 'receive',
      counterparty: otherPkh,
      amountLovelace: 9_500_000,
      confirmedAtBlock: 200,
      status: 'confirmed',
    });
  });

  it('excludes txs that touch protocol contract addresses', async () => {
    const protocolHash = 'a'.repeat(64);
    const plainHash = 'b'.repeat(64);
    mockKoiosClient.getCredentialTxs.mockResolvedValue([
      { tx_hash: protocolHash, block_height: 100, block_time: 1700000000 },
      { tx_hash: plainHash, block_height: 101, block_time: 1700000100 },
    ]);
    mockKoiosClient.getAddressTxs.mockImplementation(async (addr: string) =>
      addr === 'addr_test_encryption' ? [{ tx_hash: protocolHash, block_height: 100 }] : [],
    );
    mockKoiosClient.getTxInfoWithAssets.mockResolvedValue([
      {
        tx_hash: plainHash,
        block_height: 101,
        block_time: 1700000100,
        inputs: [{ tx_hash: 'd'.repeat(64), tx_index: 0, payment_addr: { cred: otherPkh }, value: '2000000' }],
        outputs: [{ payment_addr: { cred: userPkh }, value: '2000000', inline_datum: null }],
      },
    ]);

    const res = await request(app).get(`/api/chain/activity/${userPkh}`);

    expect(res.status).toBe(200);
    expect(mockKoiosClient.getTxInfoWithAssets).toHaveBeenCalledWith([plainHash]);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].txHash).toBe(plainHash);
  });

  it('sorts activity records newest first', async () => {
    const olderHash = 'a'.repeat(64);
    const newerHash = 'b'.repeat(64);
    mockKoiosClient.getCredentialTxs.mockResolvedValue([
      { tx_hash: olderHash, block_height: 100, block_time: 1700000000 },
      { tx_hash: newerHash, block_height: 200, block_time: 1700001000 },
    ]);
    mockKoiosClient.getAddressTxs.mockResolvedValue([]);
    mockKoiosClient.getTxInfoWithAssets.mockResolvedValue([
      {
        tx_hash: olderHash,
        block_height: 100,
        block_time: 1700000000,
        inputs: [{ tx_hash: 'c'.repeat(64), tx_index: 0, payment_addr: { cred: otherPkh }, value: '1000000' }],
        outputs: [{ payment_addr: { cred: userPkh }, value: '1000000', inline_datum: null }],
      },
      {
        tx_hash: newerHash,
        block_height: 200,
        block_time: 1700001000,
        inputs: [{ tx_hash: 'd'.repeat(64), tx_index: 0, payment_addr: { cred: otherPkh }, value: '2000000' }],
        outputs: [{ payment_addr: { cred: userPkh }, value: '2000000', inline_datum: null }],
      },
    ]);

    const res = await request(app).get(`/api/chain/activity/${userPkh}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].txHash).toBe(newerHash);
    expect(res.body.data[1].txHash).toBe(olderHash);
  });

  it('returns 503 when Koios fails and no stale cache exists', async () => {
    mockKoiosClient.getCredentialTxs.mockRejectedValue(new Error('koios down'));
    mockKoiosClient.getAddressTxs.mockResolvedValue([]);

    const res = await request(app).get(`/api/chain/activity/${userPkh}`);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ACTIVITY_UNAVAILABLE');
  });
});

describe('GET /api/chain/tip', () => {
  it('returns the current network tip with abs_slot', async () => {
    mockKoiosClient.getTip.mockResolvedValue({
      block_no: 43200000,
      epoch_no: 500,
      block_time: 1700000000,
      abs_slot: 86400000,
    });

    const res = await request(app).get('/api/chain/tip');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      block_no: 43200000,
      epoch_no: 500,
      block_time: 1700000000,
      abs_slot: 86400000,
    });
  });

  it('returns 503 when Koios is unreachable', async () => {
    mockKoiosClient.getTip.mockRejectedValue(new Error('network error'));

    const res = await request(app).get('/api/chain/tip');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('TIP_UNAVAILABLE');
  });
});
