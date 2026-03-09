/**
 * Bid Form Draft Storage
 *
 * Persists the place-bid form state to localStorage so that
 * if a submission fails the user can retry without re-entering data.
 * Follows the same pattern as listingFormDraftStorage.ts.
 */

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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch { /* best-effort */ }
}

/** Load a previously saved bid form draft for a specific encryption token, or null. */
export function getBidFormDraft(encryptionTokenName: string): BidFormDraft | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BidFormDraft;
    if (
      typeof parsed.encryptionTokenName !== 'string' ||
      typeof parsed.bidAmount !== 'string' ||
      parsed.encryptionTokenName !== encryptionTokenName
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Clear the saved bid form draft (on successful submit or explicit discard). */
export function clearBidFormDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* best-effort */ }
}

/** Check if a saved draft exists for a specific encryption token (without full parsing). */
export function hasBidFormDraft(encryptionTokenName: string): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as BidFormDraft;
    return parsed.encryptionTokenName === encryptionTokenName;
  } catch {
    return false;
  }
}
