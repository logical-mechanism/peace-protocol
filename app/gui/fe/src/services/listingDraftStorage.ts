/**
 * Listing Draft Storage Service
 *
 * Persists multi-step listing creation state so the expensive Iagon upload
 * never needs to repeat on retry or crash recovery. Each draft tracks the
 * full lifecycle: encrypting → uploading → verified → signing → submitted →
 * confirmed/failed/abandoned.
 *
 * Storage is backed by encrypted JSON files in the Tauri app data directory
 * (secrets/listing-drafts/{draftId}.json), which persists across WebView
 * resets unlike IndexedDB in WebKitGTK.
 */

import { invoke } from '@tauri-apps/api/core';

// ── Types ────────────────────────────────────────────────────────────────

export type ListingDraftStatus =
  | 'uploading'
  | 'uploaded'
  | 'verified'
  | 'signing'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'abandoned';

export interface ListingDraft {
  id: string;
  status: ListingDraftStatus;
  createdAt: string;
  updatedAt: string;
  // Form data
  category: string;
  nsfw?: boolean;
  description: string;
  suggestedPrice: string;
  imageLink: string;
  originalFilename: string;
  originalFileSize: number;
  // Iagon upload result
  iagonFileId?: string;
  iagonFilename?: string;
  // File encryption keys (hex strings)
  fileKey?: string;
  fileNonce?: string;
  fileDigest?: string;
  // Original file extension (e.g. ".mp3", ".pdf")
  fileExtension?: string;
  // Transaction details
  tokenName?: string;
  txHash?: string;
  // Error tracking
  lastError?: string;
  retryCount: number;
}

export type ListingDraftUpdates = Partial<
  Pick<
    ListingDraft,
    | 'status'
    | 'iagonFileId'
    | 'iagonFilename'
    | 'fileKey'
    | 'fileNonce'
    | 'fileDigest'
    | 'fileExtension'
    | 'tokenName'
    | 'txHash'
    | 'retryCount'
  >
> & {
  /** Set to null to clear the error, or a string to set it. */
  lastError?: string | null;
};

// ── Storage Operations ───────────────────────────────────────────────────

/**
 * Create a new listing draft at the start of a file listing creation.
 */
export async function createListingDraft(
  id: string,
  category: string,
  description: string,
  suggestedPrice: string,
  imageLink: string,
  originalFilename: string,
  originalFileSize: number
): Promise<void> {
  await invoke('store_listing_draft', {
    id,
    status: 'uploading',
    category,
    description,
    suggestedPrice,
    imageLink,
    originalFilename,
    originalFileSize,
  });
}

/**
 * Update specific fields on an existing draft.
 */
export async function updateListingDraft(
  id: string,
  updates: ListingDraftUpdates
): Promise<void> {
  await invoke('update_listing_draft', {
    id,
    updatesJson: JSON.stringify(updates),
  });
}

/**
 * Retrieve a listing draft by ID.
 */
export async function getListingDraft(
  id: string
): Promise<ListingDraft | null> {
  return invoke<ListingDraft | null>('get_listing_draft', { id });
}

/**
 * List all listing drafts (for recovery and cleanup).
 */
export async function listListingDrafts(): Promise<ListingDraft[]> {
  return invoke<ListingDraft[]>('list_listing_drafts');
}

/**
 * Remove a listing draft (after confirmed or abandoned + cleaned up).
 */
export async function removeListingDraft(id: string): Promise<void> {
  await invoke('remove_listing_draft', { id });
}

// ── Query Helpers ────────────────────────────────────────────────────────

/**
 * Find drafts that are recoverable (uploaded/verified/failed with an Iagon file).
 */
export async function getRecoverableDrafts(): Promise<ListingDraft[]> {
  const all = await listListingDrafts();
  return all.filter(
    (d) =>
      d.iagonFileId &&
      (d.status === 'uploaded' ||
        d.status === 'verified' ||
        d.status === 'failed')
  );
}

/**
 * Find drafts that have orphaned Iagon files (failed/abandoned with an Iagon file ID).
 */
export async function getOrphanedDrafts(): Promise<ListingDraft[]> {
  const all = await listListingDrafts();
  return all.filter(
    (d) =>
      d.iagonFileId &&
      (d.status === 'failed' || d.status === 'abandoned')
  );
}
