import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  saveListingFormDraft,
  getListingFormDraft,
  clearListingFormDraft,
  hasListingFormDraft,
  type ListingFormDraft,
} from '../listingFormDraftStorage';

const makeDraft = (overrides?: Partial<ListingFormDraft>): ListingFormDraft => ({
  category: 'document',
  secretMessage: '',
  description: 'My document listing',
  suggestedPrice: '50',
  imageLink: 'https://example.com/img.png',
  fileName: 'report.pdf',
  savedAt: '2025-06-01T12:00:00Z',
  ...overrides,
});

describe('listingFormDraftStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('getListingFormDraft returns null when nothing stored', () => {
    expect(getListingFormDraft()).toBeNull();
  });

  it('hasListingFormDraft returns false when nothing stored', () => {
    expect(hasListingFormDraft()).toBe(false);
  });

  it('saveListingFormDraft/getListingFormDraft roundtrip', () => {
    const draft = makeDraft();
    saveListingFormDraft(draft);
    expect(getListingFormDraft()).toEqual(draft);
  });

  it('hasListingFormDraft returns true after save', () => {
    saveListingFormDraft(makeDraft());
    expect(hasListingFormDraft()).toBe(true);
  });

  it('clearListingFormDraft removes the stored draft', () => {
    saveListingFormDraft(makeDraft());
    expect(hasListingFormDraft()).toBe(true);
    clearListingFormDraft();
    expect(getListingFormDraft()).toBeNull();
    expect(hasListingFormDraft()).toBe(false);
  });

  it('preserves text mode drafts with secretMessage', () => {
    const draft = makeDraft({
      category: 'text',
      secretMessage: 'my secret content',
      description: 'A text listing',
      fileName: null,
    });
    saveListingFormDraft(draft);
    expect(getListingFormDraft()).toEqual(draft);
  });

  it('preserves drafts with empty optional fields', () => {
    const draft = makeDraft({
      suggestedPrice: '',
      imageLink: '',
      fileName: null,
    });
    saveListingFormDraft(draft);
    expect(getListingFormDraft()).toEqual(draft);
  });

  it('overwrites a previous draft on save', () => {
    saveListingFormDraft(makeDraft({ description: 'first' }));
    saveListingFormDraft(makeDraft({ description: 'second' }));
    expect(getListingFormDraft()?.description).toBe('second');
  });

  it('returns null for corrupted localStorage data', () => {
    localStorage.setItem('veiled_listing_form_draft', 'not json');
    expect(getListingFormDraft()).toBeNull();
  });

  it('returns null for malformed draft (missing required fields)', () => {
    localStorage.setItem('veiled_listing_form_draft', JSON.stringify({ foo: 'bar' }));
    expect(getListingFormDraft()).toBeNull();
  });

  it('returns null for draft with wrong field types', () => {
    localStorage.setItem(
      'veiled_listing_form_draft',
      JSON.stringify({ category: 123, description: true })
    );
    expect(getListingFormDraft()).toBeNull();
  });

  describe('error paths', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('saveListingFormDraft silently swallows quota exceeded error', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });
      expect(() => saveListingFormDraft(makeDraft())).not.toThrow();
    });

    it('getListingFormDraft returns null when getItem throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('SecurityError');
      });
      expect(getListingFormDraft()).toBeNull();
    });

    it('clearListingFormDraft silently swallows errors', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('SecurityError');
      });
      expect(() => clearListingFormDraft()).not.toThrow();
    });

    it('hasListingFormDraft returns false when getItem throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('SecurityError');
      });
      expect(hasListingFormDraft()).toBe(false);
    });
  });
});
