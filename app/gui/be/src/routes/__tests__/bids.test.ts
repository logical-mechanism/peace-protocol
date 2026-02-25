import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';

vi.mock('../../services/bids.js', () => ({
  getAllBids: vi.fn(),
  getBidByToken: vi.fn(),
  getBidsByUser: vi.fn(),
  getBidsByEncryption: vi.fn(),
  getBidsByStatus: vi.fn(),
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
  STUB_BIDS: [
    { tokenName: 'stub_bid1', bidderPkh: 'aabb', encryptionToken: 'enc1', status: 'pending' },
  ],
  STUB_ENCRYPTIONS: [],
  STUB_PROTOCOL_CONFIG: {},
}));

// Must also mock encryptions since routes/index.js imports all route modules
vi.mock('../../services/encryptions.js', () => ({
  getAllEncryptions: vi.fn(),
  getEncryptionByToken: vi.fn(),
  getEncryptionsByUser: vi.fn(),
  getEncryptionsByStatus: vi.fn(),
  getEncryptionLevels: vi.fn(),
}));

vi.mock('../../services/kupo.js', () => ({
  getKupoClient: vi.fn(() => ({ getAddressUtxos: vi.fn() })),
}));

vi.mock('../../services/koios.js', () => ({
  getKoiosClient: vi.fn(() => ({
    getTxInfo: vi.fn(),
    getTip: vi.fn(),
    getProtocolParams: vi.fn(),
  })),
}));

import {
  getAllBids,
  getBidByToken,
  getBidsByUser,
  getBidsByEncryption,
  getBidsByStatus,
} from '../../services/bids.js';
import { config } from '../../config/index.js';

const app = createApp();

beforeEach(() => {
  vi.clearAllMocks();
  (config as Record<string, unknown>).useStubs = false;
});

describe('GET /api/bids', () => {
  it('returns bid list with meta', async () => {
    (getAllBids as ReturnType<typeof vi.fn>).mockResolvedValue([{ tokenName: 'b1' }]);

    const res = await request(app).get('/api/bids');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it('returns 500 on service error', async () => {
    (getAllBids as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

    const res = await request(app).get('/api/bids');
    expect(res.status).toBe(500);
  });

  it('returns stub data when useStubs is true', async () => {
    (config as Record<string, unknown>).useStubs = true;

    const res = await request(app).get('/api/bids');

    expect(res.status).toBe(200);
    expect(res.body.data[0].tokenName).toBe('stub_bid1');
    expect(getAllBids).not.toHaveBeenCalled();
  });
});

describe('GET /api/bids/:tokenName', () => {
  it('returns bid when found', async () => {
    (getBidByToken as ReturnType<typeof vi.fn>).mockResolvedValue({ tokenName: 'b1' });

    const res = await request(app).get('/api/bids/b1');
    expect(res.status).toBe(200);
    expect(res.body.data.tokenName).toBe('b1');
  });

  it('returns 404 when not found', async () => {
    (getBidByToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await request(app).get('/api/bids/aabb');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/bids/user/:pkh', () => {
  const validPkh = 'bb'.repeat(28); // 56 hex chars

  it('returns user bids', async () => {
    (getBidsByUser as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const res = await request(app).get(`/api/bids/user/${validPkh}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(0);
  });
});

describe('GET /api/bids/encryption/:encryptionToken', () => {
  it('returns bids for encryption', async () => {
    (getBidsByEncryption as ReturnType<typeof vi.fn>).mockResolvedValue([
      { tokenName: 'b1', encryptionToken: 'aabb' },
    ]);

    const res = await request(app).get('/api/bids/encryption/aabb');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /api/bids/status/:status', () => {
  it('returns filtered bids for valid status', async () => {
    (getBidsByStatus as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const res = await request(app).get('/api/bids/status/pending');
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid status', async () => {
    const res = await request(app).get('/api/bids/status/bogus');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS');
  });

  it('accepts all valid bid statuses', async () => {
    (getBidsByStatus as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    for (const status of ['pending', 'accepted', 'rejected', 'cancelled']) {
      const res = await request(app).get(`/api/bids/status/${status}`);
      expect(res.status).toBe(200);
    }
  });
});
