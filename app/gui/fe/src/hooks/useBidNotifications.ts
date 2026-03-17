import { useState, useEffect, useCallback, useRef } from 'react';
import { encryptionsApi, bidsApi } from '../services/api';
import type { ApiResponse, EncryptionDisplay, BidDisplay } from '../services/api';
import { apiCache } from '../services/apiCache';
import {
  getSeenBidsState,
  getUnseenBids,
  markAllBidsAsSeen,
  markBidsAsSeen,
} from '../services/bidNotifications';
import type { NodeStage } from '../contexts/NodeContext';

/** Minimum interval between bid checks (ms) */
const THROTTLE_MS = 15_000;

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

/** Build a lightweight fingerprint from a list of items with tokenName. */
function fingerprint(items: { tokenName: string }[]): string {
  if (items.length === 0) return '0:';
  const sorted = items.map(i => i.tokenName).sort();
  return items.length + ':' + sorted.join(',');
}

export function useBidNotifications(
  userPkh: string | undefined,
  tipSlot: number | null,
  nodeStage: NodeStage,
  onDataChanged?: () => void,
): BidNotificationState {
  const [unseenBidCount, setUnseenBidCount] = useState(0);
  const [unseenBidsPerListing, setUnseenBidsPerListing] = useState<Map<string, number>>(new Map());
  const [isReady, setIsReady] = useState(false);

  // Refs for throttle and caching
  const prevTipRef = useRef<number | null>(null);
  const lastCheckTimeRef = useRef(0);
  const allBidTokenNamesRef = useRef<string[]>([]);
  const bidsByEncryptionRef = useRef<Map<string, string[]>>(new Map());

  // Fingerprint refs for change detection
  const prevEncFingerprintRef = useRef<string>('');
  const prevBidFingerprintRef = useRef<string>('');
  const onDataChangedRef = useRef(onDataChanged);
  useEffect(() => {
    onDataChangedRef.current = onDataChanged;
  }, [onDataChanged]);

  const checkBids = useCallback(async () => {
    if (!userPkh) return;

    const now = Date.now();
    if (now - lastCheckTimeRef.current < THROTTLE_MS) return;
    lastCheckTimeRef.current = now;

    try {
      // Always fetch all encryptions and bids (cache-backed, usually a no-op)
      const allEncryptions = await encryptionsApi.getAll();
      const allBids = await bidsApi.getAll();

      // --- Change detection: fingerprint full datasets ---
      const encFingerprint = fingerprint(allEncryptions);
      const bidFingerprint = fingerprint(allBids);
      const dataChanged =
        encFingerprint !== prevEncFingerprintRef.current ||
        bidFingerprint !== prevBidFingerprintRef.current;

      prevEncFingerprintRef.current = encFingerprint;
      prevBidFingerprintRef.current = bidFingerprint;

      if (dataChanged) {
        // Pre-warm the apiCache so tabs hit warm cache on re-fetch
        const encResponse: ApiResponse<EncryptionDisplay[]> = { data: allEncryptions };
        const bidResponse: ApiResponse<BidDisplay[]> = { data: allBids };
        apiCache.set('/api/encryptions', encResponse, 15_000);
        apiCache.set('/api/bids', bidResponse, 15_000);
        onDataChangedRef.current?.();
      }

      // --- Bid notification logic (unchanged) ---
      const sellerEncryptionTokens = allEncryptions
        .filter(e => e.sellerPkh === userPkh)
        .map(e => e.tokenName);

      // No listings = no bids to check
      if (sellerEncryptionTokens.length === 0) {
        setUnseenBidCount(0);
        setUnseenBidsPerListing(new Map());
        setIsReady(true);
        return;
      }

      // Filter bids for seller's listings
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
        return;
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
    prevEncFingerprintRef.current = '';
    prevBidFingerprintRef.current = '';
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
