import type { EncryptionDisplay } from './api';
import type { MarketplaceFilters } from '../hooks/useTabFilterState';

// ── Filter params ────────────────────────────────────────────────

export interface FilterParams {
  statusFilter: MarketplaceFilters['statusFilter'];
  categoryFilter: string[];
  sellerFilter: MarketplaceFilters['sellerFilter'];
  userPkh: string | undefined;
  showFavoritesOnly: boolean;
  favorites: Set<string>;
  priceMin: string;
  priceMax: string;
  searchQuery: string;
  dateFrom: string;
  dateTo: string;
}

export type SortKey = MarketplaceFilters['sortBy'];

// ── Filter listings ──────────────────────────────────────────────

export function filterListings(
  listings: EncryptionDisplay[],
  params: FilterParams,
): EncryptionDisplay[] {
  let result = listings;

  if (params.statusFilter !== 'all') {
    result = result.filter((e) => e.status === params.statusFilter);
  }

  if (!params.categoryFilter.includes('all')) {
    result = result.filter((e) =>
      params.categoryFilter.includes(e.category || 'text'),
    );
  }

  if (params.sellerFilter !== 'all' && params.userPkh) {
    if (params.sellerFilter === 'mine') {
      result = result.filter((e) => e.sellerPkh === params.userPkh);
    } else {
      result = result.filter((e) => e.sellerPkh !== params.userPkh);
    }
  }

  if (params.showFavoritesOnly) {
    result = result.filter((e) => params.favorites.has(e.tokenName));
  }

  if (params.priceMin !== '' || params.priceMax !== '') {
    const min = params.priceMin !== '' ? Number(params.priceMin) : -Infinity;
    const max = params.priceMax !== '' ? Number(params.priceMax) : Infinity;
    if (!isNaN(min) && !isNaN(max)) {
      result = result.filter((e) => {
        const price = (e.suggestedPrice ?? 0) / 1_000_000;
        return price >= min && price <= max;
      });
    }
  }

  if (params.dateFrom) {
    const fromTime = new Date(params.dateFrom).getTime();
    if (!isNaN(fromTime)) {
      result = result.filter((e) => {
        const t = new Date(e.createdAt ?? '').getTime();
        return !isNaN(t) && t >= fromTime;
      });
    }
  }

  if (params.dateTo) {
    // End of the selected day (23:59:59.999)
    const toTime = new Date(params.dateTo).getTime() + 86_400_000 - 1;
    if (!isNaN(toTime)) {
      result = result.filter((e) => {
        const t = new Date(e.createdAt ?? '').getTime();
        return !isNaN(t) && t <= toTime;
      });
    }
  }

  if (params.searchQuery.trim()) {
    const query = params.searchQuery.toLowerCase();
    result = result.filter(
      (e) =>
        e.tokenName.toLowerCase().includes(query) ||
        e.seller.toLowerCase().includes(query) ||
        (e.description && e.description.toLowerCase().includes(query)),
    );
  }

  return result;
}

// ── Sort listings ────────────────────────────────────────────────

function safeTime(d: string): number {
  const t = new Date(d ?? '').getTime();
  return isNaN(t) ? 0 : t;
}

function safePrice(p: number | undefined | null, fallback: number): number {
  if (p == null) return fallback;
  const n = Number(p);
  return isNaN(n) ? fallback : n;
}

export function sortListings(
  listings: EncryptionDisplay[],
  sortBy: SortKey,
  bidCountMap: Map<string, number>,
): EncryptionDisplay[] {
  const result = [...listings];

  switch (sortBy) {
    case 'newest':
      result.sort((a, b) => safeTime(b.createdAt) - safeTime(a.createdAt));
      break;
    case 'oldest':
      result.sort((a, b) => safeTime(a.createdAt) - safeTime(b.createdAt));
      break;
    case 'price-high':
      result.sort((a, b) => safePrice(b.suggestedPrice, -Infinity) - safePrice(a.suggestedPrice, -Infinity));
      break;
    case 'price-low':
      result.sort((a, b) => safePrice(a.suggestedPrice, Infinity) - safePrice(b.suggestedPrice, Infinity));
      break;
    case 'most-bids':
      result.sort((a, b) => (bidCountMap.get(b.tokenName) ?? 0) - (bidCountMap.get(a.tokenName) ?? 0));
      break;
    case 'alpha-asc':
      result.sort((a, b) => (a.description || a.tokenName).localeCompare(b.description || b.tokenName));
      break;
    case 'alpha-desc':
      result.sort((a, b) => (b.description || b.tokenName).localeCompare(a.description || a.tokenName));
      break;
  }

  return result;
}

// ── Active filter counting ───────────────────────────────────────

function isCategoryDefault(categoryFilter: string[]): boolean {
  return categoryFilter.length === 1 && categoryFilter[0] === 'all';
}

export function countActiveFilters(params: FilterParams): number {
  let count = 0;
  if (params.searchQuery !== '') count++;
  if (params.statusFilter !== 'all') count++;
  if (!isCategoryDefault(params.categoryFilter)) count++;
  if (params.sellerFilter !== 'all') count++;
  if (params.dateFrom !== '') count++;
  if (params.dateTo !== '') count++;
  if (params.priceMin !== '') count++;
  if (params.priceMax !== '') count++;
  if (params.showFavoritesOnly) count++;
  return count;
}

export function countPanelFilters(params: FilterParams): number {
  let count = 0;
  if (params.statusFilter !== 'all') count++;
  if (!isCategoryDefault(params.categoryFilter)) count++;
  if (params.sellerFilter !== 'all') count++;
  if (params.dateFrom !== '') count++;
  if (params.dateTo !== '') count++;
  if (params.priceMin !== '') count++;
  if (params.priceMax !== '') count++;
  if (params.showFavoritesOnly) count++;
  return count;
}
