import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { encryptionsApi, bidsApi } from '../services/api';
import type { EncryptionDisplay, BidDisplay } from '../services/api';
import SalesListingCard from './SalesListingCard';
import BidsModal from './BidsModal';
import { SkeletonGrid } from './SkeletonCard';
import EmptyState, { PackageIcon } from './EmptyState';
import { NoSalesIllustration, NoResultsIllustration } from './EmptyStateIllustrations';
import { listCachedImages, deleteCachedImage, type ImageCacheStatus } from '../services/imageCache';
import type { MySalesFilters, MySalesAction } from '../hooks/useTabFilterState';
import { getTransactions } from '../services/transactionHistory';
import { useDebounce } from '../hooks/useDebounce';

interface MySalesTabProps {
  userPkh?: string;
  onRemoveListing?: (encryption: EncryptionDisplay) => void;
  onAcceptBid?: (encryption: EncryptionDisplay, bid: BidDisplay) => void;
  onCancelPending?: (encryption: EncryptionDisplay) => void;
  onCompleteSale?: (encryption: EncryptionDisplay) => void;
  onCreateListing?: () => void;
  onBidsViewed?: (encryptionTokenName: string) => void;
  refreshSignal?: number;
  filters: MySalesFilters;
  dispatch: React.Dispatch<MySalesAction>;
}

