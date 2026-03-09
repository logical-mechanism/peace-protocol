import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getFavorites, toggleFavorite, clearFavorites } from '../favoritesStorage';

describe('favoritesStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getFavorites', () => {
    it('returns empty set when no favorites exist', () => {
      expect(getFavorites('pkh1').size).toBe(0);
    });

    it('returns empty set for corrupted JSON', () => {
      localStorage.setItem('veiled_favorites_pkh1', '{not valid json');
      expect(getFavorites('pkh1').size).toBe(0);
    });
  });

  describe('toggleFavorite', () => {
    it('adds a favorite and returns true', () => {
      const result = toggleFavorite('pkh1', 'token_a');
      expect(result).toBe(true);
      expect(getFavorites('pkh1').has('token_a')).toBe(true);
    });

    it('removes a favorite and returns false', () => {
      toggleFavorite('pkh1', 'token_a'); // add
      const result = toggleFavorite('pkh1', 'token_a'); // remove
      expect(result).toBe(false);
      expect(getFavorites('pkh1').has('token_a')).toBe(false);
    });

    it('handles multiple favorites', () => {
      toggleFavorite('pkh1', 'token_a');
      toggleFavorite('pkh1', 'token_b');
      toggleFavorite('pkh1', 'token_c');
      const favs = getFavorites('pkh1');
      expect(favs.size).toBe(3);
      expect(favs.has('token_a')).toBe(true);
      expect(favs.has('token_b')).toBe(true);
      expect(favs.has('token_c')).toBe(true);
    });

    it('only removes the toggled token', () => {
      toggleFavorite('pkh1', 'token_a');
      toggleFavorite('pkh1', 'token_b');
      toggleFavorite('pkh1', 'token_a'); // remove a
      const favs = getFavorites('pkh1');
      expect(favs.size).toBe(1);
      expect(favs.has('token_a')).toBe(false);
      expect(favs.has('token_b')).toBe(true);
    });
  });

  describe('PKH isolation', () => {
    it('keeps favorites separate per PKH', () => {
      toggleFavorite('pkh1', 'token_a');
      toggleFavorite('pkh2', 'token_b');
      expect(getFavorites('pkh1').has('token_a')).toBe(true);
      expect(getFavorites('pkh1').has('token_b')).toBe(false);
      expect(getFavorites('pkh2').has('token_b')).toBe(true);
      expect(getFavorites('pkh2').has('token_a')).toBe(false);
    });
  });

  describe('clearFavorites', () => {
    it('removes all favorites for a PKH', () => {
      toggleFavorite('pkh1', 'token_a');
      toggleFavorite('pkh1', 'token_b');
      clearFavorites('pkh1');
      expect(getFavorites('pkh1').size).toBe(0);
    });

    it('does not affect other PKHs', () => {
      toggleFavorite('pkh1', 'token_a');
      toggleFavorite('pkh2', 'token_b');
      clearFavorites('pkh1');
      expect(getFavorites('pkh2').has('token_b')).toBe(true);
    });
  });

  describe('error paths', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('getFavorites returns empty set when getItem throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('SecurityError');
      });
      expect(getFavorites('pkh1').size).toBe(0);
    });

    it('toggleFavorite propagates when setItem throws (no try-catch)', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });
      expect(() => toggleFavorite('pkh1', 'token_a')).toThrow('QuotaExceededError');
    });
  });
});
