/**
 * Marketplace Favorites Service
 *
 * Persists favorited listing token names in localStorage, keyed by wallet PKH.
 * Used by MarketplaceTab to filter/highlight bookmarked listings.
 */

const STORAGE_KEY_PREFIX = 'veiled_favorites_';

function getStorageKey(userPkh: string): string {
  return STORAGE_KEY_PREFIX + userPkh;
}

export function getFavorites(userPkh: string): Set<string> {
  try {
    const raw = localStorage.getItem(getStorageKey(userPkh));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

/**
 * Toggle a listing's favorite status. Returns true if now favorited, false if removed.
 */
export function toggleFavorite(userPkh: string, tokenName: string): boolean {
  const favs = getFavorites(userPkh);
  if (favs.has(tokenName)) {
    favs.delete(tokenName);
    localStorage.setItem(getStorageKey(userPkh), JSON.stringify([...favs]));
    return false;
  } else {
    favs.add(tokenName);
    localStorage.setItem(getStorageKey(userPkh), JSON.stringify([...favs]));
    return true;
  }
}

export function clearFavorites(userPkh: string): void {
  localStorage.removeItem(getStorageKey(userPkh));
}
