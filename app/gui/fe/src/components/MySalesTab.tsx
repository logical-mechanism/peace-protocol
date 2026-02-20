import { useState, useEffect, useMemo, useCallback } from 'react';
import { encryptionsApi, bidsApi } from '../services/api';
import type { EncryptionDisplay, BidDisplay } from '../services/api';
import SalesListingCard from './SalesListingCard';
import BidsModal from './BidsModal';
import LoadingSpinner from './LoadingSpinner';
import EmptyState, { PackageIcon, SearchIcon, InboxIcon } from './EmptyState';
import { listCachedImages, type ImageCacheStatus } from '../services/imageCache';

type ViewMode = 'grid' | 'list';
type SortOption = 'newest' | 'oldest' | 'price-high' | 'price-low' | 'most-bids';
type StatusFilter = 'all' | 'active' | 'pending' | 'completed';

interface MySalesTabProps {
  userPkh?: string;
  onRemoveListing?: (encryption: EncryptionDisplay) => void;
  onAcceptBid?: (encryption: EncryptionDisplay, bid: BidDisplay) => void;
  onCancelPending?: (encryption: EncryptionDisplay) => void;
  onCompleteSale?: (encryption: EncryptionDisplay) => void;
  onCreateListing?: () => void;
}

export default function MySalesTab({
  userPkh,
  onRemoveListing,
  onAcceptBid,
  onCancelPending,
  onCompleteSale,
  onCreateListing,
}: MySalesTabProps) {
  const [encryptions, setEncryptions] = useState<EncryptionDisplay[]>([]);
  const [bidsMap, setBidsMap] = useState<Map<string, BidDisplay[]>>(new Map());
  const [imageCacheStatus, setImageCacheStatus] = useState<ImageCacheStatus>({ cached: [], banned: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

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

      // Fetch image cache status for all listings
      listCachedImages().then(setImageCacheStatus).catch(() => {});

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

  // Get bid count for a listing
  const getBidCount = useCallback(
    (tokenName: string): number => {
      const bids = bidsMap.get(tokenName) || [];
      return bids.filter((b) => b.status === 'pending').length;
    },
    [bidsMap]
  );

  // Filter and sort encryptions
  const filteredAndSorted = useMemo(() => {
    let result = [...encryptions];

    // Filter by status
    if (statusFilter !== 'all') {
      result = result.filter((e) => e.status === statusFilter);
    }

    // Search filter (by token name or description)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.tokenName.toLowerCase().includes(query) ||
          (e.description && e.description.toLowerCase().includes(query))
      );
    }

    // Sort
    switch (sortBy) {
      case 'newest':
        result.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        break;
      case 'oldest':
        result.sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
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
  }, [encryptions, statusFilter, searchQuery, sortBy, getBidCount]);

  // Handlers
  const handleViewBids = useCallback((encryption: EncryptionDisplay) => {
    setSelectedListing(encryption);
    setBidsModalOpen(true);
  }, []);

  const handleCloseBidsModal = useCallback(() => {
    setBidsModalOpen(false);
    setSelectedListing(null);
  }, []);

  const handleRemoveListing = useCallback(
    (encryption: EncryptionDisplay) => {
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <LoadingSpinner size="lg" className="mx-auto mb-4" />
          <p className="text-[var(--text-muted)]">Loading your listings...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<PackageIcon />}
        title="Failed to load your listings"
        description={error}
        action={
          <button
            onClick={fetchData}
            className="px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-all duration-150 cursor-pointer"
          >
            Try Again
          </button>
        }
      />
    );
  }

  // If user has no listings at all
  if (encryptions.length === 0) {
    return (
      <EmptyState
        icon={<InboxIcon />}
        title="No listings yet"
        description="Create your first encryption listing to start selling on the marketplace"
        action={
          <button
            onClick={onCreateListing}
            className="px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-all duration-150 cursor-pointer"
          >
            Create Listing
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
            onChange={(e) => setSearchQuery(e.target.value)}
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
            <option value="completed">Completed</option>
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
            <option value="most-bids">Most Bids</option>
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
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            className="px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-all duration-150 cursor-pointer"
            title="Refresh listings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        {filteredAndSorted.length} {filteredAndSorted.length === 1 ? 'listing' : 'listings'}
        {statusFilter !== 'all' && ` (${statusFilter})`}
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
            title="No listings found"
            description="Your listings will appear here"
          />
        )
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAndSorted.map((encryption) => (
            <SalesListingCard
              key={encryption.tokenName}
              encryption={encryption}
              bidCount={getBidCount(encryption.tokenName)}
              onViewBids={handleViewBids}
              onRemove={handleRemoveListing}
              onCancelPending={handleCancelPending}
              onCompleteSale={onCompleteSale}
              initialCached={imageCacheStatus.cached.includes(encryption.tokenName)}
              initialBanned={imageCacheStatus.banned.includes(encryption.tokenName)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAndSorted.map((encryption) => (
            <SalesListingCard
              key={encryption.tokenName}
              encryption={encryption}
              bidCount={getBidCount(encryption.tokenName)}
              onViewBids={handleViewBids}
              onRemove={handleRemoveListing}
              onCancelPending={handleCancelPending}
              compact
              initialCached={imageCacheStatus.cached.includes(encryption.tokenName)}
              initialBanned={imageCacheStatus.banned.includes(encryption.tokenName)}
            />
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
  );
}
