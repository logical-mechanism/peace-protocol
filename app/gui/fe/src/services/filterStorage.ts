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

/** Migrate legacy persisted filter shapes to the current format. */
function migrateFilters(raw: Record<string, unknown>): Partial<MarketplaceFilters> {
  const migrated = { ...raw };

  // v1 → v2: categoryFilter was a single string, now string[]
  if (typeof migrated.categoryFilter === 'string') {
    migrated.categoryFilter = [migrated.categoryFilter as string];
  }

  // New fields (sellerFilter, dateFrom, dateTo) are simply absent in legacy
  // data — HYDRATE fills defaults from MARKETPLACE_INITIAL, so no action needed.

  return migrated as Partial<MarketplaceFilters>;
}

export function getPersistedFilters(userPkh: string): Partial<MarketplaceFilters> | null {
  const raw = storageGetJSON<Record<string, unknown> | null>(getStorageKey(userPkh), null);
  if (!raw) return null;
  return migrateFilters(raw);
}

export function persistFilters(userPkh: string, filters: MarketplaceFilters): void {
  storageSetJSON(getStorageKey(userPkh), filters);
}

export function clearPersistedFilters(userPkh: string): void {
  storageRemove(getStorageKey(userPkh));
}
