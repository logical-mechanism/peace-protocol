/**
 * Bid Notification Service
 *
 * Persists "seen" bid state in localStorage, keyed by seller PKH.
 * Used by useBidNotifications hook to detect new bids across sessions.
 */

const STORAGE_KEY_PREFIX = 'veiled_seen_bids_';

export interface SeenBidsState {
  /** Bid token names the seller has already seen */
  seenBidTokens: string[];
  /** Timestamp of last successful bid check */
  lastCheckedAt: number;
  /** Total bid count at last check (for quick comparison before full diff) */
  lastKnownBidCount: number;
}

function getStorageKey(sellerPkh: string): string {
  return STORAGE_KEY_PREFIX + sellerPkh;
}

const EMPTY_STATE: SeenBidsState = {
  seenBidTokens: [],
  lastCheckedAt: 0,
  lastKnownBidCount: -1, // sentinel: never checked
};

/**
 * Read the persisted seen-bids state for a seller.
 */
export function getSeenBidsState(sellerPkh: string): SeenBidsState {
  try {
    const raw = localStorage.getItem(getStorageKey(sellerPkh));
    if (!raw) return { ...EMPTY_STATE };
    return JSON.parse(raw) as SeenBidsState;
  } catch {
    return { ...EMPTY_STATE };
  }
}

/**
 * Persist the seen-bids state.
 */
export function setSeenBidsState(sellerPkh: string, state: SeenBidsState): void {
  localStorage.setItem(getStorageKey(sellerPkh), JSON.stringify(state));
}

/**
 * Compute bid token names that the seller hasn't seen yet.
 */
export function getUnseenBids(sellerPkh: string, currentBidTokenNames: string[]): string[] {
  const state = getSeenBidsState(sellerPkh);
  const seenSet = new Set(state.seenBidTokens);
  return currentBidTokenNames.filter(name => !seenSet.has(name));
}

/**
 * Mark ALL current bids as seen. Called when user views the My Sales tab.
 */
export function markAllBidsAsSeen(sellerPkh: string, allBidTokenNames: string[]): void {
  setSeenBidsState(sellerPkh, {
    seenBidTokens: allBidTokenNames,
    lastCheckedAt: Date.now(),
    lastKnownBidCount: allBidTokenNames.length,
  });
}

/**
 * Mark specific additional bid token names as seen (e.g. when viewing a listing's bids).
 */
export function markBidsAsSeen(sellerPkh: string, bidTokenNames: string[]): void {
  const state = getSeenBidsState(sellerPkh);
  const seenSet = new Set(state.seenBidTokens);
  for (const name of bidTokenNames) {
    seenSet.add(name);
  }
  state.seenBidTokens = Array.from(seenSet);
  state.lastCheckedAt = Date.now();
  setSeenBidsState(sellerPkh, state);
}

/**
 * Clear notification state (e.g. on wallet disconnect).
 */
export function clearSeenBidsState(sellerPkh: string): void {
  localStorage.removeItem(getStorageKey(sellerPkh));
}
