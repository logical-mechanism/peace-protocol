import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSeenBidsState,
  setSeenBidsState,
  getUnseenBids,
  markAllBidsAsSeen,
  markBidsAsSeen,
  clearSeenBidsState,
} from '../bidNotifications';

const SELLER = 'abc123pkh';

describe('bidNotifications', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // --- getSeenBidsState ---

  it('getSeenBidsState returns empty state for unknown PKH', () => {
    const state = getSeenBidsState('unknown');
    expect(state.seenBidTokens).toEqual([]);
    expect(state.lastCheckedAt).toBe(0);
    expect(state.lastKnownBidCount).toBe(-1);
  });

  it('getSeenBidsState returns empty state for corrupted JSON', () => {
    localStorage.setItem('veiled_seen_bids_' + SELLER, '{broken');
    const state = getSeenBidsState(SELLER);
    expect(state.seenBidTokens).toEqual([]);
    expect(state.lastKnownBidCount).toBe(-1);
  });

  // --- setSeenBidsState / getSeenBidsState roundtrip ---

  it('setSeenBidsState persists and getSeenBidsState retrieves', () => {
    const state = {
      seenBidTokens: ['bid_a', 'bid_b'],
      lastCheckedAt: 1700000000,
      lastKnownBidCount: 2,
    };
    setSeenBidsState(SELLER, state);
    expect(getSeenBidsState(SELLER)).toEqual(state);
  });

  // --- getUnseenBids ---

  it('getUnseenBids returns all bids when none seen', () => {
    const unseen = getUnseenBids(SELLER, ['bid_a', 'bid_b', 'bid_c']);
    expect(unseen).toEqual(['bid_a', 'bid_b', 'bid_c']);
  });

  it('getUnseenBids returns only new bids', () => {
    setSeenBidsState(SELLER, {
      seenBidTokens: ['bid_a', 'bid_b'],
      lastCheckedAt: Date.now(),
      lastKnownBidCount: 2,
    });
    const unseen = getUnseenBids(SELLER, ['bid_a', 'bid_b', 'bid_c', 'bid_d']);
    expect(unseen).toEqual(['bid_c', 'bid_d']);
  });

  it('getUnseenBids returns empty when all seen', () => {
    setSeenBidsState(SELLER, {
      seenBidTokens: ['bid_a', 'bid_b'],
      lastCheckedAt: Date.now(),
      lastKnownBidCount: 2,
    });
    const unseen = getUnseenBids(SELLER, ['bid_a', 'bid_b']);
    expect(unseen).toEqual([]);
  });

  it('getUnseenBids handles bids removed from chain (seen but no longer current)', () => {
    setSeenBidsState(SELLER, {
      seenBidTokens: ['bid_a', 'bid_b', 'bid_c'],
      lastCheckedAt: Date.now(),
      lastKnownBidCount: 3,
    });
    // bid_b was consumed (accepted/cancelled), bid_d is new
    const unseen = getUnseenBids(SELLER, ['bid_a', 'bid_c', 'bid_d']);
    expect(unseen).toEqual(['bid_d']);
  });

  // --- markAllBidsAsSeen ---

  it('markAllBidsAsSeen updates state with all tokens', () => {
    markAllBidsAsSeen(SELLER, ['bid_x', 'bid_y', 'bid_z']);
    const state = getSeenBidsState(SELLER);
    expect(state.seenBidTokens).toEqual(['bid_x', 'bid_y', 'bid_z']);
    expect(state.lastKnownBidCount).toBe(3);
    expect(state.lastCheckedAt).toBeGreaterThan(0);
  });

  it('markAllBidsAsSeen clears previous unseen state', () => {
    // Start with bid_a seen
    setSeenBidsState(SELLER, {
      seenBidTokens: ['bid_a'],
      lastCheckedAt: 1000,
      lastKnownBidCount: 1,
    });
    // Mark all current bids as seen
    markAllBidsAsSeen(SELLER, ['bid_a', 'bid_b', 'bid_c']);
    const unseen = getUnseenBids(SELLER, ['bid_a', 'bid_b', 'bid_c']);
    expect(unseen).toEqual([]);
  });

  // --- markBidsAsSeen ---

  it('markBidsAsSeen adds specific tokens to seen set', () => {
    setSeenBidsState(SELLER, {
      seenBidTokens: ['bid_a'],
      lastCheckedAt: 1000,
      lastKnownBidCount: 1,
    });
    markBidsAsSeen(SELLER, ['bid_b', 'bid_c']);
    const state = getSeenBidsState(SELLER);
    expect(state.seenBidTokens).toContain('bid_a');
    expect(state.seenBidTokens).toContain('bid_b');
    expect(state.seenBidTokens).toContain('bid_c');
  });

  it('markBidsAsSeen does not duplicate existing tokens', () => {
    setSeenBidsState(SELLER, {
      seenBidTokens: ['bid_a', 'bid_b'],
      lastCheckedAt: 1000,
      lastKnownBidCount: 2,
    });
    markBidsAsSeen(SELLER, ['bid_a', 'bid_c']);
    const state = getSeenBidsState(SELLER);
    expect(state.seenBidTokens).toHaveLength(3);
    expect(new Set(state.seenBidTokens).size).toBe(3);
  });

  // --- clearSeenBidsState ---

  it('clearSeenBidsState removes localStorage entry', () => {
    markAllBidsAsSeen(SELLER, ['bid_a']);
    clearSeenBidsState(SELLER);
    const state = getSeenBidsState(SELLER);
    expect(state.seenBidTokens).toEqual([]);
    expect(state.lastKnownBidCount).toBe(-1);
  });

  // --- PKH isolation ---

  it('different PKHs have independent state', () => {
    markAllBidsAsSeen('seller_1', ['bid_a', 'bid_b']);
    markAllBidsAsSeen('seller_2', ['bid_c']);

    expect(getSeenBidsState('seller_1').seenBidTokens).toEqual(['bid_a', 'bid_b']);
    expect(getSeenBidsState('seller_2').seenBidTokens).toEqual(['bid_c']);

    const unseen1 = getUnseenBids('seller_1', ['bid_a', 'bid_b', 'bid_c']);
    const unseen2 = getUnseenBids('seller_2', ['bid_a', 'bid_b', 'bid_c']);
    expect(unseen1).toEqual(['bid_c']);
    expect(unseen2).toEqual(['bid_a', 'bid_b']);
  });
});
