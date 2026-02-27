import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/index.js', () => ({
  config: { network: 'preprod' },
  getNetworkConfig: () => ({
    kupoUrl: 'http://127.0.0.1:1442',
    koiosUrl: 'https://preprod.koios.rest/api/v1',
    koiosToken: '',
  }),
}));

const mockKupoCBState = { state: 'CLOSED', failureCount: 0 };
const mockKoiosCBState = { state: 'CLOSED', failureCount: 0 };

vi.mock('../kupo.js', () => ({
  getKupoClient: () => ({
    getCircuitBreakerState: () => mockKupoCBState,
  }),
}));

vi.mock('../koios.js', () => ({
  getKoiosClient: () => ({
    getCircuitBreakerState: () => mockKoiosCBState,
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

  it('reports stale when dependency is down and lastSuccess exceeds threshold', async () => {
    // First call: both succeed to set lastSuccess timestamps
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    const { getHealthStatus } = await import('../health.js');
    await getHealthStatus('preprod', false);

    // Advance time past the 5-minute staleness threshold
    const originalNow = Date.now;
    Date.now = () => originalNow() + 6 * 60 * 1000; // +6 minutes

    // Second call: both fail
    mockFetch.mockRejectedValue(new Error('down'));
    const health = await getHealthStatus('preprod', false);

    expect(health.kupo.stale).toBe(true);
    expect(health.koios.stale).toBe(true);
    expect(health.kupo.reachable).toBe(false);
    expect(health.koios.reachable).toBe(false);

    Date.now = originalNow;
  });

  it('reports not stale when dependency is down but lastSuccess is recent', async () => {
    // First call: both succeed
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    const { getHealthStatus } = await import('../health.js');
    await getHealthStatus('preprod', false);

    // Second call: both fail, but within threshold
    mockFetch.mockRejectedValue(new Error('down'));
    const health = await getHealthStatus('preprod', false);

    expect(health.kupo.stale).toBe(false);
    expect(health.koios.stale).toBe(false);
  });

  it('reports not stale when dependency is reachable regardless of lastSuccess age', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    const { getHealthStatus } = await import('../health.js');
    const health = await getHealthStatus('preprod', false);

    expect(health.kupo.stale).toBe(false);
    expect(health.koios.stale).toBe(false);
    expect(health.kupo.reachable).toBe(true);
  });

  it('includes circuit breaker state for both dependencies', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    mockKupoCBState.state = 'OPEN';
    mockKupoCBState.failureCount = 5;
    mockKoiosCBState.state = 'HALF_OPEN';
    mockKoiosCBState.failureCount = 3;

    const { getHealthStatus } = await import('../health.js');
    const health = await getHealthStatus('preprod', false);

    expect(health.kupo.circuitBreaker).toEqual({ state: 'OPEN', failureCount: 5 });
    expect(health.koios.circuitBreaker).toEqual({ state: 'HALF_OPEN', failureCount: 3 });

    // Reset for other tests
    mockKupoCBState.state = 'CLOSED';
    mockKupoCBState.failureCount = 0;
    mockKoiosCBState.state = 'CLOSED';
    mockKoiosCBState.failureCount = 0;
  });
});
