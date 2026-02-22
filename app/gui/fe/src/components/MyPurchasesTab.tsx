import { useState, useEffect, useMemo, useCallback } from 'react';
import { bidsApi, encryptionsApi } from '../services/api';
import type { BidDisplay, EncryptionDisplay } from '../services/api';
import { getBidSecretsForEncryption } from '../services/bidSecretStorage';
import MyPurchaseBidCard from './MyPurchaseBidCard';
import DescriptionModal from './DescriptionModal';
import { truncateDescription } from './descriptionUtils';
import LoadingSpinner from './LoadingSpinner';
import EmptyState, { PackageIcon, SearchIcon, InboxIcon } from './EmptyState';

type ViewMode = 'grid' | 'list';
type SortOption = 'newest' | 'oldest' | 'amount-high' | 'amount-low';
type StatusFilter = 'all' | 'pending' | 'accepted' | 'rejected' | 'cancelled';

interface MyPurchasesTabProps {
  userPkh?: string;
  onCancelBid?: (bid: BidDisplay) => void;
  onDecrypt?: (bid: BidDisplay) => void;
  onDecryptEncryption?: (encryption: EncryptionDisplay) => void;
}

export default function MyPurchasesTab({
  userPkh,
  onCancelBid,
  onDecrypt,
  onDecryptEncryption,
}: MyPurchasesTabProps) {
  const [bids, setBids] = useState<BidDisplay[]>([]);
  const [encryptionsMap, setEncryptionsMap] = useState<Map<string, EncryptionDisplay>>(new Map());
  const [purchasedEncryptions, setPurchasedEncryptions] = useState<EncryptionDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [descModalOpen, setDescModalOpen] = useState(false);
  const [descModalContent, setDescModalContent] = useState('');
  const [descModalToken, setDescModalToken] = useState<string | undefined>();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch all bids and filter by bidder PKH from datum
      const allBids = await bidsApi.getAll();
      const userBids = userPkh
        ? allBids.filter((b) => b.bidderPkh === userPkh)
        : [];
      setBids(userBids);

      // Fetch all encryptions (needed for both bids and purchased encryptions)
      const allEncryptions = await encryptionsApi.getAll();

      // Build encryption map for user bids
      const newEncryptionsMap = new Map<string, EncryptionDisplay>();
      userBids.forEach((bid) => {
        const encryption = allEncryptions.find(
          (e) => e.tokenName === bid.encryptionToken
        );
        if (encryption) {
          newEncryptionsMap.set(bid.encryptionToken, encryption);
        }
      });
      setEncryptionsMap(newEncryptionsMap);

      // Find purchased encryptions: user is owner AND has bid secrets in IndexedDB
      if (userPkh) {
        const userOwnedEncryptions = allEncryptions.filter(
          (e) => e.sellerPkh === userPkh && e.datum.full_level !== null
        );

        const purchased: EncryptionDisplay[] = [];
        for (const enc of userOwnedEncryptions) {
          try {
            const secrets = await getBidSecretsForEncryption(enc.tokenName);
            if (secrets.length > 0) {
              purchased.push(enc);
            }
          } catch {
            // Skip if IndexedDB lookup fails
          }
        }
        setPurchasedEncryptions(purchased);
      } else {
        setPurchasedEncryptions([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch your bids');
    } finally {
      setLoading(false);
    }
  }, [userPkh]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Get encryption for a bid
  const getEncryption = useCallback(
    (encryptionToken: string): EncryptionDisplay | undefined => {
      return encryptionsMap.get(encryptionToken);
    },
    [encryptionsMap]
  );

  // Filter and sort bids
  const filteredAndSorted = useMemo(() => {
    let result = [...bids];

    // Filter by status
    if (statusFilter !== 'all') {
      result = result.filter((b) => b.status === statusFilter);
    }

    // Search filter (by token name, encryption token, or encryption description)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((b) => {
        const encryption = encryptionsMap.get(b.encryptionToken);
        return (
          b.tokenName.toLowerCase().includes(query) ||
          b.encryptionToken.toLowerCase().includes(query) ||
          (encryption?.description && encryption.description.toLowerCase().includes(query))
        );
      });
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
      case 'amount-high':
        result.sort((a, b) => b.amount - a.amount);
        break;
      case 'amount-low':
        result.sort((a, b) => a.amount - b.amount);
        break;
    }

    return result;
  }, [bids, statusFilter, searchQuery, sortBy, encryptionsMap]);

  // Handlers
  const handleCancelBid = useCallback(
    (bid: BidDisplay) => {
      if (onCancelBid) {
        onCancelBid(bid);
      } else {
        // Placeholder for Phase 10
        alert(
          `Cancel bid coming in Phase 10!\n\nThis will require a transaction to remove the bid from the contract.\n\nBid: ${(bid.amount / 1_000_000).toLocaleString()} ADA\nToken: ${bid.tokenName.slice(0, 16)}...`
        );
      }
    },
    [onCancelBid]
  );

  const handleDecrypt = useCallback(
    (bid: BidDisplay) => {
      if (onDecrypt) {
        onDecrypt(bid);
      } else {
        // Placeholder for Phase 13
        alert(
          `Decryption coming in Phase 13!\n\nAfter your bid is accepted, you'll be able to decrypt the message using your private key.\n\nEncryption: ${bid.encryptionToken.slice(0, 16)}...`
        );
      }
    },
    [onDecrypt]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <LoadingSpinner size="lg" className="mx-auto mb-4" />
          <p className="text-[var(--text-muted)]">Loading your bids...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<PackageIcon />}
        title="Failed to load your bids"
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

  // If user has no bids and no purchased encryptions
  if (bids.length === 0 && purchasedEncryptions.length === 0) {
    return (
      <EmptyState
        icon={<InboxIcon />}
        title="No purchases yet"
        description="Bids you place and encryptions you purchase will appear here"
        action={
          <button
            onClick={() => {
              // Placeholder - navigate to marketplace
              alert(
                'Browse the Marketplace tab to find encryptions to bid on!'
              );
            }}
            className="px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-all duration-150 cursor-pointer"
          >
            Browse Marketplace
          </button>
        }
      />
    );
  }

  const truncateToken = (token: string) => {
    if (!token) return '';
    return `${token.slice(0, 12)}...${token.slice(-8)}`;
  };

  return (
    <div>
      {/* Purchased Encryptions Section */}
      {purchasedEncryptions.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4">
            Purchased Encryptions
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {purchasedEncryptions.map((enc) => (
              <div
                key={enc.tokenName}
                className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-5 hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)] transition-all duration-150"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-[var(--success-muted)] text-[var(--success)] rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
                    Purchased
                  </span>
                  <span className="text-xs text-[var(--text-muted)] font-mono">
                    {truncateToken(enc.tokenName)}
                  </span>
                </div>

                {enc.description && (
                  <div
                    className="mb-3 p-3 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] cursor-pointer hover:bg-[var(--bg-elevated)] hover:border-[var(--border-default)]"
                    onClick={() => {
                      setDescModalContent(enc.description || '');
                      setDescModalToken(enc.tokenName);
                      setDescModalOpen(true);
                    }}
                  >
                    <p
                      className="text-sm text-[var(--text-secondary)] line-clamp-1"
                      title={enc.description}
                    >
                      {truncateDescription(enc.description)}
                    </p>
                  </div>
                )}

                <button
                  onClick={() => onDecryptEncryption?.(enc)}
                  className="w-full mt-2 px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent)]/90 transition-all duration-150 cursor-pointer flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
                    />
                  </svg>
                  Decrypt
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bids Section */}
      {bids.length > 0 && purchasedEncryptions.length > 0 && (
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4">
          Active Bids
        </h3>
      )}

      {bids.length === 0 ? null : (<div>
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
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="amount-high">Amount: High to Low</option>
            <option value="amount-low">Amount: Low to High</option>
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
            title="Refresh bids"
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
        {filteredAndSorted.length} {filteredAndSorted.length === 1 ? 'bid' : 'bids'}
        {statusFilter !== 'all' && ` (${statusFilter})`}
      </div>

      {/* Content */}
      {filteredAndSorted.length === 0 ? (
        searchQuery || statusFilter !== 'all' ? (
          <EmptyState
            icon={<SearchIcon />}
            title="No matching bids"
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
            title="No bids found"
            description="Your bids will appear here"
          />
        )
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAndSorted.map((bid) => (
            <MyPurchaseBidCard
              key={bid.tokenName}
              bid={bid}
              encryption={getEncryption(bid.encryptionToken)}
              onCancel={handleCancelBid}
              onDecrypt={handleDecrypt}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAndSorted.map((bid) => (
            <MyPurchaseBidCard
              key={bid.tokenName}
              bid={bid}
              encryption={getEncryption(bid.encryptionToken)}
              onCancel={handleCancelBid}
              onDecrypt={handleDecrypt}
              compact
            />
          ))}
        </div>
      )}
    </div>)}

      <DescriptionModal
        isOpen={descModalOpen}
        onClose={() => setDescModalOpen(false)}
        description={descModalContent}
        tokenName={descModalToken}
      />
    </div>
  );
}
