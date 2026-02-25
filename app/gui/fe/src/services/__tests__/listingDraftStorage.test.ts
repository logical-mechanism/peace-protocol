import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  createListingDraft,
  updateListingDraft,
  getListingDraft,
  listListingDrafts,
  removeListingDraft,
  getRecoverableDrafts,
  getOrphanedDrafts,
  type ListingDraft,
} from '../listingDraftStorage';

beforeEach(() => {
  vi.clearAllMocks();
});

function makeDraft(overrides: Partial<ListingDraft> = {}): ListingDraft {
  return {
    id: 'draft-1',
    status: 'uploading',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    category: 'document',
    description: 'Test doc',
    suggestedPrice: '10',
    imageLink: '',
    originalFilename: 'test.pdf',
    originalFileSize: 1024,
    retryCount: 0,
    ...overrides,
  };
}

describe('createListingDraft', () => {
  it('calls invoke with correct command and parameters', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await createListingDraft(
      'draft-1', 'document', 'A test', '5', 'https://img.png', 'file.pdf', 2048
    );

    expect(invoke).toHaveBeenCalledWith('store_listing_draft', {
      id: 'draft-1',
      status: 'uploading',
      category: 'document',
      description: 'A test',
      suggestedPrice: '5',
      imageLink: 'https://img.png',
      originalFilename: 'file.pdf',
      originalFileSize: 2048,
    });
  });
});

describe('updateListingDraft', () => {
  it('JSON-serializes updates and passes to invoke', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await updateListingDraft('draft-1', {
      status: 'uploaded',
      iagonFileId: 'iag_123',
    });

    expect(invoke).toHaveBeenCalledWith('update_listing_draft', {
      id: 'draft-1',
      updatesJson: JSON.stringify({ status: 'uploaded', iagonFileId: 'iag_123' }),
    });
  });

  it('handles lastError set to null', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await updateListingDraft('draft-1', { lastError: null });

    const callArgs = (invoke as ReturnType<typeof vi.fn>).mock.calls[0][1] as { updatesJson: string };
    const parsed = JSON.parse(callArgs.updatesJson);
    expect(parsed.lastError).toBeNull();
  });
});

describe('getListingDraft', () => {
  it('returns draft when found', async () => {
    const draft = makeDraft();
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(draft);

    const result = await getListingDraft('draft-1');
    expect(result).toEqual(draft);
    expect(invoke).toHaveBeenCalledWith('get_listing_draft', { id: 'draft-1' });
  });

  it('returns null when not found', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await getListingDraft('nonexistent');
    expect(result).toBeNull();
  });
});

describe('listListingDrafts', () => {
  it('returns array of drafts', async () => {
    const drafts = [makeDraft(), makeDraft({ id: 'draft-2' })];
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(drafts);

    const result = await listListingDrafts();
    expect(result).toHaveLength(2);
  });
});

describe('removeListingDraft', () => {
  it('calls invoke with correct id', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await removeListingDraft('draft-1');
    expect(invoke).toHaveBeenCalledWith('remove_listing_draft', { id: 'draft-1' });
  });
});

describe('getRecoverableDrafts', () => {
  it('returns drafts with iagonFileId in uploaded/verified/failed status', async () => {
    const drafts = [
      makeDraft({ id: 'd1', status: 'uploaded', iagonFileId: 'iag_1' }),
      makeDraft({ id: 'd2', status: 'verified', iagonFileId: 'iag_2' }),
      makeDraft({ id: 'd3', status: 'failed', iagonFileId: 'iag_3' }),
      makeDraft({ id: 'd4', status: 'uploading', iagonFileId: 'iag_4' }), // excluded: wrong status
      makeDraft({ id: 'd5', status: 'uploaded' }),                          // excluded: no iagonFileId
      makeDraft({ id: 'd6', status: 'confirmed', iagonFileId: 'iag_6' }),  // excluded: wrong status
      makeDraft({ id: 'd7', status: 'abandoned', iagonFileId: 'iag_7' }),  // excluded: wrong status
    ];
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(drafts);

    const result = await getRecoverableDrafts();
    expect(result.map((d) => d.id)).toEqual(['d1', 'd2', 'd3']);
  });

  it('returns empty array when no drafts are recoverable', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeDraft({ status: 'confirmed' }),
    ]);

    const result = await getRecoverableDrafts();
    expect(result).toEqual([]);
  });
});

describe('getOrphanedDrafts', () => {
  it('returns drafts with iagonFileId in failed/abandoned status', async () => {
    const drafts = [
      makeDraft({ id: 'd1', status: 'failed', iagonFileId: 'iag_1' }),
      makeDraft({ id: 'd2', status: 'abandoned', iagonFileId: 'iag_2' }),
      makeDraft({ id: 'd3', status: 'uploaded', iagonFileId: 'iag_3' }),   // excluded: wrong status
      makeDraft({ id: 'd4', status: 'failed' }),                             // excluded: no iagonFileId
    ];
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(drafts);

    const result = await getOrphanedDrafts();
    expect(result.map((d) => d.id)).toEqual(['d1', 'd2']);
  });

  it('returns empty array when no orphaned drafts exist', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await getOrphanedDrafts();
    expect(result).toEqual([]);
  });
});
