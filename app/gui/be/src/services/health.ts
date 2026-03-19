import { getNetworkConfig } from '../config/index.js';
import { getKupoClient } from './kupo.js';
import { getKoiosClient } from './koios.js';

const startTime = Date.now();
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const KOIOS_HEALTH_CACHE_MS = 5 * 60 * 1000; // 5 minutes — avoid frequent /tip pings

let lastKupoSuccess: string | null = null;
let lastKoiosSuccess: string | null = null;
let cachedKoiosResult: { ok: boolean; latencyMs: number; error?: string } | null = null;
let koiosResultCachedAt = 0;

/** Reset cached Koios health result (for testing only). */
export function resetKoiosHealthCache(): void {
  cachedKoiosResult = null;
  koiosResultCachedAt = 0;
}

export interface CircuitBreakerInfo {
  state: string;
  failureCount: number;
}

export interface DependencyHealth {
  reachable: boolean;
  latencyMs: number;
  lastSuccess: string | null;
  stale: boolean;
  error?: string;
  circuitBreaker?: CircuitBreakerInfo;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptimeSeconds: number;
  kupo: DependencyHealth;
  koios: DependencyHealth;
  network: string;
  useStubs: boolean;
  timestamp: string;
}

async function checkDependency(
  url: string,
  timeoutMs = 5000,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = performance.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - start);
    if (response.ok) {
      return { ok: true, latencyMs };
    }
    return { ok: false, latencyMs, error: `HTTP ${response.status}` };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, latencyMs, error: message };
  }
}

export async function getHealthStatus(network: string, useStubs: boolean): Promise<HealthStatus> {
  const { kupoUrl, koiosUrl } = getNetworkConfig();

  // Use circuit breaker state as primary Koios health signal to avoid frequent /tip calls.
  // Only ping Koios directly if the cached result has expired (every 5 minutes).
  let koiosResult: { ok: boolean; latencyMs: number; error?: string };
  const now = Date.now();

  // Invalidate cached "unhealthy" result if the circuit breaker has left OPEN state
  // (i.e., transitioned to HALF_OPEN after cooldown). This ensures recovery is detected
  // promptly rather than waiting up to 5 minutes for the cache to expire.
  if (cachedKoiosResult && !cachedKoiosResult.ok) {
    try {
      const cbState = getKoiosClient().getCircuitBreakerState();
      if (cbState.state !== 'OPEN') {
        cachedKoiosResult = null;
        koiosResultCachedAt = 0;
      }
    } catch { /* client not initialized yet — keep cache */ }
  }

  if (cachedKoiosResult && now - koiosResultCachedAt < KOIOS_HEALTH_CACHE_MS) {
    koiosResult = cachedKoiosResult;
  } else {
    // Check circuit breaker first — if it's OPEN, Koios is known-bad, skip the ping
    try {
      const cbState = getKoiosClient().getCircuitBreakerState();
      if (cbState.state === 'OPEN') {
        koiosResult = { ok: false, latencyMs: 0, error: 'Circuit breaker OPEN' };
      } else {
        koiosResult = await checkDependency(`${koiosUrl}/tip`);
      }
    } catch {
      koiosResult = await checkDependency(`${koiosUrl}/tip`);
    }
    cachedKoiosResult = koiosResult;
    koiosResultCachedAt = now;
  }

  const [kupoResult] = await Promise.all([
    checkDependency(`${kupoUrl}/health`),
  ]);

  if (kupoResult.ok) lastKupoSuccess = new Date().toISOString();
  if (koiosResult.ok) lastKoiosSuccess = new Date().toISOString();

  let kupoCircuitBreaker: CircuitBreakerInfo | undefined;
  let koiosCircuitBreaker: CircuitBreakerInfo | undefined;
  try {
    kupoCircuitBreaker = getKupoClient().getCircuitBreakerState();
  } catch { /* client not initialized yet */ }
  try {
    koiosCircuitBreaker = getKoiosClient().getCircuitBreakerState();
  } catch { /* client not initialized yet */ }

  const kupoStale = !kupoResult.ok && lastKupoSuccess !== null
    && Date.now() - new Date(lastKupoSuccess).getTime() > STALE_THRESHOLD_MS;
  const koiosStale = !koiosResult.ok && lastKoiosSuccess !== null
    && Date.now() - new Date(lastKoiosSuccess).getTime() > STALE_THRESHOLD_MS;

  const kupo: DependencyHealth = {
    reachable: kupoResult.ok,
    latencyMs: kupoResult.latencyMs,
    lastSuccess: lastKupoSuccess,
    stale: kupoStale,
    ...(kupoResult.error && { error: kupoResult.error }),
    ...(kupoCircuitBreaker && { circuitBreaker: kupoCircuitBreaker }),
  };

  const koios: DependencyHealth = {
    reachable: koiosResult.ok,
    latencyMs: koiosResult.latencyMs,
    lastSuccess: lastKoiosSuccess,
    stale: koiosStale,
    ...(koiosResult.error && { error: koiosResult.error }),
    ...(koiosCircuitBreaker && { circuitBreaker: koiosCircuitBreaker }),
  };

  let status: HealthStatus['status'];
  if (kupo.reachable && koios.reachable) {
    status = 'healthy';
  } else if (kupo.reachable || koios.reachable) {
    status = 'degraded';
  } else {
    status = 'unhealthy';
  }

  return {
    status,
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    kupo,
    koios,
    network,
    useStubs,
    timestamp: new Date().toISOString(),
  };
}
