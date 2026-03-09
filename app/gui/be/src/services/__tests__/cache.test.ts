import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TtlCache } from '../cache.js';

describe('TtlCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns undefined for missing keys', () => {
    const cache = new TtlCache(1000);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('stores and retrieves values within TTL', () => {
    const cache = new TtlCache(1000);
    cache.set('key', { data: 'test' });
    expect(cache.get('key')).toEqual({ data: 'test' });
  });

  it('returns undefined after TTL expires', () => {
    const cache = new TtlCache(1000);
    cache.set('key', 'value');

    vi.advanceTimersByTime(999);
    expect(cache.get('key')).toBe('value');

    vi.advanceTimersByTime(2);
    expect(cache.get('key')).toBeUndefined();
  });

  it('supports custom TTL per entry', () => {
    const cache = new TtlCache(10_000);
    cache.set('short', 'a', 500);
    cache.set('long', 'b', 5000);

    vi.advanceTimersByTime(600);
    expect(cache.get('short')).toBeUndefined();
    expect(cache.get('long')).toBe('b');
  });

  it('invalidate removes a specific entry', () => {
    const cache = new TtlCache(10_000);
    cache.set('a', 1);
    cache.set('b', 2);

    cache.invalidate('a');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
  });

  it('clear removes all entries', () => {
    const cache = new TtlCache(10_000);
    cache.set('a', 1);
    cache.set('b', 2);

    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('size reflects active entries', () => {
    const cache = new TtlCache(1000);
    expect(cache.size).toBe(0);

    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);

    cache.invalidate('a');
    expect(cache.size).toBe(1);
  });

  it('overwrites existing entries', () => {
    const cache = new TtlCache(10_000);
    cache.set('key', 'old');
    cache.set('key', 'new');
    expect(cache.get('key')).toBe('new');
  });

  it('expired entries remain in store for stale fallback', () => {
    const cache = new TtlCache(100);
    cache.set('key', 'value');
    expect(cache.size).toBe(1);

    vi.advanceTimersByTime(200);
    cache.get('key'); // expired but not deleted
    expect(cache.size).toBe(1); // still in store for getStale()
    expect(cache.get('key')).toBeUndefined();
    expect(cache.getStale('key')).toBe('value');
  });

  describe('cleanupExpired', () => {
    it('removes entries past their TTL', () => {
      const cache = new TtlCache(100);
      cache.set('expired1', 'a');
      cache.set('expired2', 'b');
      cache.set('fresh', 'c', 10_000);

      vi.advanceTimersByTime(200);
      const removed = cache.cleanupExpired();

      expect(removed).toBe(2);
      expect(cache.size).toBe(1);
      expect(cache.get('fresh')).toBe('c');
      expect(cache.getStale('expired1')).toBeUndefined();
      expect(cache.getStale('expired2')).toBeUndefined();
    });

    it('returns 0 when no entries are expired', () => {
      const cache = new TtlCache(10_000);
      cache.set('a', 1);
      cache.set('b', 2);

      expect(cache.cleanupExpired()).toBe(0);
      expect(cache.size).toBe(2);
    });

    it('returns 0 on empty cache', () => {
      const cache = new TtlCache(1000);
      expect(cache.cleanupExpired()).toBe(0);
    });

    it('stale entries survive until cleanup runs', () => {
      const cache = new TtlCache(100);
      cache.set('key', 'value');

      vi.advanceTimersByTime(200);
      // Stale fallback still works before cleanup
      expect(cache.getStale('key')).toBe('value');

      cache.cleanupExpired();
      // After cleanup, stale fallback no longer works
      expect(cache.getStale('key')).toBeUndefined();
    });
  });

  describe('auto-cleanup', () => {
    it('runs cleanup on the configured interval', () => {
      const cache = new TtlCache(100, 1000);
      cache.set('a', 1);

      vi.advanceTimersByTime(200); // entries expire
      expect(cache.size).toBe(1); // still in store

      vi.advanceTimersByTime(800); // cleanup fires at 1000ms
      expect(cache.size).toBe(0); // cleaned up

      cache.destroy();
    });

    it('destroy stops the interval and clears entries', () => {
      const cache = new TtlCache(100, 500);
      cache.set('a', 1);

      cache.destroy();
      expect(cache.size).toBe(0);

      // Further interval ticks don't cause errors
      vi.advanceTimersByTime(1000);
    });
  });

  describe('getStale', () => {
    it('returns value even after TTL expires', () => {
      const cache = new TtlCache(100);
      cache.set('key', 'value');

      vi.advanceTimersByTime(500);
      expect(cache.get('key')).toBeUndefined();
      expect(cache.getStale('key')).toBe('value');
    });

    it('returns undefined for missing keys', () => {
      const cache = new TtlCache(1000);
      expect(cache.getStale('missing')).toBeUndefined();
    });

    it('returns value within TTL (same as get)', () => {
      const cache = new TtlCache(10_000);
      cache.set('key', 'fresh');
      expect(cache.getStale('key')).toBe('fresh');
    });

    it('returns undefined after invalidate', () => {
      const cache = new TtlCache(100);
      cache.set('key', 'value');
      cache.invalidate('key');
      expect(cache.getStale('key')).toBeUndefined();
    });
  });
});
