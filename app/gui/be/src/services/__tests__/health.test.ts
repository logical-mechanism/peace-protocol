import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/index.js', () => ({
  config: { network: 'preprod' },
  getNetworkConfig: () => ({
    kupoUrl: 'http://127.0.0.1:1442',
    koiosUrl: 'https://preprod.koios.rest/api/v1',
    koiosToken: '',
  }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getHealthStatus', () => {
  it('returns healthy when both dependencies respond', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    // Re-import to get fresh module state
    const { getHealthStatus } = await import('../health.js');
    const health = await getHealthStatus('preprod', false);

    expect(health.status).toBe('healthy');
    expect(health.kupo.reachable).toBe(true);
    expect(health.koios.reachable).toBe(true);
    expect(health.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(health.network).toBe('preprod');
    expect(health.useStubs).toBe(false);
    expect(health.timestamp).toBeDefined();
  });

  it('returns degraded when kupo is down', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))  // kupo
      .mockResolvedValueOnce({ ok: true, status: 200 }); // koios

    const { getHealthStatus } = await import('../health.js');
    const health = await getHealthStatus('preprod', false);

    expect(health.status).toBe('degraded');
    expect(health.kupo.reachable).toBe(false);
    expect(health.kupo.error).toContain('ECONNREFUSED');
    expect(health.koios.reachable).toBe(true);
  });

  it('returns degraded when koios is down', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200 })  // kupo
      .mockRejectedValueOnce(new Error('timeout'));        // koios

    const { getHealthStatus } = await import('../health.js');
    const health = await getHealthStatus('preprod', false);

    expect(health.status).toBe('degraded');
    expect(health.kupo.reachable).toBe(true);
    expect(health.koios.reachable).toBe(false);
    expect(health.koios.error).toContain('timeout');
  });

  it('returns unhealthy when both are down', async () => {
    mockFetch.mockRejectedValue(new Error('Network down'));

    const { getHealthStatus } = await import('../health.js');
    const health = await getHealthStatus('preprod', false);

    expect(health.status).toBe('unhealthy');
    expect(health.kupo.reachable).toBe(false);
    expect(health.koios.reachable).toBe(false);
  });

  it('reports error on non-ok HTTP response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    const { getHealthStatus } = await import('../health.js');
    const health = await getHealthStatus('preprod', false);

    expect(health.status).toBe('unhealthy');
    expect(health.kupo.reachable).toBe(false);
    expect(health.kupo.error).toBe('HTTP 503');
    expect(health.kupo.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('tracks lastSuccess timestamps', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const { getHealthStatus } = await import('../health.js');
    const health = await getHealthStatus('preprod', false);

    expect(health.kupo.lastSuccess).toBeDefined();
    expect(health.koios.lastSuccess).toBeDefined();
  });
});
