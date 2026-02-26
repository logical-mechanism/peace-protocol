/**
 * Marketplace Filter Persistence Service
 *
 * Persists marketplace filter state in localStorage, keyed by wallet PKH.
 * Each wallet gets independent filter preferences that survive app restarts.
 */

import type { MarketplaceFilters } from '../hooks/useTabFilterState';

const STORAGE_KEY_PREFIX = 'veiled_marketplace_filters_';

function getStorageKey(userPkh: string): string {
  return STORAGE_KEY_PREFIX + userPkh;
}

export function getPersistedFilters(userPkh: string): Partial<MarketplaceFilters> | null {
  try {
    const raw = localStorage.getItem(getStorageKey(userPkh));
    if (!raw) return null;
    return JSON.parse(raw) as Partial<MarketplaceFilters>;
  } catch {
    return null;
  }
}

export function persistFilters(userPkh: string, filters: MarketplaceFilters): void {
  try {
    localStorage.setItem(getStorageKey(userPkh), JSON.stringify(filters));
  } catch { /* best-effort */ }
}

export function clearPersistedFilters(userPkh: string): void {
  try {
    localStorage.removeItem(getStorageKey(userPkh));
  } catch { /* best-effort */ }
}
