import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useNode } from '../contexts/NodeContext';
import { encryptionsApi, bidsApi } from '../services/api';
import { optimisticStore } from '../services/optimisticStore';
import type { EncryptionDisplay, BidDisplay } from '../services/api';
import EncryptionCard from './EncryptionCard';
import { SkeletonCard, SkeletonGrid } from './SkeletonCard';
import EmptyState, { PackageIcon } from './EmptyState';
import { MarketplaceEmptyIllustration, NoResultsIllustration } from './EmptyStateIllustrations';
import { listCachedImages, type ImageCacheStatus } from '../services/imageCache';
import { getFavorites, toggleFavorite } from '../services/favoritesStorage';
import PriceRangeSlider from './PriceRangeSlider';
import CategoryFilter from './CategoryFilter';
import DateFilter from './DateFilter';
import RefreshIndicator from './RefreshIndicator';
import type { MarketplaceFilters, MarketplaceAction, CardSize, ColumnCount } from '../hooks/useTabFilterState';
import { getGridClasses } from '../hooks/useTabFilterState';
import LayoutPopover from './LayoutPopover';
import { useDebounce } from '../hooks/useDebounce';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import { filterListings, sortListings, countActiveFilters, countPanelFilters } from '../services/marketplaceFilters';
import { getNsfwEnabled } from '../services/nsfwStorage';
import { truncateHex } from '../utils/truncate';
import { getCategoryLabel } from '../utils/formatListing';

interface MarketplaceTabProps {
  userPkh?: string;
  lovelace?: string | null;
  onPlaceBid?: (encryption: EncryptionDisplay, bidCount: number) => void;
  onCreateListing?: () => void;
  onLocalRefresh?: () => void;
  refreshSignal?: number;
  filters: MarketplaceFilters;
  dispatch: React.Dispatch<MarketplaceAction>;
}

