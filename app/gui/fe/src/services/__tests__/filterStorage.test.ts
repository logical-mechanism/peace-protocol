import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPersistedFilters, persistFilters, clearPersistedFilters } from '../filterStorage';
import { MARKETPLACE_INITIAL } from '../../hooks/useTabFilterState';

describe('filterStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getPersistedFilters', () => {
    it('returns null when nothing stored', () => {
      expect(getPersistedFilters('pkh1')).toBeNull();
    });

    it('returns null for corrupted JSON', () => {
      localStorage.setItem('veiled_marketplace_filters_pkh1', '{not valid');
      expect(getPersistedFilters('pkh1')).toBeNull();
    });
  });

  describe('persistFilters', () => {
    it('round-trips filter state', () => {
      const filters = { ...MARKETPLACE_INITIAL, searchQuery: 'test', sortBy: 'price-high' as const };
      persistFilters('pkh1', filters);
      const loaded = getPersistedFilters('pkh1');
      expect(loaded).not.toBeNull();
      expect(loaded!.searchQuery).toBe('test');
      expect(loaded!.sortBy).toBe('price-high');
    });

    it('persists all filter fields', () => {
      const filters = {
        ...MARKETPLACE_INITIAL,
        searchQuery: 'hello',
        sortBy: 'most-bids' as const,
        statusFilter: 'active' as const,
        categoryFilter: 'document',
        viewMode: 'list' as const,
        priceMin: '5',
        priceMax: '100',
        showFavoritesOnly: true,
        currentPage: 3,
      };
      persistFilters('pkh1', filters);
      const loaded = getPersistedFilters('pkh1');
      expect(loaded).toEqual(filters);
    });
  });

  describe('PKH isolation', () => {
    it('keeps filters separate per PKH', () => {
      persistFilters('pkh1', { ...MARKETPLACE_INITIAL, searchQuery: 'alpha' });
      persistFilters('pkh2', { ...MARKETPLACE_INITIAL, searchQuery: 'beta' });
      expect(getPersistedFilters('pkh1')!.searchQuery).toBe('alpha');
      expect(getPersistedFilters('pkh2')!.searchQuery).toBe('beta');
    });
  });

  describe('clearPersistedFilters', () => {
    it('removes stored filters for a PKH', () => {
      persistFilters('pkh1', { ...MARKETPLACE_INITIAL, searchQuery: 'test' });
      clearPersistedFilters('pkh1');
      expect(getPersistedFilters('pkh1')).toBeNull();
    });

    it('does not affect other PKHs', () => {
      persistFilters('pkh1', { ...MARKETPLACE_INITIAL, searchQuery: 'alpha' });
      persistFilters('pkh2', { ...MARKETPLACE_INITIAL, searchQuery: 'beta' });
      clearPersistedFilters('pkh1');
      expect(getPersistedFilters('pkh1')).toBeNull();
      expect(getPersistedFilters('pkh2')!.searchQuery).toBe('beta');
    });
  });

  describe('error paths', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('getPersistedFilters returns null when getItem throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('SecurityError');
      });
      expect(getPersistedFilters('pkh1')).toBeNull();
    });

    it('persistFilters silently swallows quota exceeded error', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });
      expect(() => persistFilters('pkh1', MARKETPLACE_INITIAL)).not.toThrow();
    });

    it('clearPersistedFilters silently swallows errors', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('SecurityError');
      });
      expect(() => clearPersistedFilters('pkh1')).not.toThrow();
    });
  });
});
