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
  getNetworkConfig: vi.fn(() => ({
    kupoUrl: 'http://127.0.0.1:1442',
    koiosUrl: 'https://preprod.koios.rest/api/v1',
    koiosToken: '',
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

vi.mock('../../services/koios.js', () => ({
  getKoiosClient: vi.fn(() => ({
    getTxInfo: vi.fn(),
    getTip: vi.fn(),
    getProtocolParams: vi.fn(),
  })),
}));

vi.mock('../../services/health.js', () => ({
  getHealthStatus: vi.fn(),
}));

import { getHealthStatus } from '../../services/health.js';

const app = createApp();

describe('GET /health', () => {
  it('returns health status from service', async () => {
    (getHealthStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'healthy',
      uptimeSeconds: 42,
      kupo: { reachable: true, latencyMs: 10, lastSuccess: '2025-01-01T00:00:00.000Z' },
      koios: { reachable: true, latencyMs: 20, lastSuccess: '2025-01-01T00:00:00.000Z' },
      network: 'preprod',
      useStubs: false,
      timestamp: '2025-01-01T00:00:00.000Z',
    });

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.network).toBe('preprod');
    expect(res.body.useStubs).toBe(false);
    expect(res.body.uptimeSeconds).toBe(42);
    expect(res.body.kupo.reachable).toBe(true);
    expect(res.body.koios.reachable).toBe(true);
    expect(res.body.timestamp).toBeDefined();
  });

  it('returns degraded status', async () => {
    (getHealthStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'degraded',
      uptimeSeconds: 10,
      kupo: { reachable: false, latencyMs: 0, lastSuccess: null, error: 'ECONNREFUSED' },
      koios: { reachable: true, latencyMs: 15, lastSuccess: '2025-01-01T00:00:00.000Z' },
      network: 'preprod',
      useStubs: false,
      timestamp: '2025-01-01T00:00:00.000Z',
    });

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.kupo.reachable).toBe(false);
    expect(res.body.koios.reachable).toBe(true);
  });

  it('returns 200 even when health service throws', async () => {
    (getHealthStatus as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('crash'));

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('unhealthy');
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
