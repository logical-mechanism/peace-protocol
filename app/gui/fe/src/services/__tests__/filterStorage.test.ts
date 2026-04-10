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
        categoryFilter: ['document'] as string[],
        hideOwnListings: true,
        dateFrom: '2025-01-01',
        dateTo: '2025-12-31',
        viewMode: 'list' as const,
        priceMin: '5',
        priceMax: '100',
        showFavoritesOnly: true,
        sellerPkh: 'abcdef1234567890',
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

  describe('migration', () => {
    it('migrates legacy string categoryFilter to array', () => {
      // Simulate v1 persisted data with categoryFilter as string
      localStorage.setItem('veiled_marketplace_filters_pkh1', JSON.stringify({
        ...MARKETPLACE_INITIAL,
        categoryFilter: 'audio',
      }));
      const loaded = getPersistedFilters('pkh1');
      expect(loaded).not.toBeNull();
      expect(loaded!.categoryFilter).toEqual(['audio']);
    });

    it('migrates legacy "all" string to ["all"] array', () => {
      localStorage.setItem('veiled_marketplace_filters_pkh1', JSON.stringify({
        categoryFilter: 'all',
      }));
      const loaded = getPersistedFilters('pkh1');
      expect(loaded!.categoryFilter).toEqual(['all']);
    });

    it('leaves array categoryFilter unchanged', () => {
      localStorage.setItem('veiled_marketplace_filters_pkh1', JSON.stringify({
        categoryFilter: ['audio', 'video'],
      }));
      const loaded = getPersistedFilters('pkh1');
      expect(loaded!.categoryFilter).toEqual(['audio', 'video']);
    });

    it('tolerates missing new fields (hideOwnListings, dateFrom, dateTo)', () => {
      // Legacy data has no hideOwnListings/dateFrom/dateTo
      localStorage.setItem('veiled_marketplace_filters_pkh1', JSON.stringify({
        searchQuery: 'test',
        categoryFilter: 'text',
      }));
      const loaded = getPersistedFilters('pkh1');
      expect(loaded).not.toBeNull();
      expect(loaded!.searchQuery).toBe('test');
      expect(loaded!.categoryFilter).toEqual(['text']);
      // Missing fields are simply absent — HYDRATE fills defaults
      expect(loaded!.hideOwnListings).toBeUndefined();
      expect(loaded!.dateFrom).toBeUndefined();
      expect(loaded!.dateTo).toBeUndefined();
    });

    it('tolerates missing cardSize field (v4 → v5 migration)', () => {
      // Legacy data has no cardSize
      localStorage.setItem('veiled_marketplace_filters_pkh1', JSON.stringify({
        searchQuery: 'hello',
        categoryFilter: ['audio'],
        viewMode: 'grid',
      }));
      const loaded = getPersistedFilters('pkh1');
      expect(loaded).not.toBeNull();
      expect(loaded!.searchQuery).toBe('hello');
      // cardSize absent — HYDRATE fills default 'medium'
      expect(loaded!.cardSize).toBeUndefined();
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
