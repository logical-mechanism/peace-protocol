import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';

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

vi.mock('../../services/koios.js', () => ({
  getKoiosClient: vi.fn(() => ({
    getTxInfo: vi.fn(),
    getTip: vi.fn(),
    getProtocolParams: vi.fn(),
  })),
}));

const app = createApp();

describe('GET /health', () => {
  it('returns health status', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.network).toBe('preprod');
    expect(res.body.useStubs).toBe(false);
    expect(res.body.timestamp).toBeDefined();
  });
});

describe('404 handler', () => {
  it('returns 404 for unknown endpoints', async () => {
    const res = await request(app).get('/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('Endpoint not found');
  });

  it('returns 404 for unknown API paths', async () => {
    const res = await request(app).get('/api/nonexistent');

    expect(res.status).toBe(404);
  });
});
