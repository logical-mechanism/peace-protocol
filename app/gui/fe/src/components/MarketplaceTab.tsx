import { useState, useEffect, useMemo, useCallback } from 'react';
import { encryptionsApi, bidsApi } from '../services/api';
import type { EncryptionDisplay } from '../services/api';
import EncryptionCard from './EncryptionCard';
import LoadingSpinner from './LoadingSpinner';
import EmptyState, { PackageIcon, SearchIcon } from './EmptyState';

type ViewMode = 'grid' | 'list';
type SortOption = 'newest' | 'oldest' | 'price-high' | 'price-low';
type StatusFilter = 'all' | 'active' | 'pending';

interface MarketplaceTabProps {
  userPkh?: string;
  onPlaceBid?: (encryption: EncryptionDisplay) => void;
}

export default function MarketplaceTab({ userPkh, onPlaceBid }: MarketplaceTabProps) {
  const [encryptions, setEncryptions] = useState<EncryptionDisplay[]>([]);
  const [userBidEncryptionTokens, setUserBidEncryptionTokens] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchEncryptions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, allBids] = await Promise.all([
        encryptionsApi.getAll(),
        bidsApi.getAll(),
      ]);
      setEncryptions(data);

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

  // Filter and sort encryptions
  const filteredAndSorted = useMemo(() => {
    let result = [...encryptions];

    // Filter by status
    if (statusFilter !== 'all') {
      result = result.filter((e) => e.status === statusFilter);
    }

    // Search filter (by token name or seller address)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.tokenName.toLowerCase().includes(query) ||
          e.seller.toLowerCase().includes(query)
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
    }

    return result;
  }, [encryptions, statusFilter, searchQuery, sortBy]);

  const isOwnListing = useCallback(
    (encryption: EncryptionDisplay) => {
      if (!userPkh) return false;
      return encryption.sellerPkh === userPkh;
    },
    [userPkh]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <LoadingSpinner size="lg" className="mx-auto mb-4" />
          <p className="text-[var(--text-muted)]">Loading marketplace...</p>
        </div>
      </div>
    );
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
            className="px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-all duration-150 cursor-pointer"
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
            placeholder="Search by token or seller..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search listings"
            className="w-full pl-10 pr-4 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:shadow-[var(--shadow-glow)] transition-all duration-150"
          />
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="price-high">Price: High to Low</option>
            <option value="price-low">Price: Low to High</option>
          </select>

          {/* View Toggle */}
          <div className="flex border border-[var(--border-subtle)] rounded-[var(--radius-md)] overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
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
              onClick={() => setViewMode('list')}
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
            className="px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-all duration-150 cursor-pointer"
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
      <div className="mb-4 text-sm text-[var(--text-muted)]">
        {filteredAndSorted.length} {filteredAndSorted.length === 1 ? 'listing' : 'listings'} found
      </div>

      {/* Content */}
      {filteredAndSorted.length === 0 ? (
        searchQuery || statusFilter !== 'all' ? (
          <EmptyState
            icon={<SearchIcon />}
            title="No matching listings"
            description="Try adjusting your search or filters"
            action={
              <button
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('all');
                }}
                className="px-4 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition-all duration-150 cursor-pointer"
              >
                Clear Filters
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={<PackageIcon />}
            title="No listings available"
            description="Listings will appear here once sellers create encryptions"
          />
        )
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAndSorted.map((encryption) => (
            <EncryptionCard
              key={encryption.tokenName}
              encryption={encryption}
              onPlaceBid={onPlaceBid}
              isOwnListing={isOwnListing(encryption)}
              hasBid={userBidEncryptionTokens.has(encryption.tokenName)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAndSorted.map((encryption) => (
            <EncryptionCard
              key={encryption.tokenName}
              encryption={encryption}
              onPlaceBid={onPlaceBid}
              isOwnListing={isOwnListing(encryption)}
              hasBid={userBidEncryptionTokens.has(encryption.tokenName)}
              compact
            />
          ))}
        </div>
      )}
    </div>
  );
}
