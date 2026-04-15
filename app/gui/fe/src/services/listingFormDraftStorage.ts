/**
 * Listing Form Draft Storage
 *
 * Persists the create-listing form state to localStorage so that
 * if the user accidentally closes the modal they can resume.
 * This covers PRE-UPLOAD form data only; post-upload state is
 * handled by listingDraftStorage.ts (Tauri-backed encrypted).
 */

import { storageGet, storageGetJSON, storageSetJSON, storageRemove } from './storageUtils';

const STORAGE_KEY = 'veiled_listing_form_draft';

export interface ListingFormDraft {
  category: string;
  subcategory?: string;
  nsfw?: boolean;
  secretMessage: string;
  description: string;
  suggestedPrice: string;
  imageLink: string;
  /** Hint only — File objects are not serializable to localStorage. */
  fileName: string | null;
  savedAt: string;
}

/** Save the current form state. */
export function saveListingFormDraft(draft: ListingFormDraft): void {
  storageSetJSON(STORAGE_KEY, draft);
}

/** Load a previously saved form draft, or null if none exists. */
export function getListingFormDraft(): ListingFormDraft | null {
  const parsed = storageGetJSON<ListingFormDraft | null>(STORAGE_KEY, null);
  if (!parsed) return null;
  if (typeof parsed.category !== 'string' || typeof parsed.description !== 'string') {
    return null;
  }
  return parsed;
}

/** Clear the saved form draft (on successful submit or explicit discard). */
export function clearListingFormDraft(): void {
  storageRemove(STORAGE_KEY);
}

/** Check if a saved draft exists (without parsing). */
export function hasListingFormDraft(): boolean {
  return storageGet(STORAGE_KEY) !== null;
}
