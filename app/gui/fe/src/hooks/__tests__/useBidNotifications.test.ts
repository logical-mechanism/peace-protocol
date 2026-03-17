import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBidNotifications } from '../useBidNotifications';

const mockGetAll = vi.fn();
const mockBidsGetAll = vi.fn();

vi.mock('../../services/api', () => ({
  encryptionsApi: { getAll: (...args: unknown[]) => mockGetAll(...args) },
  bidsApi: { getAll: (...args: unknown[]) => mockBidsGetAll(...args) },
}));

const mockApiCacheSet = vi.fn();
vi.mock('../../services/apiCache', () => ({
  apiCache: {
    set: (...args: unknown[]) => mockApiCacheSet(...args),
  },
}));

const mockGetSeenBidsState = vi.fn();
const mockGetUnseenBids = vi.fn();
const mockMarkAllBidsAsSeen = vi.fn();
const mockMarkBidsAsSeen = vi.fn();

vi.mock('../../services/bidNotifications', () => ({
  getSeenBidsState: (...args: unknown[]) => mockGetSeenBidsState(...args),
  getUnseenBids: (...args: unknown[]) => mockGetUnseenBids(...args),
  markAllBidsAsSeen: (...args: unknown[]) => mockMarkAllBidsAsSeen(...args),
  markBidsAsSeen: (...args: unknown[]) => mockMarkBidsAsSeen(...args),
}));