function MySalesTab({
  userPkh,
  onRemoveListing,
  onAcceptBid,
  onCancelPending,
  onCompleteSale,
  onCreateListing,
  onBidsViewed,
  refreshSignal,
  filters,
  dispatch,
}: MySalesTabProps) {
  const [encryptions, setEncryptions] = useState<EncryptionDisplay[]>([]);
  const [bidsMap, setBidsMap] = useState<Map<string, BidDisplay[]>>(new Map());
  const [imageCacheStatus, setImageCacheStatus] = useState<ImageCacheStatus>({ cached: [], banned: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prevDataCount, setPrevDataCount] = useState(0);

  // Destructure filter state from Dashboard-level reducer
  const { viewMode, sortBy, statusFilter, searchQuery } = filters;
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Modal state
  const [selectedListing, setSelectedListing] = useState<EncryptionDisplay | null>(null);
  const [bidsModalOpen, setBidsModalOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch all encryptions and filter by owner PKH from datum
      const allEncryptions = await encryptionsApi.getAll();
      const userEncryptions = userPkh
        ? allEncryptions.filter((e) => e.sellerPkh === userPkh)
        : [];
      setEncryptions(userEncryptions);
      setPrevDataCount(userEncryptions.length);

      // Fetch image cache status for all listings
      listCachedImages().then(setImageCacheStatus).catch((err) => {
        console.warn('Image cache refresh failed:', err);
      });

      // Fetch bids for all user listings
      if (userEncryptions.length > 0) {
        const allBids = await bidsApi.getAll();
        const newBidsMap = new Map<string, BidDisplay[]>();

        userEncryptions.forEach((encryption) => {
          const encryptionBids = allBids.filter(
            (b) => b.encryptionToken === encryption.tokenName
          );
          newBidsMap.set(encryption.tokenName, encryptionBids);
        });

        setBidsMap(newBidsMap);
      } else {
        setBidsMap(new Map());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch your listings');
    } finally {
      setLoading(false);
    }
  }, [userPkh]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Re-fetch when Dashboard signals a refresh (e.g. after a transaction)
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    fetchData();
  }, [refreshSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-compute pending bid counts per listing and aggregate totals in a single pass
  const bidStats = useMemo(() => {
    const map = new Map<string, number>();
    let totalBidCount = 0;
    let totalBidValue = 0;
    for (const [tokenName, bids] of bidsMap) {
      let count = 0;
      for (const b of bids) {
        if (b.status === 'pending') {
          count++;
          totalBidValue += b.amount;
        }
      }
      if (count > 0) map.set(tokenName, count);
      totalBidCount += count;
    }
    return { map, totalBidCount, totalBidValue };
  }, [bidsMap]);

  const getBidCount = useCallback(
    (tokenName: string): number => bidStats.map.get(tokenName) ?? 0,
    [bidStats.map]
  );

  // Compute sales stats for summary banner
  const salesStats = useMemo(() => {
    let activeCount = 0;
    let pendingCount = 0;
    let listedValue = 0;
    for (const e of encryptions) {
      if (e.status === 'active') {
        activeCount++;
        listedValue += e.suggestedPrice ?? 0;
      } else if (e.status === 'pending') {
        pendingCount++;
      }
    }

    const completedSales = userPkh
      ? getTransactions(userPkh).filter(
          tx => (tx.type === 'accept-bid' || tx.type === 'complete-sale') && tx.status === 'confirmed'
        ).length
      : 0;

    return { activeCount, pendingCount, completedSales, listedValue, totalBidCount: bidStats.totalBidCount, totalBidValue: bidStats.totalBidValue };
  }, [encryptions, userPkh, bidStats.totalBidCount, bidStats.totalBidValue]);

  // Filter encryptions (separate from sort so sort changes don't re-filter)
  const filtered = useMemo(() => {
    let result = [...encryptions];

    if (statusFilter !== 'all') {
      result = result.filter((e) => e.status === statusFilter);
    }
    if (debouncedSearch.trim()) {
      const query = debouncedSearch.toLowerCase();
      result = result.filter(
        (e) =>
          e.tokenName.toLowerCase().includes(query) ||
          (e.description && e.description.toLowerCase().includes(query))
      );
    }

    return result;
  }, [encryptions, statusFilter, debouncedSearch]);

  // Sort filtered results (only reruns when sort order or bid counts change)
  // Null-safe: missing prices sort last; missing dates sort to epoch 0
  const filteredAndSorted = useMemo(() => {
    const result = [...filtered];
    const safeTime = (d: string) => {
      const t = new Date(d ?? '').getTime();
      return isNaN(t) ? 0 : t;
    };
    const safePrice = (p: number | undefined | null, fallback: number) => {
      if (p == null) return fallback;
      const n = Number(p);
      return isNaN(n) ? fallback : n;
    };
    switch (sortBy) {
      case 'newest':
        result.sort((a, b) => safeTime(b.createdAt) - safeTime(a.createdAt));
        break;
      case 'oldest':
        result.sort((a, b) => safeTime(a.createdAt) - safeTime(b.createdAt));
        break;
      case 'price-high':
        result.sort((a, b) => safePrice(b.suggestedPrice, -Infinity) - safePrice(a.suggestedPrice, -Infinity));
        break;
      case 'price-low':
        result.sort((a, b) => safePrice(a.suggestedPrice, Infinity) - safePrice(b.suggestedPrice, Infinity));
        break;
      case 'most-bids':
        result.sort((a, b) => (bidStats.map.get(b.tokenName) ?? 0) - (bidStats.map.get(a.tokenName) ?? 0));
        break;
    }
    return result;
  }, [filtered, sortBy, bidStats.map]);

  // Handlers
  const handleViewBids = useCallback((encryption: EncryptionDisplay) => {
    setSelectedListing(encryption);
    setBidsModalOpen(true);
    onBidsViewed?.(encryption.tokenName);
  }, [onBidsViewed]);

  const handleCloseBidsModal = useCallback(() => {
    setBidsModalOpen(false);
    setSelectedListing(null);
  }, []);

  const handleRemoveListing = useCallback(
    (encryption: EncryptionDisplay) => {
      // Optimistic cleanup — user can re-download if the tx fails
      deleteCachedImage(encryption.tokenName).catch((err) => console.warn('Failed to delete cached image:', err));

      if (onRemoveListing) {
        onRemoveListing(encryption);
      } else {
        // Placeholder for Phase 9
        alert(
          `Remove listing coming in Phase 9!\n\nThis will require a transaction to remove the encryption from the contract.\n\nToken: ${encryption.tokenName.slice(0, 16)}...`
        );
      }
    },
    [onRemoveListing]
  );

  const handleAcceptBid = useCallback(
    (encryption: EncryptionDisplay, bid: BidDisplay) => {
      if (onAcceptBid) {
        onAcceptBid(encryption, bid);
      } else {
        // Placeholder for Phase 12
        alert(
          `Accept bid coming in Phase 12!\n\nThis will trigger the SNARK proof generation followed by re-encryption transaction.\n\nBid: ${bid.amount.toLocaleString()} lovelace\nBidder: ${bid.bidder.slice(0, 16)}...`
        );
      }
      handleCloseBidsModal();
    },
    [onAcceptBid, handleCloseBidsModal]
  );

  const handleCancelPending = useCallback(
    (encryption: EncryptionDisplay) => {
      if (onCancelPending) {
        onCancelPending(encryption);
      } else {
        // Placeholder for Phase 9
        alert(
          `Cancel pending coming in Phase 9!\n\nThis will cancel the pending sale and return the encryption to active status.\n\nToken: ${encryption.tokenName.slice(0, 16)}...`
        );
      }
    },
    [onCancelPending]
  );

  const screenReaderMessage = loading
    ? 'Loading your listings…'
    : error
    ? 'Error loading your listings'
    : `${encryptions.length} ${encryptions.length === 1 ? 'listing' : 'listings'} loaded`;

  if (loading) {
    return (
      <>
        <div className="sr-only" aria-live="polite" role="status">{screenReaderMessage}</div>
        <SkeletonGrid count={Math.max(1, Math.min(prevDataCount || 8, 20))} />
      </>
    );
  }

  if (error) {
    return (
      <>
        <div className="sr-only" aria-live="polite" role="status">{screenReaderMessage}</div>
        <EmptyState
          icon={<PackageIcon />}
          title="Failed to load your listings"
          description={error}
          action={
            <button
              onClick={fetchData}
              className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
            >
              Try Again
            </button>
          }
        />
      </>
    );
  }

  // If user has no listings at all
  if (encryptions.length === 0) {
    return (
      <>
        <div className="sr-only" aria-live="polite" role="status">{screenReaderMessage}</div>
        <EmptyState
          illustration={<NoSalesIllustration />}
          title="No listings yet"
          description="Create your first encryption listing to start selling on the marketplace"
          action={
            <button
              onClick={onCreateListing}
              className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
            >
              Create Listing
            </button>
          }
        />
      </>
    );
  }

  return (
    <>
    <div className="sr-only" aria-live="polite" role="status">{screenReaderMessage}</div>
    <div>
      {/* Earnings Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4">
          <p className="text-xs text-[var(--text-muted)] mb-1">Active Listings</p>
          <p className="text-xl font-semibold text-[var(--text-primary)]">
            {salesStats.activeCount}
          </p>
          {salesStats.listedValue > 0 && (
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {salesStats.listedValue.toLocaleString()} ADA listed
            </p>
          )}
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4">
          <p className="text-xs text-[var(--text-muted)] mb-1">Pending Bids</p>
          <p className="text-xl font-semibold text-[var(--accent)]">
            {salesStats.totalBidCount}
          </p>
          {salesStats.totalBidValue > 0 && (
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {(salesStats.totalBidValue / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} ADA total
            </p>
          )}
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4">
          <p className="text-xs text-[var(--text-muted)] mb-1">Pending Sales</p>
          <p className="text-xl font-semibold text-[var(--warning)]">
            {salesStats.pendingCount}
          </p>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4">
          <p className="text-xs text-[var(--text-muted)] mb-1">Completed Sales</p>
          <p className="text-xl font-semibold text-[var(--success)]">
            {salesStats.completedSales}
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        {/* Search */}
        <div className="flex-1 relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search by token or description..."
            value={searchQuery}
            onChange={(e) => dispatch({ type: 'SET_SEARCH', payload: e.target.value })}
            aria-label="Search sales"
            className="w-full pl-10 pr-4 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:shadow-[var(--shadow-glow)] transition-all duration-[var(--transition-fast)]"
          />
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => dispatch({ type: 'SET_STATUS', payload: e.target.value as MySalesFilters['statusFilter'] })}
            aria-label="Filter by status"
            className="px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => dispatch({ type: 'SET_SORT', payload: e.target.value as MySalesFilters['sortBy'] })}
            aria-label="Sort listings"
            className="px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="price-high">Price: High to Low</option>
            <option value="price-low">Price: Low to High</option>
            <option value="most-bids">Most Bids</option>
          </select>

          {/* View Toggle */}
          <div className="flex border border-[var(--border-subtle)] rounded-[var(--radius-md)] overflow-hidden" role="group" aria-label="View mode">
            <button
              onClick={() => dispatch({ type: 'SET_VIEW', payload: 'grid' })}
              className={`px-3 py-2 transition-all duration-[var(--transition-fast)] cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-[var(--accent-muted)] text-[var(--accent)]'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
              title="Grid view"
              aria-label="Grid view"
              aria-pressed={viewMode === 'grid'}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                />
              </svg>
            </button>
            <button
              onClick={() => dispatch({ type: 'SET_VIEW', payload: 'list' })}
              className={`px-3 py-2 transition-all duration-[var(--transition-fast)] cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-[var(--accent-muted)] text-[var(--accent)]'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
              title="List view"
              aria-label="List view"
              aria-pressed={viewMode === 'list'}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
          </div>

          {/* Refresh */}
          <button
            onClick={fetchData}
            className="px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] btn-base btn-icon"
            title="Refresh listings"
            aria-label="Refresh listings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Results Count */}
      <div role="status" className="mb-4 text-sm text-[var(--text-muted)]">
        {filteredAndSorted.length} {filteredAndSorted.length === 1 ? 'listing' : 'listings'}
        {statusFilter !== 'all' && ` (${statusFilter})`}
      </div>

      {/* Content */}
      {filteredAndSorted.length === 0 ? (
        searchQuery || statusFilter !== 'all' ? (
          <EmptyState
            illustration={<NoResultsIllustration />}
            title="No matching listings"
            description="Try adjusting your search or filters"
            action={
              <button
                onClick={() => {
                  dispatch({ type: 'SET_SEARCH', payload: '' });
                  dispatch({ type: 'SET_STATUS', payload: 'all' });
                }}
                className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
              >
                Clear Filters
              </button>
            }
          />
        ) : (
          <EmptyState
            illustration={<NoSalesIllustration />}
            title="No listings found"
            description="Your listings will appear here"
          />
        )
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredAndSorted.map((encryption, index) => (
            <div key={encryption.tokenName} className="card-stagger" style={{ animationDelay: `${Math.min(index, 9) * 50}ms` }}>
              <SalesListingCard
                encryption={encryption}
                bidCount={getBidCount(encryption.tokenName)}
                onViewBids={handleViewBids}
                onRemove={handleRemoveListing}
                onCancelPending={handleCancelPending}
                onCompleteSale={onCompleteSale}
                initialCached={imageCacheStatus.cached.includes(encryption.tokenName)}
                initialBanned={imageCacheStatus.banned.includes(encryption.tokenName)}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAndSorted.map((encryption, index) => (
            <div key={encryption.tokenName} className="card-stagger" style={{ animationDelay: `${Math.min(index, 9) * 50}ms` }}>
              <SalesListingCard
                encryption={encryption}
                bidCount={getBidCount(encryption.tokenName)}
                onViewBids={handleViewBids}
                onRemove={handleRemoveListing}
                onCancelPending={handleCancelPending}
                compact
                initialCached={imageCacheStatus.cached.includes(encryption.tokenName)}
                initialBanned={imageCacheStatus.banned.includes(encryption.tokenName)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Bids Modal */}
      {selectedListing && (
        <BidsModal
          isOpen={bidsModalOpen}
          onClose={handleCloseBidsModal}
          encryption={selectedListing}
          bids={bidsMap.get(selectedListing.tokenName) || []}
          onAcceptBid={(bid) => handleAcceptBid(selectedListing, bid)}
        />
      )}
    </div>
    </>
  );
}

export default memo(MySalesTab);
