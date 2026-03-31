/**
 * Marketplace Filter Persistence Service
 *
 * Persists marketplace filter state in localStorage, keyed by wallet PKH.
 * Each wallet gets independent filter preferences that survive app restarts.
 */

import { storageGetJSON, storageSetJSON, storageRemove } from './storageUtils';
import type { MarketplaceFilters } from '../hooks/useTabFilterState';

const STORAGE_KEY_PREFIX = 'veiled_marketplace_filters_';

function getStorageKey(userPkh: string): string {
  return STORAGE_KEY_PREFIX + userPkh;
}

export function getPersistedFilters(userPkh: string): Partial<MarketplaceFilters> | null {
  return storageGetJSON<Partial<MarketplaceFilters> | null>(getStorageKey(userPkh), null);
}

export function persistFilters(userPkh: string, filters: MarketplaceFilters): void {
  storageSetJSON(getStorageKey(userPkh), filters);
}

export function clearPersistedFilters(userPkh: string): void {
  storageRemove(getStorageKey(userPkh));
}
