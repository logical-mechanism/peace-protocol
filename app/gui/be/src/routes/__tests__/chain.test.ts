import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';

const mockKoiosClient = {
  getTxInfo: vi.fn(),
  getTip: vi.fn(),
  getProtocolParams: vi.fn(),
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
  getNetworkConfig: vi.fn(),
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
});

describe('GET /api/chain/confirmations/:txHash', () => {
  const validTxHash = 'a'.repeat(64);

  it('returns confirmation count for confirmed tx', async () => {
    mockKoiosClient.getTxInfo.mockResolvedValue({ block_height: 100 });
    mockKoiosClient.getTip.mockResolvedValue({ block_no: 120 });

    const res = await request(app).get(`/api/chain/confirmations/${validTxHash}`);

    expect(res.status).toBe(200);
    expect(res.body.data.confirmations).toBe(20);
  });

  it('returns 0 confirmations when tx not found', async () => {
    mockKoiosClient.getTxInfo.mockRejectedValue(new Error('not found'));
    mockKoiosClient.getTip.mockResolvedValue({ block_no: 120 });

    const res = await request(app).get(`/api/chain/confirmations/${validTxHash}`);

    expect(res.status).toBe(200);
    expect(res.body.data.confirmations).toBe(0);
  });

  it('returns 0 when block_height is not a number', async () => {
    mockKoiosClient.getTxInfo.mockResolvedValue({ block_height: null });
    mockKoiosClient.getTip.mockResolvedValue({ block_no: 120 });

    const res = await request(app).get(`/api/chain/confirmations/${validTxHash}`);

    expect(res.status).toBe(200);
    expect(res.body.data.confirmations).toBe(0);
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
  });

  it('returns 0 confirmations on service error (never 500)', async () => {
    mockKoiosClient.getTxInfo.mockRejectedValue(new Error('network error'));
    mockKoiosClient.getTip.mockRejectedValue(new Error('network error'));

    const res = await request(app).get(`/api/chain/confirmations/${validTxHash}`);

    expect(res.status).toBe(200);
    expect(res.body.data.confirmations).toBe(0);
  });
});
