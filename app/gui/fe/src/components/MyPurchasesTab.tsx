import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { bidsApi, encryptionsApi } from '../services/api';
import type { BidDisplay, EncryptionDisplay } from '../services/api';
import { getBidSecretsForEncryption } from '../services/bidSecretStorage';
import { listLibraryItems } from '../services/libraryService';
import { truncateHex } from '../utils/truncate';
import MyPurchaseBidCard from './MyPurchaseBidCard';
import DescriptionModal from './DescriptionModal';
import { truncateDescription } from './descriptionUtils';
import { SkeletonGrid } from './SkeletonCard';
import EmptyState, { PackageIcon } from './EmptyState';
import { NoPurchasesIllustration, NoResultsIllustration } from './EmptyStateIllustrations';
import type { MyPurchasesFilters, MyPurchasesAction } from '../hooks/useTabFilterState';
import type { PurchaseStage } from './BidTimeline';
import { useDebounce } from '../hooks/useDebounce';

interface MyPurchasesTabProps {
  userPkh?: string;
  onCancelBid?: (bid: BidDisplay) => void;
  onDecrypt?: (bid: BidDisplay) => void;
  onDecryptEncryption?: (encryption: EncryptionDisplay) => void;
  onSwitchTab?: (tab: 'marketplace' | 'my-sales' | 'my-purchases' | 'history' | 'library') => void;
  onLocalRefresh?: () => void;
  refreshSignal?: number;
  filters: MyPurchasesFilters;
  dispatch: React.Dispatch<MyPurchasesAction>;
  failedDecryptTokens?: Set<string>;
}

