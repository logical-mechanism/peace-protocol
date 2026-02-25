import { logger } from './logger.js';

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  backoffMultiplier?: number;
}

const DEFAULTS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: RetryOptions,
): Promise<Response> {
  const { maxRetries, initialDelayMs, backoffMultiplier } = { ...DEFAULTS, ...options };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);
      // Don't retry 4xx client errors — only 5xx and network failures
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
    } catch (err) {
      // Network error (ECONNREFUSED, DNS failure, etc.)
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    if (attempt < maxRetries) {
      const delay = initialDelayMs * Math.pow(backoffMultiplier, attempt);
      logger.warn('Retrying fetch', {
        url,
        attempt: attempt + 1,
        maxRetries,
        delayMs: delay,
        error: lastError?.message,
      });
      await sleep(delay);
    }
  }

  throw lastError ?? new Error(`fetchWithRetry: all ${maxRetries} retries exhausted for ${url}`);
}
