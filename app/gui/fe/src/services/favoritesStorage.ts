/**
 * Marketplace Favorites Service
 *
 * Persists favorited listing token names in localStorage, keyed by wallet PKH.
 * Used by MarketplaceTab to filter/highlight bookmarked listings.
 */

import { storageGetJSON, storageSetJSON, storageRemove } from './storageUtils';

const STORAGE_KEY_PREFIX = 'veiled_favorites_';

function getStorageKey(userPkh: string): string {
  return STORAGE_KEY_PREFIX + userPkh;
}

export function getFavorites(userPkh: string): Set<string> {
  const arr = storageGetJSON<string[]>(getStorageKey(userPkh), []);
  return new Set(arr);
}

/**
 * Toggle a listing's favorite status. Returns true if now favorited, false if removed.
 */
export function toggleFavorite(userPkh: string, tokenName: string): boolean {
  const favs = getFavorites(userPkh);
  if (favs.has(tokenName)) {
    favs.delete(tokenName);
    storageSetJSON(getStorageKey(userPkh), [...favs]);
    return false;
  } else {
    favs.add(tokenName);
    storageSetJSON(getStorageKey(userPkh), [...favs]);
    return true;
  }
}

export function clearFavorites(userPkh: string): void {
  storageRemove(getStorageKey(userPkh));
}
