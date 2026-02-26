import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { encryptionsApi, bidsApi } from '../services/api';
import type { EncryptionDisplay, BidDisplay } from '../services/api';
import EncryptionCard from './EncryptionCard';
import { SkeletonGrid } from './SkeletonCard';
import EmptyState, { PackageIcon } from './EmptyState';
import { MarketplaceEmptyIllustration, NoResultsIllustration } from './EmptyStateIllustrations';
import { listCachedImages, type ImageCacheStatus } from '../services/imageCache';
import { FILE_CATEGORIES } from '../config/categories';
import { getFavorites, toggleFavorite } from '../services/favoritesStorage';
import PriceRangeSlider from './PriceRangeSlider';
import type { MarketplaceFilters, MarketplaceAction } from '../hooks/useTabFilterState';

interface MarketplaceTabProps {
  userPkh?: string;
  onPlaceBid?: (encryption: EncryptionDisplay, bidCount: number) => void;
  refreshSignal?: number;
  filters: MarketplaceFilters;
  dispatch: React.Dispatch<MarketplaceAction>;
}

function MarketplaceTab({ userPkh, onPlaceBid, refreshSignal, filters, dispatch }: MarketplaceTabProps) {
  const [encryptions, setEncryptions] = useState<EncryptionDisplay[]>([]);
  const [allBids, setAllBids] = useState<BidDisplay[]>([]);
  const [userBidEncryptionTokens, setUserBidEncryptionTokens] = useState<Set<string>>(new Set());
  const [imageCacheStatus, setImageCacheStatus] = useState<ImageCacheStatus>({ cached: [], banned: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  // Destructure filter state from Dashboard-level reducer
  const { viewMode, sortBy, statusFilter, categoryFilter, searchQuery, priceMin, priceMax, showFavoritesOnly, currentPage } = filters;

  const fetchEncryptions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, allBids] = await Promise.all([
        encryptionsApi.getAll(),
        bidsApi.getAll(),
      ]);
      setEncryptions(data);
      setAllBids(allBids);

      // Fetch image cache status for all listings
      listCachedImages().then(setImageCacheStatus).catch(() => {});

      // Build set of encryption tokens the user has pending bids on
      if (userPkh) {
        const userBidTokens = new Set<string>(
          allBids
            .filter((b) => b.bidderPkh === userPkh && b.status === 'pending')
            .map((b) => b.encryptionToken)
        );
        setUserBidEncryptionTokens(userBidTokens);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch listings');
    } finally {
      setLoading(false);
    }
  }, [userPkh]);

  useEffect(() => {
    fetchEncryptions();
  }, [fetchEncryptions]);

  // Re-fetch when Dashboard signals a refresh (e.g. after a transaction)
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    fetchEncryptions();
  }, [refreshSignal]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Compute price range from all listings for the slider
  const priceRange = useMemo(() => {
    let maxPrice = 0;
    for (const e of encryptions) {
      if (e.suggestedPrice != null && e.suggestedPrice > maxPrice) {
        maxPrice = e.suggestedPrice;
      }
    }
    return { min: 0, max: Math.max(maxPrice, 1) };
  }, [encryptions]);

  // Filter and sort encryptions
  const filteredAndSorted = useMemo(() => {
    let result = [...encryptions];

    // Filter by status
    if (statusFilter !== 'all') {
      result = result.filter((e) => e.status === statusFilter);
    }

    // Filter by category
    if (categoryFilter !== 'all') {
      result = result.filter((e) => (e.category || 'text') === categoryFilter);
    }

    // Filter by favorites
    if (showFavoritesOnly) {
      result = result.filter((e) => favorites.has(e.tokenName));
    }

    // Filter by price range
    if (priceMin !== '' || priceMax !== '') {
      const min = priceMin !== '' ? Number(priceMin) : -Infinity;
      const max = priceMax !== '' ? Number(priceMax) : Infinity;
      if (!isNaN(min) && !isNaN(max)) {
        result = result.filter((e) => {
          const price = e.suggestedPrice ?? 0;
          return price >= min && price <= max;
        });
      }
    }

    // Search filter (by token name, seller address, or description)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.tokenName.toLowerCase().includes(query) ||
          e.seller.toLowerCase().includes(query) ||
          (e.description && e.description.toLowerCase().includes(query))
      );
    }

    // Sort
    switch (sortBy) {
      case 'newest':
        result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case 'oldest':
        result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        break;
      case 'price-high':
        result.sort((a, b) => (b.suggestedPrice ?? 0) - (a.suggestedPrice ?? 0));
        break;
      case 'price-low':
        result.sort((a, b) => (a.suggestedPrice ?? 0) - (b.suggestedPrice ?? 0));
        break;
      case 'most-bids':
        result.sort((a, b) => getBidCount(b.tokenName) - getBidCount(a.tokenName));
        break;
    }

    return result;
  }, [encryptions, statusFilter, categoryFilter, showFavoritesOnly, favorites, priceMin, priceMax, searchQuery, sortBy, getBidCount]);

  const isOwnListing = useCallback(
    (encryption: EncryptionDisplay) => {
      if (!userPkh) return false;
      return encryption.sellerPkh === userPkh;
    },
    [userPkh]
  );

  // Count active (non-default) filters for "clear all" indicator
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (searchQuery !== '') count++;
    if (sortBy !== 'newest') count++;
    if (statusFilter !== 'all') count++;
    if (categoryFilter !== 'all') count++;
    if (priceMin !== '') count++;
    if (priceMax !== '') count++;
    if (showFavoritesOnly) count++;
    return count;
  }, [searchQuery, sortBy, statusFilter, categoryFilter, priceMin, priceMax, showFavoritesOnly]);

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

  if (loading) {
    return <SkeletonGrid />;
  }

  if (error) {
    return (
      <EmptyState
        icon={<PackageIcon />}
        title="Failed to load listings"
        description={error}
        action={
          <button
            onClick={fetchEncryptions}
            className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
          >
            Try Again
          </button>
        }
      />
    );
  }

  return (
    <div>
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
            placeholder="Search by token, seller, or description..."
            value={searchQuery}
            onChange={(e) => dispatch({ type: 'SET_SEARCH', payload: e.target.value })}
            aria-label="Search listings"
            className="w-full pl-10 pr-4 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:shadow-[var(--shadow-glow)] transition-all duration-150"
          />
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => dispatch({ type: 'SET_STATUS', payload: e.target.value as MarketplaceFilters['statusFilter'] })}
            aria-label="Filter by status"
            className="px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
          </select>

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => dispatch({ type: 'SET_CATEGORY', payload: e.target.value })}
            aria-label="Filter by category"
            className="px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            <option value="all">All Categories</option>
            {FILE_CATEGORIES.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.label}</option>
            ))}
          </select>

          {/* Price Range Slider */}
          <PriceRangeSlider
            min={priceRange.min}
            max={priceRange.max}
            valueMin={priceMin}
            valueMax={priceMax}
            onChangeMin={(v) => dispatch({ type: 'SET_PRICE_MIN', payload: v })}
            onChangeMax={(v) => dispatch({ type: 'SET_PRICE_MAX', payload: v })}
          />

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => dispatch({ type: 'SET_SORT', payload: e.target.value as MarketplaceFilters['sortBy'] })}
            aria-label="Sort listings"
            className="px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="price-high">Price: High to Low</option>
            <option value="price-low">Price: Low to High</option>
            <option value="most-bids">Most Bids</option>
          </select>

          {/* Favorites Toggle */}
          <button
            onClick={() => dispatch({ type: 'SET_FAVORITES_ONLY', payload: !showFavoritesOnly })}
            className={`px-3 py-2 border rounded-[var(--radius-md)] transition-all duration-150 cursor-pointer ${
              showFavoritesOnly
                ? 'bg-[var(--accent-muted)] text-[var(--accent)] border-[var(--accent)]'
                : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
            title={showFavoritesOnly ? 'Show all listings' : 'Show favorites only'}
            aria-label={showFavoritesOnly ? 'Show all listings' : 'Show favorites only'}
            aria-pressed={showFavoritesOnly}
          >
            <svg className="w-4 h-4" fill={showFavoritesOnly ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          </button>

          {/* View Toggle */}
          <div className="flex border border-[var(--border-subtle)] rounded-[var(--radius-md)] overflow-hidden" role="group" aria-label="View mode">
            <button
              onClick={() => dispatch({ type: 'SET_VIEW', payload: 'grid' })}
              className={`px-3 py-2 transition-all duration-150 cursor-pointer ${
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
              className={`px-3 py-2 transition-all duration-150 cursor-pointer ${
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
            onClick={fetchEncryptions}
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

      {/* Results Count + Clear Filters */}
      <div className="mb-4 flex items-center gap-3 text-sm text-[var(--text-muted)]">
        <span>
          {filteredAndSorted.length} {filteredAndSorted.length === 1 ? 'listing' : 'listings'} found
        </span>
        {activeFilterCount > 0 && (
          <button
            onClick={() => dispatch({ type: 'CLEAR_FILTERS' })}
            className="text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors duration-150 cursor-pointer"
          >
            {activeFilterCount} {activeFilterCount === 1 ? 'filter' : 'filters'} active &mdash; Clear
          </button>
        )}
      </div>

      {/* Content */}
      {filteredAndSorted.length === 0 ? (
        searchQuery || statusFilter !== 'all' || categoryFilter !== 'all' || priceMin !== '' || priceMax !== '' || showFavoritesOnly ? (
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
            title="No listings available"
            description="Listings will appear here once sellers create encryptions"
          />
        )
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {paginatedResults.map((encryption) => (
            <EncryptionCard
              key={encryption.tokenName}
              encryption={encryption}
              onPlaceBid={onPlaceBid}
              isOwnListing={isOwnListing(encryption)}
              hasBid={userBidEncryptionTokens.has(encryption.tokenName)}
              initialCached={imageCacheStatus.cached.includes(encryption.tokenName)}
              initialBanned={imageCacheStatus.banned.includes(encryption.tokenName)}
              bidCount={getBidCount(encryption.tokenName)}
              isFavorite={favorites.has(encryption.tokenName)}
              onToggleFavorite={handleToggleFavorite}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedResults.map((encryption) => (
            <EncryptionCard
              key={encryption.tokenName}
              encryption={encryption}
              onPlaceBid={onPlaceBid}
              isOwnListing={isOwnListing(encryption)}
              hasBid={userBidEncryptionTokens.has(encryption.tokenName)}
              compact
              initialCached={imageCacheStatus.cached.includes(encryption.tokenName)}
              initialBanned={imageCacheStatus.banned.includes(encryption.tokenName)}
              bidCount={getBidCount(encryption.tokenName)}
              isFavorite={favorites.has(encryption.tokenName)}
              onToggleFavorite={handleToggleFavorite}
              searchQuery={searchQuery}
            />
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
  );
}

export default memo(MarketplaceTab);
