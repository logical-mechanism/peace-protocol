import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithRetry } from '../fetchWithRetry.js';

// Use minimal delays (1ms) with real timers to avoid fake timer + async rejection issues
const FAST_OPTIONS = { maxRetries: 3, initialDelayMs: 1, backoffMultiplier: 1 };
const FAST_OPTIONS_2 = { maxRetries: 2, initialDelayMs: 1, backoffMultiplier: 1 };

describe('fetchWithRetry', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // Suppress logger output during tests
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function okResponse(body: unknown = {}): Response {
    return new Response(JSON.stringify(body), { status: 200, statusText: 'OK' });
  }

  function serverErrorResponse(): Response {
    return new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });
  }

  function clientErrorResponse(): Response {
    return new Response('Not Found', { status: 404, statusText: 'Not Found' });
  }

  it('returns response on first successful attempt', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ data: 'test' }));

    const response = await fetchWithRetry('http://example.com/api');
    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not retry on 4xx client errors', async () => {
    fetchMock.mockResolvedValueOnce(clientErrorResponse());

    const response = await fetchWithRetry('http://example.com/api', undefined, FAST_OPTIONS);
    expect(response.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retries on 5xx server errors and succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(serverErrorResponse())
      .mockResolvedValueOnce(okResponse());

    const response = await fetchWithRetry('http://example.com/api', undefined, FAST_OPTIONS);
    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on network errors and succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(okResponse());

    const response = await fetchWithRetry('http://example.com/api', undefined, FAST_OPTIONS);
    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws after all retries exhausted on server errors', async () => {
    fetchMock
      .mockResolvedValueOnce(serverErrorResponse())
      .mockResolvedValueOnce(serverErrorResponse())
      .mockResolvedValueOnce(serverErrorResponse());

    await expect(
      fetchWithRetry('http://example.com/api', undefined, FAST_OPTIONS_2)
    ).rejects.toThrow('HTTP 500 Internal Server Error');

    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('throws after all retries exhausted on network errors', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('DNS lookup failed'))
      .mockRejectedValueOnce(new Error('DNS lookup failed'))
      .mockRejectedValueOnce(new Error('DNS lookup failed'));

    await expect(
      fetchWithRetry('http://example.com/api', undefined, FAST_OPTIONS_2)
    ).rejects.toThrow('DNS lookup failed');

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries correct number of times with exponential backoff', async () => {
    const timestamps: number[] = [];
    fetchMock.mockImplementation(() => {
      timestamps.push(Date.now());
      return Promise.resolve(serverErrorResponse());
    });

    // Use slightly larger delays to verify ordering
    await expect(
      fetchWithRetry('http://example.com/api', undefined, {
        maxRetries: 2,
        initialDelayMs: 10,
        backoffMultiplier: 2,
      })
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Verify delays increased: gap between 2nd and 3rd call > gap between 1st and 2nd
    if (timestamps.length === 3) {
      const gap1 = timestamps[1] - timestamps[0];
      const gap2 = timestamps[2] - timestamps[1];
      expect(gap2).toBeGreaterThanOrEqual(gap1);
    }
  });

  it('passes request init options through to fetch', async () => {
    fetchMock.mockResolvedValueOnce(okResponse());

    const init: RequestInit = {
      method: 'POST',
      body: JSON.stringify({ key: 'value' }),
      headers: { 'Content-Type': 'application/json' },
    };

    await fetchWithRetry('http://example.com/api', init);
    expect(fetchMock).toHaveBeenCalledWith('http://example.com/api', init);
  });

  it('works with zero retries (single attempt)', async () => {
    fetchMock.mockResolvedValueOnce(serverErrorResponse());

    await expect(
      fetchWithRetry('http://example.com/api', undefined, { maxRetries: 0 })
    ).rejects.toThrow('HTTP 500');

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('handles mixed failures before success', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(serverErrorResponse())
      .mockResolvedValueOnce(okResponse());

    const response = await fetchWithRetry('http://example.com/api', undefined, FAST_OPTIONS);
    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
