import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import { useNode } from '../contexts/NodeContext';
import { encryptionsApi, bidsApi } from '../services/api';
import type { EncryptionDisplay, BidDisplay } from '../services/api';
import { optimisticStore } from '../services/optimisticStore';
import SalesListingCard from './SalesListingCard';
import BidsModal from './BidsModal';
import { SkeletonCard, SkeletonGrid } from './SkeletonCard';
import EmptyState, { PackageIcon } from './EmptyState';
import { NoSalesIllustration, NoResultsIllustration } from './EmptyStateIllustrations';
import { listCachedImages, deleteCachedImage, type ImageCacheStatus } from '../services/imageCache';
import { getNsfwEnabled } from '../services/nsfwStorage';
import RefreshIndicator from './RefreshIndicator';
import AcceptBidQueuePanel from './AcceptBidQueuePanel';
import type { MySalesFilters, MySalesAction, CardSize } from '../hooks/useTabFilterState';
import { getGridClasses } from '../hooks/useTabFilterState';
import { getTransactions } from '../services/transactionHistory';
import { useDebounce } from '../hooks/useDebounce';
import { formatAda } from '../utils/formatAda';

interface MySalesTabProps {
  userPkh?: string;
  onRemoveListing?: (encryption: EncryptionDisplay) => void;
  onUpdatePrice?: (encryption: EncryptionDisplay) => void;
  onAcceptBid?: (encryption: EncryptionDisplay, bid: BidDisplay) => void;
  onCancelPending?: (encryption: EncryptionDisplay) => void;
  onCompleteSale?: (encryption: EncryptionDisplay) => void;
  onCreateListing?: () => void;
  onBidsViewed?: (encryptionTokenName: string) => void;
  onLocalRefresh?: () => void;
  refreshSignal?: number;
  filters: MySalesFilters;
  dispatch: React.Dispatch<MySalesAction>;
}

