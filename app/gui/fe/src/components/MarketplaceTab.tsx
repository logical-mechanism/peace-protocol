import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useNode } from '../contexts/NodeContext';
import { encryptionsApi, bidsApi } from '../services/api';
import { optimisticStore } from '../services/optimisticStore';
import type { EncryptionDisplay, BidDisplay } from '../services/api';
import EncryptionCard from './EncryptionCard';
import { SkeletonGrid } from './SkeletonCard';
import EmptyState, { PackageIcon } from './EmptyState';
import { MarketplaceEmptyIllustration, NoResultsIllustration } from './EmptyStateIllustrations';
import { listCachedImages, type ImageCacheStatus } from '../services/imageCache';
import { getFavorites, toggleFavorite } from '../services/favoritesStorage';
import PriceRangeSlider from './PriceRangeSlider';
import CategoryFilter from './CategoryFilter';
import RefreshIndicator from './RefreshIndicator';
import type { MarketplaceFilters, MarketplaceAction } from '../hooks/useTabFilterState';
import { useDebounce } from '../hooks/useDebounce';
import { filterListings, sortListings, countActiveFilters, countPanelFilters } from '../services/marketplaceFilters';

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
  const [userBidEncryptionTokens, setUserBidEncryptionTokens] = useState<Set<string>>(new Set());
  const [imageCacheStatus, setImageCacheStatus] = useState<ImageCacheStatus>({ cached: [], banned: [], total_bytes: 0 });
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [prevDataCount, setPrevDataCount] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Close filters panel on Escape key
  useEffect(() => {
    if (!filtersOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFiltersOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [filtersOpen]);

  // Destructure filter state from Dashboard-level reducer
  const { viewMode, sortBy, statusFilter, categoryFilter, hideOwnListings, dateFrom, dateTo, searchQuery, priceMin, priceMax, showFavoritesOnly, currentPage } = filters;
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

      // Build set of encryption tokens the user has pending bids on
      if (userPkh) {
        const userBidTokens = new Set<string>(
          bidResult.data
            .filter((b) => b.bidderPkh === userPkh && b.status === 'pending')
            .map((b) => b.encryptionToken)
        );
        setUserBidEncryptionTokens(userBidTokens);
      }
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
  }, [userPkh]);

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
  }), [statusFilter, categoryFilter, hideOwnListings, userPkh, showFavoritesOnly, favorites, priceMin, priceMax, debouncedSearch, dateFrom, dateTo]);

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
  const ITEMS_PER_PAGE = 20;

  const paginatedResults = useMemo(() => {
    return filteredAndSorted.slice(0, currentPage * ITEMS_PER_PAGE);
  }, [filteredAndSorted, currentPage]);

  const hasMore = paginatedResults.length < filteredAndSorted.length;

  // IntersectionObserver for auto-loading when scrolling near the bottom
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          dispatch({ type: 'SET_PAGE', payload: currentPage + 1 });
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, currentPage, dispatch]);

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

  return (
    <>
    <div className="sr-only" aria-live="polite" role="status">{screenReaderMessage}</div>
    <div>
      <RefreshIndicator visible={isRefreshing} />
      {staleBanner}
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
              placeholder="Search listings by name or seller..."
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
          <div className="flex flex-wrap items-center gap-3 mt-3 p-4 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)]">
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

            {/* Hide Own Listings Toggle */}
            <button
              onClick={() => dispatch({ type: 'SET_HIDE_OWN', payload: !hideOwnListings })}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer ${
                hideOwnListings
                  ? 'bg-[var(--accent-muted)] text-[var(--accent)] border-[var(--accent)]'
                  : 'bg-[var(--bg-primary)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
              title={hideOwnListings ? 'Show all listings' : 'Hide your own listings'}
              aria-label={hideOwnListings ? 'Show all listings' : 'Hide your own listings'}
              aria-pressed={hideOwnListings}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                {hideOwnListings ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                )}
              </svg>
              <span>Hide Mine</span>
            </button>

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
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">After</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => dispatch({ type: 'SET_DATE_FROM', payload: e.target.value })}
                aria-label="UTxO created after date"
                className="px-2 py-1.5 text-sm bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              />
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">Before</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => dispatch({ type: 'SET_DATE_TO', payload: e.target.value })}
                aria-label="UTxO created before date"
                className="px-2 py-1.5 text-sm bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {paginatedResults.map((encryption, index) => (
            <div key={encryption.tokenName} className="card-stagger" style={{ animationDelay: `${Math.min(index, 9) * 50}ms` }}>
              <EncryptionCard
                encryption={encryption}
                onPlaceBid={onPlaceBid}
                isOwnListing={isOwnListing(encryption)}
                hasBid={userBidEncryptionTokens.has(encryption.tokenName)}
                initialCached={imageCacheStatus.cached.includes(encryption.tokenName)}
                initialBanned={imageCacheStatus.banned.includes(encryption.tokenName)}
                bidCount={getBidCount(encryption.tokenName)}
                lovelace={lovelace}
                isFavorite={favorites.has(encryption.tokenName)}
                onToggleFavorite={handleToggleFavorite}
                searchQuery={searchQuery}
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
                searchQuery={searchQuery}
              />
            </div>
          ))}
        </div>
      )}

      {/* Load More */}
      {hasMore && (
        <div className="flex flex-col items-center gap-3 mt-6">
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
