/**
 * Bid Form Draft Storage
 *
 * Persists the place-bid form state to localStorage so that
 * if a submission fails the user can retry without re-entering data.
 * Follows the same pattern as listingFormDraftStorage.ts.
 */

import { storageGetJSON, storageSetJSON, storageRemove } from './storageUtils';

const STORAGE_KEY = 'veiled_bid_form_draft';

export interface BidFormDraft {
  encryptionTokenName: string;
  bidAmount: string;
  futurePrice: string;
  showFuturePrice: boolean;
  savedAt: string;
}

/** Save the current bid form state. */
export function saveBidFormDraft(draft: BidFormDraft): void {
  storageSetJSON(STORAGE_KEY, draft);
}

/** Load a previously saved bid form draft for a specific encryption token, or null. */
export function getBidFormDraft(encryptionTokenName: string): BidFormDraft | null {
  const parsed = storageGetJSON<BidFormDraft | null>(STORAGE_KEY, null);
  if (!parsed) return null;
  if (
    typeof parsed.encryptionTokenName !== 'string' ||
    typeof parsed.bidAmount !== 'string' ||
    parsed.encryptionTokenName !== encryptionTokenName
  ) {
    return null;
  }
  return parsed;
}

/** Clear the saved bid form draft (on successful submit or explicit discard). */
export function clearBidFormDraft(): void {
  storageRemove(STORAGE_KEY);
}

/** Check if a saved draft exists for a specific encryption token (without full parsing). */
export function hasBidFormDraft(encryptionTokenName: string): boolean {
  const parsed = storageGetJSON<BidFormDraft | null>(STORAGE_KEY, null);
  if (!parsed) return false;
  return parsed.encryptionTokenName === encryptionTokenName;
}
