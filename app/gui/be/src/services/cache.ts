interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private defaultTtlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(defaultTtlMs: number = 15_000, autoCleanupIntervalMs?: number) {
    this.defaultTtlMs = defaultTtlMs;
    if (autoCleanupIntervalMs && autoCleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => this.cleanupExpired(), autoCleanupIntervalMs);
    }
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      // Don't delete — keep for getStale() fallback.
      // Entry is cleaned up on set(), invalidate(), or clear().
      return undefined;
    }
    return entry.value as T;
  }

  /** Return cached value even if TTL has expired (for stale fallback). */
  getStale<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /** Remove all entries whose TTL has expired. */
  cleanupExpired(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Stop the auto-cleanup interval and clear all entries. */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/** Shared singleton for the API layer (15s default TTL, 60s cleanup cycle). */
export const apiCache = new TtlCache(15_000, 60_000);
