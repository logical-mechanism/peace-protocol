import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

// Mock all dependencies the app imports

vi.mock('../config/index.js', () => ({
  config: {
    useStubs: false,
    network: 'preprod',
    nodeEnv: 'test',
    cors: {
      origins: ['http://127.0.0.1:5173', 'tauri://localhost'],
    },
  },
  getNetworkConfig: vi.fn(() => ({
    kupoUrl: 'http://127.0.0.1:1442',
    koiosUrl: 'https://preprod.koios.rest/api/v1',
    koiosToken: '',
  })),
}));

vi.mock('../stubs/index.js', () => ({
  STUB_ENCRYPTIONS: [],
  STUB_BIDS: [],
  STUB_PROTOCOL_CONFIG: {},
}));

vi.mock('../services/encryptions.js', () => ({
  getAllEncryptions: vi.fn(),
  getEncryptionByToken: vi.fn(),
  getEncryptionsByUser: vi.fn(),
  getEncryptionsByStatus: vi.fn(),
  getEncryptionLevels: vi.fn(),
}));

vi.mock('../services/bids.js', () => ({
  getAllBids: vi.fn(),
  getBidByToken: vi.fn(),
  getBidsByUser: vi.fn(),
  getBidsByEncryption: vi.fn(),
  getBidsByStatus: vi.fn(),
}));

vi.mock('../services/kupo.js', () => ({
  getKupoClient: vi.fn(() => ({ getAddressUtxos: vi.fn() })),
  KupoUnavailableError: class KupoUnavailableError extends Error {},
}));

vi.mock('../services/koios.js', () => ({
  getKoiosClient: vi.fn(() => ({
    getTxInfo: vi.fn(),
    getTip: vi.fn(),
    getProtocolParams: vi.fn(),
  })),
}));

vi.mock('../services/health.js', () => ({
  getHealthStatus: vi.fn().mockResolvedValue({
    status: 'healthy',
    uptimeSeconds: 1,
    kupo: { reachable: true, latencyMs: 5, lastSuccess: new Date().toISOString() },
    koios: { reachable: true, latencyMs: 5, lastSuccess: new Date().toISOString() },
    network: 'preprod',
    useStubs: false,
    timestamp: new Date().toISOString(),
  }),
}));

const app = createApp();

// ── CORS ─────────────────────────────────────────────────────────────

describe('CORS', () => {
  it('includes Access-Control-Allow-Origin for allowed origin', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'http://127.0.0.1:5173');

    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
  });

  it('includes Access-Control-Allow-Credentials header', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'http://127.0.0.1:5173');

    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('OPTIONS preflight returns allowed methods', async () => {
    const res = await request(app)
      .options('/health')
      .set('Origin', 'http://127.0.0.1:5173')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.status).toBe(204);
    const methods = res.headers['access-control-allow-methods'];
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
    expect(methods).toContain('DELETE');
  });

  it('OPTIONS preflight returns allowed headers', async () => {
    const res = await request(app)
      .options('/health')
      .set('Origin', 'http://127.0.0.1:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'Content-Type');

    expect(res.headers['access-control-allow-headers']).toContain('Content-Type');
  });

  it('does not include CORS headers for disallowed origins', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://evil.example.com');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

// ── JSON body parsing ────────────────────────────────────────────────

describe('JSON body parsing', () => {
  it('parses valid JSON bodies', async () => {
    // POST to a non-existent route — the body parsing middleware still runs
    // and the 404 handler fires, proving the middleware chain is intact
    const res = await request(app)
      .post('/api/nonexistent')
      .send({ key: 'value' })
      .set('Content-Type', 'application/json');

    // Should get 404 (not a parse error), confirming JSON was accepted
    expect(res.status).toBe(404);
  });

  it('rejects bodies larger than 1mb via error handler', async () => {
    const largeBody = JSON.stringify({ data: 'x'.repeat(1_100_000) });
    const res = await request(app)
      .post('/api/nonexistent')
      .send(largeBody)
      .set('Content-Type', 'application/json');

    // body-parser throws PayloadTooLargeError → caught by global error handler → 500
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('rejects malformed JSON via error handler', async () => {
    const res = await request(app)
      .post('/api/nonexistent')
      .set('Content-Type', 'application/json')
      .send('{ invalid json }');

    // body-parser throws SyntaxError → caught by global error handler → 500
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── 404 handler ──────────────────────────────────────────────────────

describe('404 handler', () => {
  it('returns 404 with correct error format for unknown routes', async () => {
    const res = await request(app).get('/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('Endpoint not found');
  });

  it('returns 404 for unknown API paths', async () => {
    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('includes requestId in 404 response', async () => {
    const res = await request(app).get('/nonexistent');

    // requestId is added by requestLogger middleware
    expect(res.body.error.requestId).toBeDefined();
    expect(typeof res.body.error.requestId).toBe('string');
  });

  it('returns JSON content-type', async () => {
    const res = await request(app).get('/nonexistent');

    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

// ── Middleware ordering ──────────────────────────────────────────────

describe('middleware ordering', () => {
  it('health endpoint is accessible and returns valid structure', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
    expect(res.body.network).toBe('preprod');
    expect(res.body.timestamp).toBeDefined();
  });

  it('readiness probe is accessible', async () => {
    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
  });

  it('API routes are mounted under /api prefix', async () => {
    // The encryptions route exists at /api/encryptions
    // Even though the mock returns nothing useful, it should not 404
    const res = await request(app).get('/api/encryptions');

    expect(res.status).not.toBe(404);
  });
});