function MarketplaceTab({ userPkh, lovelace, onPlaceBid, onCreateListing, onLocalRefresh, refreshSignal, filters, dispatch }: MarketplaceTabProps) {
  const { expressReady } = useNode();
  const [encryptions, setEncryptions] = useState<EncryptionDisplay[]>([]);
  const [allBids, setAllBids] = useState<BidDisplay[]>([]);
  const [imageCacheStatus, setImageCacheStatus] = useState<ImageCacheStatus>({ cached: [], banned: [], total_bytes: 0 });
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [prevDataCount, setPrevDataCount] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [nsfwEnabled] = useState(() => getNsfwEnabled());

  // Close filters panel on Escape key
  useEffect(() => {
    if (!filtersOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFiltersOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [filtersOpen]);


  // Derive user bid tokens reactively from allBids + optimistic store.
  // Re-evaluates whenever allBids changes, so newly placed
  // bids show instantly via the optimistic merge in triggerTransactionRefresh.
  const userBidEncryptionTokens = useMemo(() => {
    const merged = optimisticStore.mergeBids(allBids);
    return new Set<string>(
      merged
        .filter((b) => b.bidderPkh === userPkh && b.status === 'pending')
        .map((b) => b.encryptionToken)
    );
  }, [allBids, userPkh]);

  // Destructure filter state from Dashboard-level reducer
  const { viewMode, sortBy, statusFilter, categoryFilter, hideOwnListings, hideNsfw, dateFrom, dateTo, searchQuery, priceMin, priceMax, showFavoritesOnly, sellerPkh, cardSize, columnCount, currentPage } = filters;
  const debouncedSearch = useDebounce(searchQuery, 300);

  const hasDataRef = useRef(false);

  const fetchEncryptions = useCallback(async () => {
    if (hasDataRef.current) setIsRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [encResult, bidResult] = await Promise.all([
        encryptionsApi.getAllWithWarnings(),
        bidsApi.getAllWithWarnings(),
      ]);
      setEncryptions(optimisticStore.mergeEncryptions(encResult.data));
      setAllBids(optimisticStore.mergeBids(bidResult.data));
      setPrevDataCount(encResult.data.length);
      hasDataRef.current = true;

      // Surface backend-detected stale data
      setIsStale(encResult.stale || bidResult.stale);

      // Fetch image cache status for all listings
      listCachedImages().then(setImageCacheStatus).catch((err) => {
        console.warn('Image cache refresh failed:', err);
      });

      // userBidEncryptionTokens is now derived via useMemo from allBids + optimistic store
    } catch (err) {
      if (hasDataRef.current) {
        // Keep showing previously loaded data with a stale warning
        setIsStale(true);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to fetch listings');
      }
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Fetch on mount and re-fetch when refreshSignal changes (waits for Express backend)
  useEffect(() => {
    if (!expressReady) return;
    fetchEncryptions();
  }, [refreshSignal, fetchEncryptions, expressReady]);

  // Load favorites from localStorage when user changes
  useEffect(() => {
    if (userPkh) {
      setFavorites(getFavorites(userPkh));
    }
  }, [userPkh]);

  const handleToggleFavorite = useCallback(
    (tokenName: string) => {
      if (!userPkh) return;
      const isNowFavorite = toggleFavorite(userPkh, tokenName);
      setFavorites((prev) => {
        const next = new Set(prev);
        if (isNowFavorite) {
          next.add(tokenName);
        } else {
          next.delete(tokenName);
        }
        return next;
      });
    },
    [userPkh]
  );

  const handleFilterBySeller = useCallback(
    (pkh: string) => dispatch({ type: 'SET_SELLER_FILTER', payload: pkh }),
    [dispatch]
  );

  const handleClearSellerFilter = useCallback(
    () => dispatch({ type: 'CLEAR_SELLER_FILTER' }),
    [dispatch]
  );

  const handleFilterByCategory = useCallback(
    (category: string) => dispatch({ type: 'SET_CATEGORY', payload: [category] }),
    [dispatch]
  );

  const handleClearCategoryFilter = useCallback(
    () => dispatch({ type: 'SET_CATEGORY', payload: ['all'] }),
    [dispatch]
  );

  // Pre-compute pending bid counts per encryption token
  const bidCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of allBids) {
      if (b.status === 'pending') {
        map.set(b.encryptionToken, (map.get(b.encryptionToken) ?? 0) + 1);
      }
    }
    return map;
  }, [allBids]);

  const getBidCount = useCallback(
    (tokenName: string): number => bidCountMap.get(tokenName) ?? 0,
    [bidCountMap]
  );

  // Compute price range from all listings for the slider (convert lovelace to ADA)
  const priceRange = useMemo(() => {
    let maxPrice = 0;
    for (const e of encryptions) {
      const price = Number(e.suggestedPrice) / 1_000_000;
      if (!isNaN(price) && price > maxPrice) {
        maxPrice = price;
      }
    }
    return { min: 0, max: Math.max(maxPrice, 1) };
  }, [encryptions]);

  // Build filter params for pure functions
  const filterParams = useMemo(() => ({
    statusFilter,
    categoryFilter,
    hideOwnListings,
    userPkh,
    showFavoritesOnly,
    favorites,
    priceMin,
    priceMax,
    searchQuery: debouncedSearch,
    dateFrom,
    dateTo,
    hideNsfw,
    sellerPkh,
  }), [statusFilter, categoryFilter, hideOwnListings, hideNsfw, userPkh, showFavoritesOnly, favorites, priceMin, priceMax, debouncedSearch, dateFrom, dateTo, sellerPkh]);

  const filtered = useMemo(
    () => filterListings(encryptions, filterParams),
    [encryptions, filterParams],
  );

  const filteredAndSorted = useMemo(
    () => sortListings(filtered, sortBy, bidCountMap),
    [filtered, sortBy, bidCountMap],
  );

  const isOwnListing = useCallback(
    (encryption: EncryptionDisplay) => {
      if (!userPkh) return false;
      return encryption.sellerPkh === userPkh;
    },
    [userPkh]
  );

  const activeFilterCount = useMemo(() => countActiveFilters(filterParams), [filterParams]);
  const panelFilterCount = useMemo(() => countPanelFilters(filterParams), [filterParams]);

  // Load more pagination — accumulate batches instead of showing a single page
  const ITEMS_PER_PAGE = 24;

  const paginatedResults = useMemo(() => {
    return filteredAndSorted.slice(0, currentPage * ITEMS_PER_PAGE);
  }, [filteredAndSorted, currentPage]);

  const hasMore = paginatedResults.length < filteredAndSorted.length;

  const sentinelRef = useInfiniteScroll({
    hasMore,
    onLoadMore: useCallback(() => dispatch({ type: 'SET_PAGE', payload: currentPage + 1 }), [currentPage, dispatch]),
  });

  const screenReaderMessage = loading
    ? 'Loading marketplace listings…'
    : error
    ? 'Error loading marketplace listings'
    : `${filteredAndSorted.length} ${filteredAndSorted.length === 1 ? 'listing' : 'listings'} loaded`;

  const staleBanner = isStale ? (
    <div
      className="mb-4 flex items-center gap-3 px-4 py-3 text-sm rounded-[var(--radius-md)]"
      style={{
        background: 'var(--warning-muted)',
        border: '1px solid var(--warning)',
        color: 'var(--warning)',
      }}
      role="status"
      aria-live="polite"
    >
      <svg
        className="w-4 h-4 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
        />
      </svg>
      <span>Showing cached listings — data may be outdated.</span>
      <button
        onClick={() => { fetchEncryptions(); onLocalRefresh?.(); }}
        className="ml-auto px-3 py-1 text-xs font-medium rounded-[var(--radius-sm)] cursor-pointer"
        style={{
          background: 'var(--warning)',
          color: 'var(--bg-primary)',
        }}
        aria-label="Retry loading marketplace listings"
      >
        Retry
      </button>
      <button
        onClick={() => setIsStale(false)}
        className="p-1 rounded-[var(--radius-sm)] cursor-pointer"
        style={{ color: 'var(--warning)' }}
        aria-label="Dismiss stale data warning"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  ) : null;

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
          title="Failed to load listings"
          description={error}
          action={
            <button
              onClick={() => { fetchEncryptions(); onLocalRefresh?.(); }}
              className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
            >
              Try Again
            </button>
          }
        />
      </>
    );
  }

  // Single category filter chip is shown when exactly one category is selected.
  const singleCategorySelected =
    categoryFilter.length === 1 && categoryFilter[0] !== 'all' ? categoryFilter[0] : null;

  const activeChips = sellerPkh || singleCategorySelected ? (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {sellerPkh && (
        <button
          type="button"
          onClick={handleClearSellerFilter}
          className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-full bg-[var(--accent-muted)] text-[var(--accent)] border border-[var(--accent)] hover:bg-[var(--accent)] hover:text-white transition-colors duration-[var(--transition-fast)] cursor-pointer"
          aria-label={`Clear seller filter for ${truncateHex(sellerPkh, 10, 6)}`}
        >
          <span>Seller: <span className="font-mono">{truncateHex(sellerPkh, 10, 6)}</span></span>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
      {singleCategorySelected && (
        <button
          type="button"
          onClick={handleClearCategoryFilter}
          className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-full bg-[var(--accent-muted)] text-[var(--accent)] border border-[var(--accent)] hover:bg-[var(--accent)] hover:text-white transition-colors duration-[var(--transition-fast)] cursor-pointer"
          aria-label={`Clear category filter for ${getCategoryLabel(singleCategorySelected)}`}
        >
          <span>Category: {getCategoryLabel(singleCategorySelected)}</span>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  ) : null;

  return (
    <>
    <div className="sr-only" aria-live="polite" role="status">{screenReaderMessage}</div>
    <div>
      <RefreshIndicator visible={isRefreshing} />
      {staleBanner}
      {activeChips}
      {/* Toolbar */}
      <div className="mb-6">
        {/* Primary row: Search + Filters toggle + View toggle + Refresh */}
        <div className="flex gap-3">
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
              placeholder="Search listings by name, description, or seller PKH..."
              value={searchQuery}
              onChange={(e) => dispatch({ type: 'SET_SEARCH', payload: e.target.value })}
              aria-label="Search listings"
              className="w-full pl-10 pr-8 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:shadow-[var(--shadow-glow)] transition-all duration-[var(--transition-fast)]"
            />
            {searchQuery && (
              <button
                onClick={() => dispatch({ type: 'SET_SEARCH', payload: '' })}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                aria-label="Clear search"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Filters Toggle */}
          <button
            onClick={() => setFiltersOpen((o) => !o)}
            className={`flex items-center gap-2 px-3 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary cursor-pointer ${
              filtersOpen ? 'bg-[var(--accent-muted)] text-[var(--accent)] border-[var(--accent)]' : ''
            }`}
            aria-label="Toggle filters"
            aria-expanded={filtersOpen}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            <span>Filters</span>
            {panelFilterCount > 0 && (
              <span className="bg-[var(--accent)] text-white rounded-full text-xs w-5 h-5 flex items-center justify-center font-medium">
                {panelFilterCount}
              </span>
            )}
          </button>

          {/* Layout (view + size + columns) */}
          <LayoutPopover
            viewMode={viewMode}
            cardSize={cardSize}
            columnCount={columnCount}
            onViewModeChange={(mode) => dispatch({ type: 'SET_VIEW', payload: mode })}
            onCardSizeChange={(size: CardSize) => dispatch({ type: 'SET_CARD_SIZE', payload: size })}
            onColumnCountChange={(cols: ColumnCount) => dispatch({ type: 'SET_COLUMN_COUNT', payload: cols })}
          />

          {/* Refresh */}
          <button
            onClick={() => { fetchEncryptions(); onLocalRefresh?.(); }}
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

        {/* Collapsible filter panel */}
        {filtersOpen && (
          <div className="flex flex-wrap items-center justify-evenly gap-y-4 mt-3 p-4 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)]">
            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => dispatch({ type: 'SET_STATUS', payload: e.target.value as MarketplaceFilters['statusFilter'] })}
              aria-label="Filter by status"
              className="px-3 py-2 text-sm bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
            </select>

            {/* Category Filter */}
            <CategoryFilter
              selected={categoryFilter}
              onChange={(next) => dispatch({ type: 'SET_CATEGORY', payload: next })}
            />

            {/* Price Range Slider */}
            <PriceRangeSlider
              min={priceRange.min}
              max={priceRange.max}
              valueMin={priceMin}
              valueMax={priceMax}
              onChangeMin={(v) => dispatch({ type: 'SET_PRICE_MIN', payload: v })}
              onChangeMax={(v) => dispatch({ type: 'SET_PRICE_MAX', payload: v })}
            />

            {/* Date Range (filters by UTxO creation date, not original listing date) */}
            <DateFilter
              label="After"
              value={dateFrom}
              onChange={(v) => dispatch({ type: 'SET_DATE_FROM', payload: v })}
              ariaLabel="UTxO created after date"
            />
            <DateFilter
              label="Before"
              value={dateTo}
              onChange={(v) => dispatch({ type: 'SET_DATE_TO', payload: v })}
              ariaLabel="UTxO created before date"
            />

            {/* Sort */}
            <select
              value={sortBy}
              onChange={(e) => dispatch({ type: 'SET_SORT', payload: e.target.value as MarketplaceFilters['sortBy'] })}
              aria-label="Sort listings"
              className="px-3 py-2 text-sm bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="price-high">Price: High to Low</option>
              <option value="price-low">Price: Low to High</option>
              <option value="most-bids">Most Bids</option>
              <option value="alpha-asc">A → Z (Description)</option>
              <option value="alpha-desc">Z → A (Description)</option>
            </select>

            {/* Favorites Toggle */}
            <button
              onClick={() => dispatch({ type: 'SET_FAVORITES_ONLY', payload: !showFavoritesOnly })}
              className={`px-3 py-2 border rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer ${
                showFavoritesOnly
                  ? 'bg-[var(--accent-muted)] text-[var(--accent)] border-[var(--accent)]'
                  : 'bg-[var(--bg-primary)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
              title={showFavoritesOnly ? 'Show all listings' : 'Show favorites only'}
              aria-label={showFavoritesOnly ? 'Show all listings' : 'Show favorites only'}
              aria-pressed={showFavoritesOnly}
            >
              <svg className="w-4 h-4" fill={showFavoritesOnly ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </button>

            {/* Hide Own Listings Toggle */}
            <button
              onClick={() => dispatch({ type: 'SET_HIDE_OWN', payload: !hideOwnListings })}
              className={`px-3 py-2 border rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer ${
                hideOwnListings
                  ? 'bg-[var(--accent-muted)] text-[var(--accent)] border-[var(--accent)]'
                  : 'bg-[var(--bg-primary)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
              title={hideOwnListings ? 'Showing others only' : 'Hide your own listings'}
              aria-label={hideOwnListings ? 'Showing others only' : 'Hide your own listings'}
              aria-pressed={hideOwnListings}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                {hideOwnListings && (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 20L20 4" />
                )}
              </svg>
            </button>

            {/* Hide NSFW Toggle */}
            <button
              onClick={() => dispatch({ type: 'SET_HIDE_NSFW', payload: !hideNsfw })}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer ${
                hideNsfw
                  ? 'bg-[var(--accent-muted)] text-[var(--accent)] border-[var(--accent)]'
                  : 'bg-[var(--bg-primary)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
              title={hideNsfw ? 'NSFW hidden' : 'Hide NSFW listings'}
              aria-label={hideNsfw ? 'NSFW hidden' : 'Hide NSFW listings'}
              aria-pressed={hideNsfw}
            >
              <span className="text-xs font-bold">NSFW</span>
              {hideNsfw && (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Results Count + Clear Filters */}
      <div role="status" className="mb-4 flex items-center gap-3 text-sm text-[var(--text-muted)]">
        <span>
          {hasMore
            ? `Showing ${paginatedResults.length} of ${filteredAndSorted.length} ${filteredAndSorted.length === 1 ? 'listing' : 'listings'}`
            : `${filteredAndSorted.length} ${filteredAndSorted.length === 1 ? 'listing' : 'listings'}`}
        </span>
        {activeFilterCount > 0 && (
          <button
            onClick={() => dispatch({ type: 'CLEAR_FILTERS' })}
            className="text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors duration-[var(--transition-fast)] cursor-pointer"
          >
            {activeFilterCount} {activeFilterCount === 1 ? 'filter' : 'filters'} active &mdash; Clear
          </button>
        )}
      </div>

      {/* Content */}
      {filteredAndSorted.length === 0 ? (
        activeFilterCount > 0 ? (
          <EmptyState
            illustration={<NoResultsIllustration />}
            title="No matching listings"
            description="Try adjusting your search or filters"
            action={
              <button
                onClick={() => dispatch({ type: 'CLEAR_FILTERS' })}
                className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
              >
                Clear Filters
              </button>
            }
          />
        ) : (
          <EmptyState
            illustration={<MarketplaceEmptyIllustration />}
            title="No listings available yet"
            description="Be the first to create one!"
            action={onCreateListing && (
              <button
                onClick={onCreateListing}
                className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
              >
                Create Listing
              </button>
            )}
          />
        )
      ) : viewMode === 'grid' ? (
        <div className={getGridClasses(columnCount)}>
          {paginatedResults.map((encryption, index) => (
            <div key={encryption.tokenName} className="card-stagger" style={{ animationDelay: `${Math.min(index, 9) * 50}ms` }}>
              <EncryptionCard
                encryption={encryption}
                onPlaceBid={onPlaceBid}
                isOwnListing={isOwnListing(encryption)}
                hasBid={userBidEncryptionTokens.has(encryption.tokenName)}
                cardSize={cardSize}
                initialCached={imageCacheStatus.cached.includes(encryption.tokenName)}
                initialBanned={imageCacheStatus.banned.includes(encryption.tokenName)}
                bidCount={getBidCount(encryption.tokenName)}
                lovelace={lovelace}
                isFavorite={favorites.has(encryption.tokenName)}
                onToggleFavorite={handleToggleFavorite}
                onFilterBySeller={handleFilterBySeller}
                onFilterByCategory={handleFilterByCategory}
                searchQuery={searchQuery}
                nsfwEnabled={nsfwEnabled}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedResults.map((encryption, index) => (
            <div key={encryption.tokenName} className="card-stagger" style={{ animationDelay: `${Math.min(index, 9) * 50}ms` }}>
              <EncryptionCard
                encryption={encryption}
                onPlaceBid={onPlaceBid}
                isOwnListing={isOwnListing(encryption)}
                hasBid={userBidEncryptionTokens.has(encryption.tokenName)}
                compact
                initialCached={imageCacheStatus.cached.includes(encryption.tokenName)}
                initialBanned={imageCacheStatus.banned.includes(encryption.tokenName)}
                bidCount={getBidCount(encryption.tokenName)}
                lovelace={lovelace}
                isFavorite={favorites.has(encryption.tokenName)}
                onToggleFavorite={handleToggleFavorite}
                onFilterBySeller={handleFilterBySeller}
                onFilterByCategory={handleFilterByCategory}
                searchQuery={searchQuery}
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
    </div>
    </>
  );
}

export default memo(MarketplaceTab);
