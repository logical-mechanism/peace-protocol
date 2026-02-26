import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveBidFormDraft,
  getBidFormDraft,
  clearBidFormDraft,
  hasBidFormDraft,
  type BidFormDraft,
} from '../bidFormDraftStorage';

const STORAGE_KEY = 'veiled_bid_form_draft';

const baseDraft: BidFormDraft = {
  encryptionTokenName: 'abc123',
  bidAmount: '50',
  futurePrice: '60',
  showFuturePrice: true,
  savedAt: '2024-06-15T10:00:00Z',
};

beforeEach(() => {
  localStorage.clear();
});

describe('saveBidFormDraft', () => {
  it('persists draft to localStorage', () => {
    saveBidFormDraft(baseDraft);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual(baseDraft);
  });

  it('overwrites previous draft', () => {
    saveBidFormDraft(baseDraft);
    const updated = { ...baseDraft, bidAmount: '100' };
    saveBidFormDraft(updated);
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.bidAmount).toBe('100');
  });
});

describe('getBidFormDraft', () => {
  it('returns draft when token matches', () => {
    saveBidFormDraft(baseDraft);
    const result = getBidFormDraft('abc123');
    expect(result).toEqual(baseDraft);
  });

  it('returns null when token does not match', () => {
    saveBidFormDraft(baseDraft);
    const result = getBidFormDraft('xyz789');
    expect(result).toBeNull();
  });

  it('returns null when no draft exists', () => {
    expect(getBidFormDraft('abc123')).toBeNull();
  });

  it('returns null for corrupted data', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json{{{');
    expect(getBidFormDraft('abc123')).toBeNull();
  });

  it('returns null for data missing required fields', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 'bar' }));
    expect(getBidFormDraft('abc123')).toBeNull();
  });

  it('returns null when encryptionTokenName is not a string', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ encryptionTokenName: 42, bidAmount: '5' }));
    expect(getBidFormDraft('abc123')).toBeNull();
  });
});

describe('clearBidFormDraft', () => {
  it('removes draft from localStorage', () => {
    saveBidFormDraft(baseDraft);
    clearBidFormDraft();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('does not throw when no draft exists', () => {
    expect(() => clearBidFormDraft()).not.toThrow();
  });
});

describe('hasBidFormDraft', () => {
  it('returns true when draft exists for matching token', () => {
    saveBidFormDraft(baseDraft);
    expect(hasBidFormDraft('abc123')).toBe(true);
  });

  it('returns false when draft exists for different token', () => {
    saveBidFormDraft(baseDraft);
    expect(hasBidFormDraft('xyz789')).toBe(false);
  });

  it('returns false when no draft exists', () => {
    expect(hasBidFormDraft('abc123')).toBe(false);
  });

  it('returns false for corrupted data', () => {
    localStorage.setItem(STORAGE_KEY, '{broken');
    expect(hasBidFormDraft('abc123')).toBe(false);
  });
});
