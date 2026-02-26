/**
 * Listing Form Draft Storage
 *
 * Persists the create-listing form state to localStorage so that
 * if the user accidentally closes the modal they can resume.
 * This covers PRE-UPLOAD form data only; post-upload state is
 * handled by listingDraftStorage.ts (Tauri-backed encrypted).
 */

const STORAGE_KEY = 'veiled_listing_form_draft';

export interface ListingFormDraft {
  category: string;
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch { /* best-effort */ }
}

/** Load a previously saved form draft, or null if none exists. */
export function getListingFormDraft(): ListingFormDraft | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ListingFormDraft;
    if (typeof parsed.category !== 'string' || typeof parsed.description !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Clear the saved form draft (on successful submit or explicit discard). */
export function clearListingFormDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* best-effort */ }
}

/** Check if a saved draft exists (without parsing). */
export function hasListingFormDraft(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}
