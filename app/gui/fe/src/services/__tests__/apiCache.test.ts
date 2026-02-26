import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiCache } from '../apiCache';

describe('ApiCache', () => {
  let cache: ApiCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new ApiCache(1000); // 1s default TTL for tests
  });
  afterEach(() => vi.useRealTimers());

  it('returns undefined for missing keys', () => {
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('returns cached value within TTL', () => {
    cache.set('key', { data: 'hello' });
    expect(cache.get<{ data: string }>('key')).toEqual({ data: 'hello' });
  });

  it('returns undefined after TTL expires', () => {
    cache.set('key', 'value');
    vi.advanceTimersByTime(1001);
    expect(cache.get('key')).toBeUndefined();
  });

  it('supports custom TTL per entry', () => {
    cache.set('short', 'val', 500);
    cache.set('long', 'val', 5000);

    vi.advanceTimersByTime(600);
    expect(cache.get('short')).toBeUndefined();
    expect(cache.get('long')).toBe('val');
  });

  it('invalidate removes specific key', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.invalidate('a');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
  });

  it('clear removes all entries', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });

  it('size reflects current entries', () => {
    expect(cache.size).toBe(0);
    cache.set('a', 1);
    expect(cache.size).toBe(1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
  });

  it('overwrites existing entry with new value and TTL', () => {
    cache.set('key', 'old', 500);
    cache.set('key', 'new', 2000);

    vi.advanceTimersByTime(600);
    expect(cache.get('key')).toBe('new'); // still valid with longer TTL
  });

  it('deletes expired entries on get (no stale data)', () => {
    cache.set('key', 'val');
    vi.advanceTimersByTime(1001);
    cache.get('key'); // triggers cleanup
    expect(cache.size).toBe(0);
  });
});