function MyPurchasesTab({
  userPkh,
  onCancelBid,
  onDecrypt,
  onDecryptEncryption,
  onSwitchTab,
  onLocalRefresh,
  refreshSignal,
  filters,
  dispatch,
  failedDecryptTokens,
}: MyPurchasesTabProps) {
  const [bids, setBids] = useState<BidDisplay[]>([]);
  const [encryptionsMap, setEncryptionsMap] = useState<Map<string, EncryptionDisplay>>(new Map());
  const [purchasedEncryptions, setPurchasedEncryptions] = useState<EncryptionDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prevDataCount, setPrevDataCount] = useState(0);
  const [completedTokens, setCompletedTokens] = useState<Set<string>>(new Set());
  const [secretsLoadErrors, setSecretsLoadErrors] = useState<Set<string>>(new Set());
  const [descModalOpen, setDescModalOpen] = useState(false);
  const [descModalContent, setDescModalContent] = useState('');
  const [descModalToken, setDescModalToken] = useState<string | undefined>();

  // Destructure filter state from Dashboard-level reducer
  const { viewMode, sortBy, statusFilter, searchQuery } = filters;
  const debouncedSearch = useDebounce(searchQuery, 300);

  const hasDataRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (!hasDataRef.current) setLoading(true);
    setError(null);
    try {
      // Fetch all bids and filter by bidder PKH from datum
      const allBids = await bidsApi.getAll();
      const userBids = userPkh
        ? allBids.filter((b) => b.bidderPkh === userPkh)
        : [];
      setBids(userBids);
      setPrevDataCount(userBids.length);
      hasDataRef.current = true;

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
        const failedTokens = new Set<string>();
        for (const enc of userOwnedEncryptions) {
          try {
            const secrets = await getBidSecretsForEncryption(enc.tokenName);
            if (secrets.length > 0) {
              purchased.push(enc);
            }
          } catch (err) {
            console.warn(`Failed to load bid secrets for ${enc.tokenName}:`, err);
            failedTokens.add(enc.tokenName);
            purchased.push(enc);
          }
        }
        setPurchasedEncryptions(purchased);
        setSecretsLoadErrors(failedTokens);
      } else {
        setPurchasedEncryptions([]);
      }

      // Fetch library items to determine completed purchases
      try {
        const libraryItems = await listLibraryItems();
        setCompletedTokens(new Set(libraryItems.map((item) => item.tokenName)));
      } catch {
        // Library lookup failure is non-critical
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch your bids');
    } finally {
      setLoading(false);
    }
  }, [userPkh]);

  // Fetch on mount and re-fetch when refreshSignal changes (background refresh after first load)
  useEffect(() => {
    fetchData();
  }, [refreshSignal, fetchData]);

  // Get encryption for a bid
  const getEncryption = useCallback(
    (encryptionToken: string): EncryptionDisplay | undefined => {
      return encryptionsMap.get(encryptionToken);
    },
    [encryptionsMap]
  );

  // Derive purchase stage from on-chain status + local state
  const getPurchaseStage = useCallback(
    (bid: BidDisplay): PurchaseStage => {
      if (completedTokens.has(bid.encryptionToken)) return 'complete';
      if (failedDecryptTokens?.has(bid.encryptionToken)) return 'failed';
      if (bid.status === 'accepted') return 'accepted';
      return 'placed';
    },
    [completedTokens, failedDecryptTokens]
  );

  // Count bids per filter status (for chip badges)
  const statusCounts = useMemo(() => {
    const counts = { all: bids.length, pending: 0, accepted: 0, complete: 0 };
    for (const bid of bids) {
      if (completedTokens.has(bid.encryptionToken)) {
        counts.complete++;
      } else if (bid.status === 'accepted') {
        counts.accepted++;
      } else if (bid.status === 'pending') {
        counts.pending++;
      }
    }
    return counts;
  }, [bids, completedTokens]);

  // Filter and sort bids
  const filteredAndSorted = useMemo(() => {
    let result = [...bids];

    // Filter by status (using derived purchase stage for 'complete' and 'accepted')
    if (statusFilter === 'complete') {
      result = result.filter((b) => completedTokens.has(b.encryptionToken));
    } else if (statusFilter === 'accepted') {
      result = result.filter(
        (b) => b.status === 'accepted' && !completedTokens.has(b.encryptionToken)
      );
    } else if (statusFilter !== 'all') {
      result = result.filter((b) => b.status === statusFilter);
    }

    // Search filter (by token name, encryption token, or encryption description)
    if (debouncedSearch.trim()) {
      const query = debouncedSearch.toLowerCase();
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
  }, [bids, statusFilter, debouncedSearch, sortBy, encryptionsMap, completedTokens]);

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

  const screenReaderMessage = loading
    ? 'Loading your purchases…'
    : error
    ? 'Error loading your purchases'
    : `${bids.length} ${bids.length === 1 ? 'bid' : 'bids'} loaded`;

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
          title="Failed to load your bids"
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

  // If user has no bids and no purchased encryptions
  if (bids.length === 0 && purchasedEncryptions.length === 0) {
    return (
      <>
        <div className="sr-only" aria-live="polite" role="status">{screenReaderMessage}</div>
        <EmptyState
          illustration={<NoPurchasesIllustration />}
          title="No purchases yet"
          description="Bids you place and encryptions you purchase will appear here"
          action={
            <button
              onClick={() => onSwitchTab?.('marketplace')}
              className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
            >
              Browse Marketplace
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
      {/* Purchased Encryptions Section */}
      {purchasedEncryptions.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4">
            Purchased Encryptions
          </h3>
          {secretsLoadErrors.size > 0 && (
            <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-[var(--warning-muted)] border border-[var(--warning)]/30 rounded-[var(--radius-md)] text-sm text-[var(--warning)]">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              Some bid data could not be loaded. Decryption may not be available for affected items.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {purchasedEncryptions.map((enc) => {
              const hasSecretError = secretsLoadErrors.has(enc.tokenName);
              return (
              <div
                key={enc.tokenName}
                className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-5 hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)] hover:translate-y-[-1px] hover:shadow-[var(--shadow-md)] transition-all duration-[var(--transition-fast)]"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-[var(--success-muted)] text-[var(--success)] rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
                      Purchased
                    </span>
                    {hasSecretError && (
                      <span title="Bid secrets could not be loaded. Decryption may not be available.">
                        <svg className="w-4 h-4 text-[var(--warning)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-[var(--text-muted)] font-mono">
                    {truncateHex(enc.tokenName, 12, 8)}
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
                  className="w-full mt-2 px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] flex items-center justify-center gap-2 btn-base btn-primary"
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
              );
            })}
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
            onChange={(e) => dispatch({ type: 'SET_SEARCH', payload: e.target.value })}
            className="w-full pl-10 pr-4 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:shadow-[var(--shadow-glow)] transition-all duration-[var(--transition-fast)]"
          />
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          {/* Status Filter Chips */}
          <div className="flex gap-1.5 items-center">
            {(['all', 'pending', 'accepted', 'complete'] as const).map((status) => {
              const isActive = statusFilter === status;
              const label = status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1);
              const count = statusCounts[status];
              return (
                <button
                  key={status}
                  onClick={() => dispatch({ type: 'SET_STATUS', payload: status })}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-[var(--transition-fast)] cursor-pointer ${
                    isActive
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-subtle)] hover:bg-[var(--bg-card)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  {label}{count > 0 && ` (${count})`}
                </button>
              );
            })}
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => dispatch({ type: 'SET_SORT', payload: e.target.value as MyPurchasesFilters['sortBy'] })}
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
              onClick={() => dispatch({ type: 'SET_VIEW', payload: 'grid' })}
              className={`px-3 py-2 transition-all duration-[var(--transition-fast)] cursor-pointer ${
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
              onClick={() => dispatch({ type: 'SET_VIEW', payload: 'list' })}
              className={`px-3 py-2 transition-all duration-[var(--transition-fast)] cursor-pointer ${
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
            onClick={() => { fetchData(); onLocalRefresh?.(); }}
            className="px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] btn-base btn-icon"
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
      <div role="status" className="mb-4 text-sm text-[var(--text-muted)]">
        {filteredAndSorted.length} {filteredAndSorted.length === 1 ? 'bid' : 'bids'}
        {statusFilter !== 'all' && ` (${statusFilter})`}
      </div>

      {/* Content */}
      {filteredAndSorted.length === 0 ? (
        searchQuery || statusFilter !== 'all' ? (
          <EmptyState
            illustration={<NoResultsIllustration />}
            title="No matching bids"
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
            illustration={<NoPurchasesIllustration />}
            title="No bids found"
            description="Your bids will appear here"
          />
        )
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredAndSorted.map((bid, index) => (
            <div key={bid.tokenName} className="card-stagger" style={{ animationDelay: `${Math.min(index, 9) * 50}ms` }}>
              <MyPurchaseBidCard
                bid={bid}
                encryption={getEncryption(bid.encryptionToken)}
                onCancel={handleCancelBid}
                onDecrypt={handleDecrypt}
                purchaseStage={getPurchaseStage(bid)}
                decryptFailed={failedDecryptTokens?.has(bid.encryptionToken)}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAndSorted.map((bid, index) => (
            <div key={bid.tokenName} className="card-stagger" style={{ animationDelay: `${Math.min(index, 9) * 50}ms` }}>
              <MyPurchaseBidCard
                bid={bid}
                encryption={getEncryption(bid.encryptionToken)}
                onCancel={handleCancelBid}
                onDecrypt={handleDecrypt}
                purchaseStage={getPurchaseStage(bid)}
                decryptFailed={failedDecryptTokens?.has(bid.encryptionToken)}
                compact
              />
            </div>
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
    </>
  );
}

export default memo(MyPurchasesTab);