const PKH = 'abc123';
const WAIT_OPTS = { timeout: 2000 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useBidNotifications', () => {
  it('returns zero counts when userPkh is undefined', () => {
    const { result } = renderHook(() =>
      useBidNotifications(undefined, 100, 'synced')
    );

    expect(result.current.unseenBidCount).toBe(0);
    expect(result.current.unseenBidsPerListing.size).toBe(0);
  });

  it('does not check when node is not synced', async () => {
    renderHook(() => useBidNotifications(PKH, null, 'syncing'));

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    expect(mockGetAll).not.toHaveBeenCalled();
  });

  it('seeds seen state on first check (no notifications fired)', async () => {
    mockGetAll.mockResolvedValue([
      { tokenName: 'enc1', sellerPkh: PKH },
    ]);
    mockBidsGetAll.mockResolvedValue([
      { tokenName: 'bid1', encryptionToken: 'enc1' },
    ]);
    mockGetSeenBidsState.mockReturnValue({ lastKnownBidCount: -1, seenBids: new Set() });

    // Use tipSlot=null so only the mount effect fires (avoids race with tipSlot effect)
    const { result } = renderHook(() =>
      useBidNotifications(PKH, null, 'synced')
    );

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    }, WAIT_OPTS);

    expect(result.current.unseenBidCount).toBe(0);
    expect(mockMarkAllBidsAsSeen).toHaveBeenCalledWith(PKH, ['bid1']);
  });

  it('detects new bids after initial seed', async () => {
    mockGetAll.mockResolvedValue([
      { tokenName: 'enc1', sellerPkh: PKH },
    ]);
    mockBidsGetAll.mockResolvedValue([
      { tokenName: 'bid1', encryptionToken: 'enc1' },
      { tokenName: 'bid2', encryptionToken: 'enc1' },
    ]);
    mockGetSeenBidsState.mockReturnValue({
      lastKnownBidCount: 1,
      seenBids: new Set(['bid1']),
    });
    mockGetUnseenBids.mockReturnValue(['bid2']);

    const { result } = renderHook(() =>
      useBidNotifications(PKH, null, 'synced')
    );

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    }, WAIT_OPTS);

    expect(result.current.unseenBidCount).toBe(1);
    expect(result.current.unseenBidsPerListing.get('enc1')).toBe(1);
  });

  it('markAllSeen clears unseen count', async () => {
    mockGetAll.mockResolvedValue([
      { tokenName: 'enc1', sellerPkh: PKH },
    ]);
    mockBidsGetAll.mockResolvedValue([
      { tokenName: 'bid1', encryptionToken: 'enc1' },
    ]);
    mockGetSeenBidsState.mockReturnValue({
      lastKnownBidCount: 0,
      seenBids: new Set(),
    });
    mockGetUnseenBids.mockReturnValue(['bid1']);

    const { result } = renderHook(() =>
      useBidNotifications(PKH, null, 'synced')
    );

    await waitFor(() => {
      expect(result.current.unseenBidCount).toBe(1);
    }, WAIT_OPTS);

    act(() => {
      result.current.markAllSeen();
    });

    expect(result.current.unseenBidCount).toBe(0);
    expect(mockMarkAllBidsAsSeen).toHaveBeenCalledWith(PKH, ['bid1']);
  });

  it('handles no seller listings gracefully', async () => {
    mockGetAll.mockResolvedValue([
      { tokenName: 'enc1', sellerPkh: 'other_user' },
    ]);
    mockBidsGetAll.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useBidNotifications(PKH, null, 'synced')
    );

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    }, WAIT_OPTS);

    expect(result.current.unseenBidCount).toBe(0);
  });

  it('handles API errors without crashing', async () => {
    mockGetAll.mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() =>
      useBidNotifications(PKH, null, 'synced')
    );

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    }, WAIT_OPTS);

    expect(result.current.unseenBidCount).toBe(0);
  });

  it('markListingSeen clears count for specific listing', async () => {
    mockGetAll.mockResolvedValue([
      { tokenName: 'enc1', sellerPkh: PKH },
      { tokenName: 'enc2', sellerPkh: PKH },
    ]);
    mockBidsGetAll.mockResolvedValue([
      { tokenName: 'bid1', encryptionToken: 'enc1' },
      { tokenName: 'bid2', encryptionToken: 'enc2' },
    ]);
    mockGetSeenBidsState.mockReturnValue({
      lastKnownBidCount: 0,
      seenBids: new Set(),
    });
    mockGetUnseenBids.mockReturnValue(['bid1', 'bid2']);

    const { result } = renderHook(() =>
      useBidNotifications(PKH, null, 'synced')
    );

    await waitFor(() => {
      expect(result.current.unseenBidCount).toBe(2);
    }, WAIT_OPTS);

    act(() => {
      result.current.markListingSeen('enc1');
    });

    expect(result.current.unseenBidsPerListing.has('enc1')).toBe(false);
    expect(result.current.unseenBidsPerListing.get('enc2')).toBe(1);
    expect(mockMarkBidsAsSeen).toHaveBeenCalledWith(PKH, ['bid1']);
  });

  it('calls onDataChanged when data fingerprint changes', async () => {
    const onDataChanged = vi.fn();
    mockGetAll.mockResolvedValue([
      { tokenName: 'enc1', sellerPkh: PKH },
    ]);
    mockBidsGetAll.mockResolvedValue([
      { tokenName: 'bid1', encryptionToken: 'enc1' },
    ]);
    mockGetSeenBidsState.mockReturnValue({ lastKnownBidCount: -1, seenBids: new Set() });

    renderHook(() =>
      useBidNotifications(PKH, null, 'synced', onDataChanged)
    );

    await waitFor(() => {
      expect(onDataChanged).toHaveBeenCalledTimes(1);
    }, WAIT_OPTS);
  });

  it('does not call onDataChanged when data fingerprint is unchanged', async () => {
    const onDataChanged = vi.fn();
    const encryptions = [{ tokenName: 'enc1', sellerPkh: PKH }];
    const bids = [{ tokenName: 'bid1', encryptionToken: 'enc1' }];
    mockGetAll.mockResolvedValue(encryptions);
    mockBidsGetAll.mockResolvedValue(bids);
    mockGetSeenBidsState.mockReturnValue({ lastKnownBidCount: -1, seenBids: new Set() });

    const { rerender } = renderHook(
      ({ tipSlot }) => useBidNotifications(PKH, tipSlot, 'synced', onDataChanged),
      { initialProps: { tipSlot: null as number | null } }
    );

    await waitFor(() => {
      expect(onDataChanged).toHaveBeenCalledTimes(1);
    }, WAIT_OPTS);

    // Same data on second check — should not call onDataChanged again
    mockGetSeenBidsState.mockReturnValue({ lastKnownBidCount: 1, seenBids: new Set(['bid1']) });
    mockGetUnseenBids.mockReturnValue([]);

    // Advance past throttle (15s) by waiting then triggering via tipSlot change
    await act(async () => {
      await new Promise(r => setTimeout(r, 16_000));
    });

    rerender({ tipSlot: 200 });

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    // Should still be 1 (from initial call only)
    expect(onDataChanged).toHaveBeenCalledTimes(1);
  }, 20_000);

  it('pre-warms apiCache when data changes', async () => {
    const encryptions = [{ tokenName: 'enc1', sellerPkh: 'other' }];
    const bids = [{ tokenName: 'bid1', encryptionToken: 'enc1' }];
    mockGetAll.mockResolvedValue(encryptions);
    mockBidsGetAll.mockResolvedValue(bids);

    renderHook(() =>
      useBidNotifications(PKH, null, 'synced')
    );

    await waitFor(() => {
      expect(mockApiCacheSet).toHaveBeenCalledWith(
        '/api/encryptions',
        { data: encryptions },
        15_000,
      );
      expect(mockApiCacheSet).toHaveBeenCalledWith(
        '/api/bids',
        { data: bids },
        15_000,
      );
    }, WAIT_OPTS);
  });
});
