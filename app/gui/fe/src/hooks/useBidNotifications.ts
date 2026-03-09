import { useState, useEffect, useCallback, useRef } from 'react';
import { encryptionsApi, bidsApi } from '../services/api';
import {
  getSeenBidsState,
  getUnseenBids,
  markAllBidsAsSeen,
  markBidsAsSeen,
} from '../services/bidNotifications';
import type { NodeStage } from '../contexts/NodeContext';

/** Minimum interval between bid checks (ms) */
const THROTTLE_MS = 30_000;

/** Re-fetch seller's encryption list every N bid checks */
const ENCRYPTION_REFRESH_INTERVAL = 5;

export interface BidNotificationState {
  /** Count of unseen bids across all seller listings */
  unseenBidCount: number;
  /** Map from encryption token name to its unseen bid count */
  unseenBidsPerListing: Map<string, number>;
  /** Mark all current bids as seen (call when user views My Sales tab) */
  markAllSeen: () => void;
  /** Mark bids for a specific listing as seen (call when user opens BidsModal) */
  markListingSeen: (encryptionTokenName: string) => void;
  /** Whether the initial check has completed */
  isReady: boolean;
}

export function useBidNotifications(
  userPkh: string | undefined,
  tipSlot: number | null,
  nodeStage: NodeStage,
): BidNotificationState {
  const [unseenBidCount, setUnseenBidCount] = useState(0);
  const [unseenBidsPerListing, setUnseenBidsPerListing] = useState<Map<string, number>>(new Map());
  const [isReady, setIsReady] = useState(false);

  // Refs for throttle and caching
  const prevTipRef = useRef<number | null>(null);
  const lastCheckTimeRef = useRef(0);
  const checkCountRef = useRef(0);
  const cachedEncryptionTokensRef = useRef<string[]>([]);
  const allBidTokenNamesRef = useRef<string[]>([]);
  const bidsByEncryptionRef = useRef<Map<string, string[]>>(new Map());

  const checkBids = useCallback(async () => {
    if (!userPkh) return;

    const now = Date.now();
    if (now - lastCheckTimeRef.current < THROTTLE_MS) return;
    lastCheckTimeRef.current = now;

    try {
      // Decide whether to re-fetch encryptions
      const shouldRefreshEncryptions =
        cachedEncryptionTokensRef.current.length === 0 ||
        checkCountRef.current % ENCRYPTION_REFRESH_INTERVAL === 0;

      let sellerEncryptionTokens = cachedEncryptionTokensRef.current;

      if (shouldRefreshEncryptions) {
        const allEncryptions = await encryptionsApi.getAll();
        sellerEncryptionTokens = allEncryptions
          .filter(e => e.sellerPkh === userPkh)
          .map(e => e.tokenName);
        cachedEncryptionTokensRef.current = sellerEncryptionTokens;
      }

      // No listings = no bids to check
      if (sellerEncryptionTokens.length === 0) {
        setUnseenBidCount(0);
        setUnseenBidsPerListing(new Map());
        setIsReady(true);
        checkCountRef.current++;
        return;
      }

      // Fetch all bids and filter for seller's listings
      const allBids = await bidsApi.getAll();
      const sellerTokenSet = new Set(sellerEncryptionTokens);
      const relevantBids = allBids.filter(b => sellerTokenSet.has(b.encryptionToken));

      // Build token name list and per-encryption mapping
      const currentBidTokenNames = relevantBids.map(b => b.tokenName);
      const byEncryption = new Map<string, string[]>();
      for (const bid of relevantBids) {
        const list = byEncryption.get(bid.encryptionToken) || [];
        list.push(bid.tokenName);
        byEncryption.set(bid.encryptionToken, list);
      }

      allBidTokenNamesRef.current = currentBidTokenNames;
      bidsByEncryptionRef.current = byEncryption;

      // First-time check: seed the seen set without firing notifications
      const state = getSeenBidsState(userPkh);
      if (state.lastKnownBidCount === -1) {
        markAllBidsAsSeen(userPkh, currentBidTokenNames);
        setUnseenBidCount(0);
        setUnseenBidsPerListing(new Map());
        setIsReady(true);
        checkCountRef.current++;
        return;
      }

      // Quick check: if count hasn't changed, likely no new bids
      if (currentBidTokenNames.length === state.lastKnownBidCount) {
        // Still do the full diff in case bids were replaced (cancelled + new)
      }

      // Compute unseen bids
      const unseenTokens = getUnseenBids(userPkh, currentBidTokenNames);
      const unseenSet = new Set(unseenTokens);

      // Build per-listing unseen counts
      const perListing = new Map<string, number>();
      for (const [encToken, bidTokens] of byEncryption) {
        const count = bidTokens.filter(t => unseenSet.has(t)).length;
        if (count > 0) {
          perListing.set(encToken, count);
        }
      }

      setUnseenBidCount(unseenTokens.length);
      setUnseenBidsPerListing(perListing);
      setIsReady(true);
      checkCountRef.current++;
    } catch (error) {
      console.error('[useBidNotifications] Failed to check bids:', error);
      // Don't update state on error — keep showing last known values
      setIsReady(true);
    }
  }, [userPkh]);

  // Run check on tipSlot change (new block) when node is synced.
  // Deferred via setTimeout to avoid synchronous setState within the effect body.
  useEffect(() => {
    if (!userPkh || nodeStage !== 'synced') return;
    if (tipSlot === null || tipSlot === prevTipRef.current) return;
    prevTipRef.current = tipSlot;
    const id = setTimeout(checkBids, 0);
    return () => clearTimeout(id);
  }, [tipSlot, nodeStage, userPkh, checkBids]);

  // Immediate check on mount when userPkh becomes available (catches offline bids).
  // Deferred via setTimeout to avoid synchronous setState within the effect body.
  useEffect(() => {
    if (!userPkh || nodeStage !== 'synced') return;
    // Reset refs for new PKH
    prevTipRef.current = null;
    lastCheckTimeRef.current = 0;
    checkCountRef.current = 0;
    cachedEncryptionTokensRef.current = [];
    allBidTokenNamesRef.current = [];
    bidsByEncryptionRef.current = new Map();
    const id = setTimeout(() => {
      setUnseenBidCount(0);
      setUnseenBidsPerListing(new Map());
      setIsReady(false);
      checkBids();
    }, 0);
    return () => clearTimeout(id);
  }, [userPkh, nodeStage, checkBids]);

  const markAllSeen = useCallback(() => {
    if (!userPkh) return;
    markAllBidsAsSeen(userPkh, allBidTokenNamesRef.current);
    setUnseenBidCount(0);
    setUnseenBidsPerListing(new Map());
  }, [userPkh]);

  const markListingSeen = useCallback((encryptionTokenName: string) => {
    if (!userPkh) return;
    const bidTokens = bidsByEncryptionRef.current.get(encryptionTokenName) || [];
    if (bidTokens.length === 0) return;
    markBidsAsSeen(userPkh, bidTokens);

    // Update state
    setUnseenBidsPerListing(prev => {
      const next = new Map(prev);
      const removedCount = next.get(encryptionTokenName) || 0;
      next.delete(encryptionTokenName);
      setUnseenBidCount(c => Math.max(0, c - removedCount));
      return next;
    });
  }, [userPkh]);

  return {
    unseenBidCount,
    unseenBidsPerListing,
    markAllSeen,
    markListingSeen,
    isReady,
  };
}
