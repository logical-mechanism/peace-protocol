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
