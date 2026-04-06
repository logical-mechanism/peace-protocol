import { describe, it, expect } from 'vitest';
import {
  filterListings,
  sortListings,
  countActiveFilters,
  countPanelFilters,
  type FilterParams,
} from '../marketplaceFilters';
import type { EncryptionDisplay } from '../api';

// ── Helpers ──────────────────────────────────────────────────────

function makeListing(overrides: Partial<EncryptionDisplay> = {}): EncryptionDisplay {
  return {
    tokenName: 'abc123',
    seller: 'addr_test1seller',
    sellerPkh: 'aabbcc',
    status: 'active',
    createdAt: '2025-06-01T12:00:00Z',
    suggestedPrice: 5_000_000, // 5 ADA
    category: 'text',
    description: 'A test listing',
    utxo: { txHash: '00'.repeat(32), outputIndex: 0 },
    datum: {} as EncryptionDisplay['datum'],
    ...overrides,
  };
}

const DEFAULT_PARAMS: FilterParams = {
  statusFilter: 'all',
  categoryFilter: ['all'],
  hideOwnListings: false,
  userPkh: 'user123',
  showFavoritesOnly: false,
  favorites: new Set(),
  priceMin: '',
  priceMax: '',
  searchQuery: '',
  dateFrom: '',
  dateTo: '',
};

function params(overrides: Partial<FilterParams> = {}): FilterParams {
  return { ...DEFAULT_PARAMS, ...overrides };
}

// ── filterListings ───────────────────────────────────────────────

describe('filterListings', () => {
  // Use midday timestamps to avoid timezone boundary issues in tests
  const listings = [
    makeListing({ tokenName: 'a1', status: 'active', category: 'audio', sellerPkh: 'user123', suggestedPrice: 2_000_000, createdAt: '2025-01-15T12:00:00Z', description: 'Music file' }),
    makeListing({ tokenName: 'a2', status: 'pending', category: 'video', sellerPkh: 'other456', suggestedPrice: 10_000_000, createdAt: '2025-03-20T12:00:00Z', description: 'Video clip' }),
    makeListing({ tokenName: 'a3', status: 'active', category: 'text', sellerPkh: 'other456', suggestedPrice: 1_000_000, createdAt: '2025-06-01T12:00:00Z', description: 'Short story' }),
    makeListing({ tokenName: 'a4', status: 'active', sellerPkh: 'user123', suggestedPrice: 50_000_000, createdAt: '2025-07-10T12:00:00Z', description: undefined, category: undefined }),
  ];

  it('returns all listings with default params', () => {
    expect(filterListings(listings, params())).toHaveLength(4);
  });

  it('filters by status', () => {
    const result = filterListings(listings, params({ statusFilter: 'pending' }));
    expect(result).toHaveLength(1);
    expect(result[0].tokenName).toBe('a2');
  });

  it('filters by single category', () => {
    const result = filterListings(listings, params({ categoryFilter: ['audio'] }));
    expect(result).toHaveLength(1);
    expect(result[0].tokenName).toBe('a1');
  });

  it('filters by multiple categories', () => {
    const result = filterListings(listings, params({ categoryFilter: ['audio', 'video'] }));
    expect(result).toHaveLength(2);
  });

  it('defaults missing category to text', () => {
    const result = filterListings(listings, params({ categoryFilter: ['text'] }));
    // a3 (explicit text) + a4 (undefined → text)
    expect(result).toHaveLength(2);
  });

  it('categoryFilter [all] returns everything', () => {
    expect(filterListings(listings, params({ categoryFilter: ['all'] }))).toHaveLength(4);
  });

  it('hides own listings when hideOwnListings is true', () => {
    const result = filterListings(listings, params({ hideOwnListings: true }));
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.sellerPkh !== 'user123')).toBe(true);
  });

  it('hideOwnListings is no-op when userPkh is undefined', () => {
    const result = filterListings(listings, params({ hideOwnListings: true, userPkh: undefined }));
    expect(result).toHaveLength(4);
  });

  it('filters by dateFrom', () => {
    const result = filterListings(listings, params({ dateFrom: '2025-06-01' }));
    // a3 (June 1) + a4 (July 10)
    expect(result).toHaveLength(2);
  });

  it('filters by dateTo', () => {
    const result = filterListings(listings, params({ dateTo: '2025-01-15' }));
    expect(result).toHaveLength(1);
    expect(result[0].tokenName).toBe('a1');
  });

  it('filters by dateFrom and dateTo together', () => {
    const result = filterListings(listings, params({ dateFrom: '2025-02-01', dateTo: '2025-06-01' }));
    // a2 (March 20) + a3 (June 1)
    expect(result).toHaveLength(2);
  });

  it('excludes listings with invalid createdAt when dateFrom is set', () => {
    const bad = [makeListing({ tokenName: 'bad', createdAt: '' })];
    expect(filterListings(bad, params({ dateFrom: '2020-01-01' }))).toHaveLength(0);
  });

  it('filters by priceMin', () => {
    const result = filterListings(listings, params({ priceMin: '5' }));
    // a2 (10 ADA) + a4 (50 ADA)
    expect(result).toHaveLength(2);
  });

  it('filters by priceMax', () => {
    const result = filterListings(listings, params({ priceMax: '5' }));
    // a1 (2 ADA) + a3 (1 ADA); a2 (10 ADA) and a4 (50 ADA) excluded
    expect(result).toHaveLength(2);
  });

  it('filters by price range', () => {
    const result = filterListings(listings, params({ priceMin: '2', priceMax: '10' }));
    // a1 (2 ADA) + a2 (10 ADA) + a3 (1 ADA excluded)
    expect(result).toHaveLength(2);
  });

  it('filters favorites only', () => {
    const result = filterListings(listings, params({
      showFavoritesOnly: true,
      favorites: new Set(['a2', 'a4']),
    }));
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.tokenName)).toEqual(['a2', 'a4']);
  });

  it('filters by search query (description)', () => {
    const result = filterListings(listings, params({ searchQuery: 'music' }));
    expect(result).toHaveLength(1);
    expect(result[0].tokenName).toBe('a1');
  });

  it('filters by search query (seller, case-insensitive)', () => {
    const result = filterListings(listings, params({ searchQuery: 'ADDR_TEST1SELLER' }));
    expect(result).toHaveLength(4);
  });

  it('filters by search query (tokenName)', () => {
    const result = filterListings(listings, params({ searchQuery: 'a3' }));
    expect(result).toHaveLength(1);
  });

  it('stacks multiple filters', () => {
    const result = filterListings(listings, params({
      statusFilter: 'active',
      categoryFilter: ['text'],
      hideOwnListings: true,
    }));
    // Only a3: active + text + not user123
    expect(result).toHaveLength(1);
    expect(result[0].tokenName).toBe('a3');
  });
});

