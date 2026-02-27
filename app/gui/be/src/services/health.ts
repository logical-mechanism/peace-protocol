import { getNetworkConfig } from '../config/index.js';
import { getKupoClient } from './kupo.js';
import { getKoiosClient } from './koios.js';

const startTime = Date.now();
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

let lastKupoSuccess: string | null = null;
let lastKoiosSuccess: string | null = null;

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

  const [kupoResult, koiosResult] = await Promise.all([
    checkDependency(`${kupoUrl}/health`),
    checkDependency(`${koiosUrl}/tip`),
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