function MySalesTab({
  userPkh,
  onRemoveListing,
  onUpdatePrice,
  onAcceptBid,
  onCancelPending,
  onCompleteSale,
  onCreateListing,
  onBidsViewed,
  onLocalRefresh,
  refreshSignal,
  filters,
  dispatch,
}: MySalesTabProps) {
  const { expressReady } = useNode();
  const [encryptions, setEncryptions] = useState<EncryptionDisplay[]>([]);
  const [bidsMap, setBidsMap] = useState<Map<string, BidDisplay[]>>(new Map());
  const [imageCacheStatus, setImageCacheStatus] = useState<ImageCacheStatus>({ cached: [], banned: [], total_bytes: 0 });
  const [nsfwEnabled] = useState(() => getNsfwEnabled());
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prevDataCount, setPrevDataCount] = useState(0);

  // Destructure filter state from Dashboard-level reducer
  const { viewMode, sortBy, statusFilter, searchQuery, cardSize, columnCount, currentPage } = filters;
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Modal state
  const [selectedListing, setSelectedListing] = useState<EncryptionDisplay | null>(null);
  const [bidsModalOpen, setBidsModalOpen] = useState(false);

  const hasDataRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (hasDataRef.current) setIsRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      // Fetch all encryptions and filter by owner PKH from datum
      const allEncryptions = optimisticStore.mergeEncryptions(await encryptionsApi.getAll());
      const userEncryptions = userPkh
        ? allEncryptions.filter((e) => e.sellerPkh === userPkh)
        : [];
      setEncryptions(userEncryptions);
      setPrevDataCount(userEncryptions.length);
      hasDataRef.current = true;

      // Fetch image cache status for all listings
      listCachedImages().then(setImageCacheStatus).catch((err) => {
        console.warn('Image cache refresh failed:', err);
      });

      // Fetch bids for all user listings
      if (userEncryptions.length > 0) {
        const allBids = optimisticStore.mergeBids(await bidsApi.getAll());
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
      setIsRefreshing(false);
    }
  }, [userPkh]);

  // Fetch on mount and re-fetch when refreshSignal changes (waits for Express backend)
  useEffect(() => {
    if (!expressReady) return;
    fetchData();
  }, [refreshSignal, fetchData, expressReady]);

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

  // Load more pagination
  const ITEMS_PER_PAGE = 24;

  const paginatedResults = useMemo(() => {
    return filteredAndSorted.slice(0, currentPage * ITEMS_PER_PAGE);
  }, [filteredAndSorted, currentPage]);

  const hasMore = paginatedResults.length < filteredAndSorted.length;

  const sentinelRef = useInfiniteScroll({
    hasMore,
    onLoadMore: useCallback(() => dispatch({ type: 'SET_PAGE', payload: currentPage + 1 }), [currentPage, dispatch]),
  });

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
        console.warn('onRemoveListing callback not provided');
      }
    },
    [onRemoveListing]
  );

  const handleAcceptBid = useCallback(
    (encryption: EncryptionDisplay, bid: BidDisplay) => {
      if (onAcceptBid) {
        onAcceptBid(encryption, bid);
      } else {
        console.warn('onAcceptBid callback not provided');
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
        console.warn('onCancelPending callback not provided');
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
              onClick={() => { fetchData(); onLocalRefresh?.(); }}
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
      <RefreshIndicator visible={isRefreshing} />
      {/* Auto-Accept Queue Panel */}
      <AcceptBidQueuePanel />
      {/* Earnings Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4">
          <p className="text-xs text-[var(--text-muted)] mb-1">Active Listings</p>
          <p className="text-xl font-semibold text-[var(--text-primary)]">
            {salesStats.activeCount}
          </p>
          {salesStats.listedValue > 0 && (
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {formatAda(salesStats.listedValue)} ADA listed
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

          {/* Card Size Toggle — grid only */}
          {viewMode === 'grid' && (
            <div className="flex border border-[var(--border-subtle)] rounded-[var(--radius-md)] overflow-hidden" role="group" aria-label="Card size">
              {(['small', 'medium', 'large'] as CardSize[]).map((size) => (
                <button
                  key={size}
                  onClick={() => dispatch({ type: 'SET_CARD_SIZE', payload: size })}
                  className={`px-2.5 py-2 transition-all duration-[var(--transition-fast)] cursor-pointer ${
                    cardSize === size
                      ? 'bg-[var(--accent-muted)] text-[var(--accent)]'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  }`}
                  title={`${size.charAt(0).toUpperCase() + size.slice(1)} cards`}
                  aria-label={`${size.charAt(0).toUpperCase() + size.slice(1)} cards`}
                  aria-pressed={cardSize === size}
                >
                  {size === 'small' && (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                      <rect x="1" y="1" width="4" height="4" rx="0.5" /><rect x="6" y="1" width="4" height="4" rx="0.5" /><rect x="11" y="1" width="4" height="4" rx="0.5" />
                      <rect x="1" y="6" width="4" height="4" rx="0.5" /><rect x="6" y="6" width="4" height="4" rx="0.5" /><rect x="11" y="6" width="4" height="4" rx="0.5" />
                      <rect x="1" y="11" width="4" height="4" rx="0.5" /><rect x="6" y="11" width="4" height="4" rx="0.5" /><rect x="11" y="11" width="4" height="4" rx="0.5" />
                    </svg>
                  )}
                  {size === 'medium' && (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                      <rect x="1" y="1" width="6" height="6" rx="0.75" /><rect x="9" y="1" width="6" height="6" rx="0.75" />
                      <rect x="1" y="9" width="6" height="6" rx="0.75" /><rect x="9" y="9" width="6" height="6" rx="0.75" />
                    </svg>
                  )}
                  {size === 'large' && (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                      <rect x="1" y="1" width="14" height="6" rx="1" />
                      <rect x="1" y="9" width="14" height="6" rx="1" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Refresh */}
          <button
            onClick={() => { fetchData(); onLocalRefresh?.(); }}
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
        {hasMore
          ? `Showing ${paginatedResults.length} of ${filteredAndSorted.length} ${filteredAndSorted.length === 1 ? 'listing' : 'listings'}`
          : `${filteredAndSorted.length} ${filteredAndSorted.length === 1 ? 'listing' : 'listings'}`}
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
        <div className={getGridClasses(columnCount)}>
          {paginatedResults.map((encryption, index) => (
            <div key={encryption.tokenName} className="card-stagger" style={{ animationDelay: `${Math.min(index, 9) * 50}ms` }}>
              <SalesListingCard
                encryption={encryption}
                bidCount={getBidCount(encryption.tokenName)}
                onViewBids={handleViewBids}
                onRemove={handleRemoveListing}
                onUpdatePrice={onUpdatePrice}
                onCancelPending={handleCancelPending}
                onCompleteSale={onCompleteSale}
                cardSize={cardSize}
                initialCached={imageCacheStatus.cached.includes(encryption.tokenName)}
                initialBanned={imageCacheStatus.banned.includes(encryption.tokenName)}
                nsfwEnabled={nsfwEnabled}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedResults.map((encryption, index) => (
            <div key={encryption.tokenName} className="card-stagger" style={{ animationDelay: `${Math.min(index, 9) * 50}ms` }}>
              <SalesListingCard
                encryption={encryption}
                bidCount={getBidCount(encryption.tokenName)}
                onViewBids={handleViewBids}
                onRemove={handleRemoveListing}
                onUpdatePrice={onUpdatePrice}
                onCancelPending={handleCancelPending}
                compact
                initialCached={imageCacheStatus.cached.includes(encryption.tokenName)}
                initialBanned={imageCacheStatus.banned.includes(encryption.tokenName)}
                nsfwEnabled={nsfwEnabled}
              />
            </div>
          ))}
        </div>
      )}

      {/* Load More */}
      {hasMore && (
        <div className="flex flex-col items-center gap-3 mt-6">
          <div className={`${getGridClasses(columnCount)} w-full`}>
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Showing {paginatedResults.length} of {filteredAndSorted.length}
          </p>
          <button
            onClick={() => dispatch({ type: 'SET_PAGE', payload: currentPage + 1 })}
            className="px-6 py-2.5 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-tertiary"
          >
            Load More
          </button>
          <div ref={sentinelRef} className="h-1" />
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
