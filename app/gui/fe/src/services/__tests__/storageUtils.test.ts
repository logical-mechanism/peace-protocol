import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { storageGet, storageSet, storageRemove, storageGetJSON, storageSetJSON } from '../storageUtils';

describe('storageUtils', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('storageGet', () => {
    it('returns the stored string value', () => {
      localStorage.setItem('k', 'hello');
      expect(storageGet('k')).toBe('hello');
    });

    it('returns null for missing key', () => {
      expect(storageGet('missing')).toBeNull();
    });

    it('returns null on storage error', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('quota');
      });
      expect(storageGet('k')).toBeNull();
    });
  });

  describe('storageSet', () => {
    it('writes a string value', () => {
      storageSet('k', 'world');
      expect(localStorage.getItem('k')).toBe('world');
    });

    it('does not throw on storage error', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota');
      });
      expect(() => storageSet('k', 'v')).not.toThrow();
    });
  });

  describe('storageRemove', () => {
    it('removes a key', () => {
      localStorage.setItem('k', 'v');
      storageRemove('k');
      expect(localStorage.getItem('k')).toBeNull();
    });

    it('does not throw on storage error', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('quota');
      });
      expect(() => storageRemove('k')).not.toThrow();
    });
  });

  describe('storageGetJSON', () => {
    it('parses a stored JSON value', () => {
      localStorage.setItem('k', JSON.stringify({ a: 1 }));
      expect(storageGetJSON('k', {})).toEqual({ a: 1 });
    });

    it('returns fallback for missing key', () => {
      expect(storageGetJSON('missing', 42)).toBe(42);
    });

    it('returns fallback for invalid JSON', () => {
      localStorage.setItem('k', 'not-json');
      expect(storageGetJSON('k', [])).toEqual([]);
    });

    it('returns fallback on storage error', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('quota');
      });
      expect(storageGetJSON('k', 'default')).toBe('default');
    });
  });

  describe('storageSetJSON', () => {
    it('writes a JSON-serialized value', () => {
      storageSetJSON('k', { x: true });
      expect(JSON.parse(localStorage.getItem('k')!)).toEqual({ x: true });
    });

    it('does not throw on storage error', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota');
      });
      expect(() => storageSetJSON('k', 'v')).not.toThrow();
    });
  });

  describe('dev warning', () => {
    let originalDev: boolean;

    beforeEach(() => {
      originalDev = import.meta.env.DEV;
    });

    afterEach(() => {
      // DEV is read-only in prod but writable in vitest
      (import.meta.env as Record<string, unknown>).DEV = originalDev;
    });

    it('logs a warning in dev mode on error', () => {
      (import.meta.env as Record<string, unknown>).DEV = true;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('boom');
      });
      storageGet('k');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[storage]'),
        expect.any(Error),
      );
    });
  });
});