// ── sortListings ─────────────────────────────────────────────────

describe('sortListings', () => {
  const listings = [
    makeListing({ tokenName: 'b1', createdAt: '2025-03-01T00:00:00Z', suggestedPrice: 5_000_000, description: 'Banana' }),
    makeListing({ tokenName: 'b2', createdAt: '2025-01-01T00:00:00Z', suggestedPrice: 10_000_000, description: 'Apple' }),
    makeListing({ tokenName: 'b3', createdAt: '2025-06-01T00:00:00Z', suggestedPrice: undefined, description: 'Cherry' }),
  ];
  const bidMap = new Map([['b1', 2], ['b2', 5], ['b3', 0]]);

  it('sorts newest first', () => {
    const result = sortListings(listings, 'newest', bidMap);
    expect(result.map((e) => e.tokenName)).toEqual(['b3', 'b1', 'b2']);
  });

  it('sorts oldest first', () => {
    const result = sortListings(listings, 'oldest', bidMap);
    expect(result.map((e) => e.tokenName)).toEqual(['b2', 'b1', 'b3']);
  });

  it('sorts price high to low (null prices last)', () => {
    const result = sortListings(listings, 'price-high', bidMap);
    expect(result.map((e) => e.tokenName)).toEqual(['b2', 'b1', 'b3']);
  });

  it('sorts price low to high (null prices last)', () => {
    const result = sortListings(listings, 'price-low', bidMap);
    expect(result.map((e) => e.tokenName)).toEqual(['b1', 'b2', 'b3']);
  });

  it('sorts by most bids', () => {
    const result = sortListings(listings, 'most-bids', bidMap);
    expect(result.map((e) => e.tokenName)).toEqual(['b2', 'b1', 'b3']);
  });

  it('sorts alpha-asc by description', () => {
    const result = sortListings(listings, 'alpha-asc', bidMap);
    expect(result.map((e) => e.description)).toEqual(['Apple', 'Banana', 'Cherry']);
  });

  it('sorts alpha-desc by description', () => {
    const result = sortListings(listings, 'alpha-desc', bidMap);
    expect(result.map((e) => e.description)).toEqual(['Cherry', 'Banana', 'Apple']);
  });

  it('alpha sort falls back to tokenName when description is missing', () => {
    const items = [
      makeListing({ tokenName: 'zzz', description: undefined }),
      makeListing({ tokenName: 'aaa', description: undefined }),
    ];
    const result = sortListings(items, 'alpha-asc', new Map());
    expect(result.map((e) => e.tokenName)).toEqual(['aaa', 'zzz']);
  });

  it('does not mutate the input array', () => {
    const original = [...listings];
    sortListings(listings, 'newest', bidMap);
    expect(listings.map((e) => e.tokenName)).toEqual(original.map((e) => e.tokenName));
  });
});

// ── countActiveFilters / countPanelFilters ────────────────────────

describe('countActiveFilters', () => {
  it('returns 0 for default params', () => {
    expect(countActiveFilters(params())).toBe(0);
  });

  it('counts search', () => {
    expect(countActiveFilters(params({ searchQuery: 'hello' }))).toBe(1);
  });

  it('counts each filter independently', () => {
    expect(countActiveFilters(params({ statusFilter: 'active' }))).toBe(1);
    expect(countActiveFilters(params({ categoryFilter: ['audio'] }))).toBe(1);
    expect(countActiveFilters(params({ hideOwnListings: true }))).toBe(1);
    expect(countActiveFilters(params({ dateFrom: '2025-01-01' }))).toBe(1);
    expect(countActiveFilters(params({ dateTo: '2025-12-31' }))).toBe(1);
    expect(countActiveFilters(params({ priceMin: '5' }))).toBe(1);
    expect(countActiveFilters(params({ priceMax: '50' }))).toBe(1);
    expect(countActiveFilters(params({ showFavoritesOnly: true }))).toBe(1);
  });

  it('counts multiple active filters', () => {
    expect(countActiveFilters(params({
      searchQuery: 'test',
      statusFilter: 'pending',
      hideOwnListings: true,
    }))).toBe(3);
  });
});

describe('countPanelFilters', () => {
  it('returns 0 for default params', () => {
    expect(countPanelFilters(params())).toBe(0);
  });

  it('does not count search (excluded from panel)', () => {
    expect(countPanelFilters(params({ searchQuery: 'hello' }))).toBe(0);
  });

  it('counts panel-relevant filters', () => {
    expect(countPanelFilters(params({ statusFilter: 'active', hideOwnListings: true }))).toBe(2);
  });
});
