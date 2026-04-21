import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import '../i18n';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import { useNode } from '../contexts/NodeContext';
import Select from './Select';
import { bidsApi, encryptionsApi } from '../services/api';
import { optimisticStore } from '../services/optimisticStore';
import type { BidDisplay, EncryptionDisplay } from '../services/api';
import { getBidSecretsForEncryption, listBidSecretTokens } from '../services/bidSecretStorage';
import { listLibraryItems } from '../services/libraryService';
import { truncateHex } from '../utils/truncate';
import MyPurchaseBidCard from './MyPurchaseBidCard';
import DescriptionModal from './DescriptionModal';
import { truncateDescription } from './descriptionUtils';
import { SkeletonCard, SkeletonGrid } from './SkeletonCard';
import EmptyState, { PackageIcon } from './EmptyState';
import { NoPurchasesIllustration, NoResultsIllustration } from './EmptyStateIllustrations';
import type { MyPurchasesFilters, MyPurchasesAction, CardSize, ColumnCount } from '../hooks/useTabFilterState';
import LayoutPopover from './LayoutPopover';
import { getGridClasses } from '../hooks/useTabFilterState';
import type { PurchaseStage } from './BidTimeline';
import { useDebounce } from '../hooks/useDebounce';
import { getOnboardingState } from '../services/onboardingStorage';

export interface DecryptTutorialTarget {
  bid?: BidDisplay;
  encryption: EncryptionDisplay;
  ownerPkh?: string;
}

interface MyPurchasesTabProps {
  userPkh?: string;
  onCancelBid?: (bid: BidDisplay) => void;
  onUpdateBid?: (bid: BidDisplay) => void;
  onDecrypt?: (bid: BidDisplay) => void;
  onDecryptEncryption?: (encryption: EncryptionDisplay, ownerPkh?: string) => void;
  onSwitchTab?: (tab: 'marketplace' | 'my-sales' | 'my-purchases' | 'history' | 'library') => void;
  onLocalRefresh?: () => void;
  onStartDecryptTutorial?: (target: DecryptTutorialTarget) => void;
  /** When true, auto-invoke onStartDecryptTutorial as soon as data loads and a
   * target exists. Used by Settings "Replay" to re-trigger the flow without the
   * user having to find the banner. Parent should flip this back to false after
   * the start fires to avoid re-triggering on refresh. */
  autoStartDecryptTutorial?: boolean;
  onAutoStartConsumed?: () => void;
  refreshSignal?: number;
  filters: MyPurchasesFilters;
  dispatch: React.Dispatch<MyPurchasesAction>;
  failedDecryptTokens?: Set<string>;
}

function MyPurchasesTab({
  userPkh,
  onCancelBid,
  onUpdateBid,
  onDecrypt,
  onDecryptEncryption,
  onSwitchTab,
  onLocalRefresh,
  onStartDecryptTutorial,
  autoStartDecryptTutorial,
  onAutoStartConsumed,
  refreshSignal,
  filters,
  dispatch,
  failedDecryptTokens,
}: MyPurchasesTabProps) {
  const { t } = useTranslation('dashboard');
  const { expressReady } = useNode();
  const [bids, setBids] = useState<BidDisplay[]>([]);
  const [encryptionsMap, setEncryptionsMap] = useState<Map<string, EncryptionDisplay>>(new Map());
  const [purchasedEncryptions, setPurchasedEncryptions] = useState<(EncryptionDisplay & { resold?: boolean })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prevDataCount, setPrevDataCount] = useState(0);
  const [completedTokens, setCompletedTokens] = useState<Map<string, string>>(new Map());
  const [secretsLoadErrors, setSecretsLoadErrors] = useState<Set<string>>(new Set());
  const [descModalOpen, setDescModalOpen] = useState(false);
  const [descModalContent, setDescModalContent] = useState('');
  const [descModalToken, setDescModalToken] = useState<string | undefined>();
  const [decryptBannerDismissed, setDecryptBannerDismissed] = useState(false);

  // Destructure filter state from Dashboard-level reducer
  const { viewMode, sortBy, statusFilter, searchQuery, cardSize, columnCount, currentPage } = filters;
  const debouncedSearch = useDebounce(searchQuery, 300);

  const hasDataRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (!hasDataRef.current) setLoading(true);
    setError(null);
    try {
      // Fetch all bids and filter by bidder PKH from datum
      const allBids = optimisticStore.mergeBids(await bidsApi.getAll());
      const userBids = userPkh
        ? allBids.filter((b) => b.bidderPkh === userPkh)
        : [];
      setBids(userBids);
      setPrevDataCount(userBids.length);
      hasDataRef.current = true;

      // Fetch all encryptions (needed for both bids and purchased encryptions)
      const allEncryptions = optimisticStore.mergeEncryptions(await encryptionsApi.getAll());

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

      // Find purchased encryptions: discover via bid secrets (works even after re-sale)
      if (userPkh) {
        let secretTokens: string[] = [];
        try {
          secretTokens = await listBidSecretTokens();
        } catch (err) {
          console.warn('Failed to list bid secret tokens:', err);
        }

        const purchased: (EncryptionDisplay & { resold?: boolean })[] = [];
        const failedTokens = new Set<string>();
        for (const token of secretTokens) {
          const enc = allEncryptions.find((e) => e.tokenName === token);
          if (!enc) continue; // token no longer on-chain
          const isCurrentOwner = enc.sellerPkh === userPkh;
          // If we still own it but full_level is null, purchase isn't complete yet
          if (isCurrentOwner && enc.datum.full_level === null) continue;
          try {
            const secrets = await getBidSecretsForEncryption(enc.tokenName);
            if (secrets.length > 0) {
              purchased.push({ ...enc, resold: !isCurrentOwner });
            }
          } catch (err) {
            console.warn(`Failed to load bid secrets for ${enc.tokenName}:`, err);
            failedTokens.add(enc.tokenName);
            purchased.push({ ...enc, resold: !isCurrentOwner });
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
        setCompletedTokens(new Map(libraryItems.map((item) => [item.tokenName, item.decryptedAt])));
      } catch {
        // Library lookup failure is non-critical
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('myPurchases.failedTitle'));
    } finally {
      setLoading(false);
    }
  }, [userPkh, t]);

  // Fetch on mount and re-fetch when refreshSignal changes (waits for Express backend)
  useEffect(() => {
    if (!expressReady) return;
    fetchData();
  }, [refreshSignal, fetchData, expressReady]);

  // Get encryption for a bid
  const getEncryption = useCallback(
    (encryptionToken: string): EncryptionDisplay | undefined => {
      return encryptionsMap.get(encryptionToken);
    },
    [encryptionsMap]
  );

  // Check if a bid's encryption was decrypted AFTER the bid was placed.
  // Prevents re-purchases from showing "complete" due to a prior library entry.
  const isCompletedAfterBid = useCallback(
    (bid: BidDisplay): boolean => {
      const decryptedAt = completedTokens.get(bid.encryptionToken);
      if (!decryptedAt) return false;
      return new Date(decryptedAt) > new Date(bid.createdAt);
    },
    [completedTokens]
  );

  // Derive purchase stage from on-chain status + local state
  const getPurchaseStage = useCallback(
    (bid: BidDisplay): PurchaseStage => {
      if (isCompletedAfterBid(bid)) return 'complete';
      if (failedDecryptTokens?.has(bid.encryptionToken)) return 'failed';
      if (bid.status === 'accepted') return 'accepted';
      return 'placed';
    },
    [isCompletedAfterBid, failedDecryptTokens]
  );

  // Count bids per filter status (for chip badges)
  const statusCounts = useMemo(() => {
    const counts = { all: bids.length, pending: 0, accepted: 0, complete: 0 };
    for (const bid of bids) {
      if (isCompletedAfterBid(bid)) {
        counts.complete++;
      } else if (bid.status === 'accepted') {
        counts.accepted++;
      } else if (bid.status === 'pending') {
        counts.pending++;
      }
    }
    return counts;
  }, [bids, isCompletedAfterBid]);

  // Tutorial target. Prefer an accepted-but-not-yet-decrypted bid (the happy
  // path: spotlight → Decrypt → SNARK → Library). Fall back to the first
  // already-purchased encryption so users who already decrypted everything
  // can still replay the tour — re-decrypting an owned encryption exercises
  // the same DecryptModal path.
  const decryptTutorialTarget = useMemo<DecryptTutorialTarget | null>(() => {
    const readyBid = bids
      .filter((b) => b.status === 'accepted' && !isCompletedAfterBid(b))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
    if (readyBid) {
      const enc = encryptionsMap.get(readyBid.encryptionToken);
      if (enc) return { bid: readyBid, encryption: enc };
    }
    const ownedEnc = purchasedEncryptions[0];
    if (ownedEnc) {
      return { encryption: ownedEnc, ownerPkh: ownedEnc.resold ? userPkh : undefined };
    }
    return null;
  }, [bids, purchasedEncryptions, encryptionsMap, isCompletedAfterBid, userPkh]);

  // Show banner when onboarding is complete, first-decrypt tutorial hasn't
  // run, and the buyer has at least one decryptable target (accepted bid or
  // already-purchased encryption).
  const showDecryptBanner = useMemo(() => {
    if (decryptBannerDismissed) return false;
    if (!decryptTutorialTarget) return false;
    const state = getOnboardingState();
    return state.completed && !state.firstDecryptCompleted;
  }, [decryptBannerDismissed, decryptTutorialTarget]);

  // Auto-start when parent requests (Settings "Replay"). Only fires once per
  // mount of a requested start so it doesn't re-trigger on every re-render.
  const autoStartFiredRef = useRef(false);
  useEffect(() => {
    if (!autoStartDecryptTutorial) {
      autoStartFiredRef.current = false;
      return;
    }
    if (autoStartFiredRef.current) return;
    if (!decryptTutorialTarget || !onStartDecryptTutorial) return;
    autoStartFiredRef.current = true;
    onStartDecryptTutorial(decryptTutorialTarget);
    onAutoStartConsumed?.();
  }, [autoStartDecryptTutorial, decryptTutorialTarget, onStartDecryptTutorial, onAutoStartConsumed]);

  // Filter and sort bids
  const filteredAndSorted = useMemo(() => {
    let result = [...bids];

    // Filter by status (using derived purchase stage for 'complete' and 'accepted')
    if (statusFilter === 'complete') {
      result = result.filter((b) => isCompletedAfterBid(b));
    } else if (statusFilter === 'accepted') {
      result = result.filter(
        (b) => b.status === 'accepted' && !isCompletedAfterBid(b)
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
  }, [bids, statusFilter, debouncedSearch, sortBy, encryptionsMap, isCompletedAfterBid]);

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
  const handleCancelBid = useCallback(
    (bid: BidDisplay) => {
      if (onCancelBid) {
        onCancelBid(bid);
      } else {
        console.warn('onCancelBid callback not provided');
      }
    },
    [onCancelBid]
  );

  const handleDecrypt = useCallback(
    (bid: BidDisplay) => {
      if (onDecrypt) {
        onDecrypt(bid);
      } else {
        console.warn('onDecrypt callback not provided');
      }
    },
    [onDecrypt]
  );

  const screenReaderMessage = loading
    ? t('myPurchases.loading')
    : error
    ? t('myPurchases.loadError')
    : t('myPurchases.loadedCount', { count: bids.length });

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
          title={t('myPurchases.failedTitle')}
          description={error}
          action={
            <button
              onClick={() => { fetchData(); onLocalRefresh?.(); }}
              className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
            >
              {t('myPurchases.tryAgain')}
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
          title={t('myPurchases.emptyTitle')}
          description={t('myPurchases.emptyDesc')}
          action={
            <button
              onClick={() => onSwitchTab?.('marketplace')}
              className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
            >
              {t('myPurchases.browseMarketplace')}
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
      {showDecryptBanner && decryptTutorialTarget && (
        <div
          className="mb-4 flex items-center gap-3 px-4 py-3 text-sm rounded-[var(--radius-md)]"
          style={{
            background: 'var(--accent-muted)',
            border: '1px solid var(--accent)',
            color: 'var(--accent)',
          }}
          role="status"
        >
          <svg
            className="w-5 h-5 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div className="flex-1">
            <span className="font-medium">{t('myPurchases.decryptBannerTitle')}</span>{' '}
            <span className="text-[var(--text-secondary)]">{t('myPurchases.decryptBannerDesc')}</span>
          </div>
          {onStartDecryptTutorial && (
            <button
              onClick={() => {
                setDecryptBannerDismissed(true);
                onStartDecryptTutorial(decryptTutorialTarget);
              }}
              className="ml-auto px-3 py-1 text-xs font-medium rounded-[var(--radius-sm)] cursor-pointer"
              style={{
                background: 'var(--accent)',
                color: 'var(--bg-primary)',
              }}
            >
              {t('myPurchases.decryptBannerStart')}
            </button>
          )}
          <button
            onClick={() => setDecryptBannerDismissed(true)}
            className="p-1 rounded-[var(--radius-sm)] cursor-pointer"
            style={{ color: 'var(--accent)' }}
            aria-label={t('myPurchases.decryptBannerDismiss')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      {/* Purchased Encryptions Section */}
      {purchasedEncryptions.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4">
            {t('myPurchases.purchasedHeading')}
          </h3>
          {secretsLoadErrors.size > 0 && (
            <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-[var(--warning-muted)] border border-[var(--warning)]/30 rounded-[var(--radius-md)] text-sm text-[var(--warning)]">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              {t('myPurchases.secretsLoadError')}
            </div>
          )}
          <div className={getGridClasses(columnCount)}>
            {purchasedEncryptions.map((enc) => {
              const hasSecretError = secretsLoadErrors.has(enc.tokenName);
              return (
              <div
                key={enc.tokenName}
                className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-5 hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)] hover:translate-y-[-1px] hover:shadow-[var(--shadow-md)] transition-all duration-[var(--transition-fast)]"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-[var(--success-muted)] text-[var(--success)] rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
                    {t('myPurchases.purchasedBadge')}
                  </span>
                  <div className="flex items-center gap-2">
                    {hasSecretError && (
                      <span title={t('myPurchases.secretsErrorTooltip')}>
                        <svg className="w-4 h-4 text-[var(--warning)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                      </span>
                    )}
                    {enc.resold && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-[var(--warning-muted)] text-[var(--warning)] rounded-full">
                        {t('myPurchases.resoldBadge')}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-[var(--text-muted)] font-mono mb-3">
                  {truncateHex(enc.tokenName, 12, 8)}
                </p>

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
                  onClick={() => onDecryptEncryption?.(enc, enc.resold ? userPkh : undefined)}
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
                  {t('myPurchases.decrypt')}
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
          {t('myPurchases.activeBidsHeading')}
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
            placeholder={t('myPurchases.searchPlaceholder')}
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
              const labelMap: Record<typeof status, string> = {
                all: t('myPurchases.statusAll'),
                pending: t('myPurchases.statusPending'),
                accepted: t('myPurchases.statusAccepted'),
                complete: t('myPurchases.statusComplete'),
              };
              const label = labelMap[status];
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
                  {count > 0 ? t('myPurchases.statusChipWithCount', { label, count }) : label}
                </button>
              );
            })}
          </div>

          {/* Sort */}
          <div className="w-52">
            <Select
              value={sortBy}
              options={[
                { value: 'newest', label: t('filters.sortNewest') },
                { value: 'oldest', label: t('filters.sortOldest') },
                { value: 'amount-high', label: t('filters.sortAmountHigh') },
                { value: 'amount-low', label: t('filters.sortAmountLow') },
              ]}
              onChange={(v) => dispatch({ type: 'SET_SORT', payload: v as MyPurchasesFilters['sortBy'] })}
              ariaLabel={t('myPurchases.sortAria')}
            />
          </div>

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
            onClick={() => { fetchData(); onLocalRefresh?.(); }}
            className="px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] btn-base btn-icon"
            title={t('myPurchases.refreshTitle')}
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
        {hasMore
          ? t('myPurchases.showingOf', { shown: paginatedResults.length, count: filteredAndSorted.length })
          : t('myPurchases.totalCount', { count: filteredAndSorted.length })}
        {statusFilter !== 'all' && ` ${t('myPurchases.statusSuffix', { status: statusFilter })}`}
      </div>

      {/* Content */}
      {filteredAndSorted.length === 0 ? (
        searchQuery || statusFilter !== 'all' ? (
          <EmptyState
            illustration={<NoResultsIllustration />}
            title={t('myPurchases.noMatchingTitle')}
            description={t('myPurchases.noMatchingDesc')}
            action={
              <button
                onClick={() => {
                  dispatch({ type: 'SET_SEARCH', payload: '' });
                  dispatch({ type: 'SET_STATUS', payload: 'all' });
                }}
                className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
              >
                {t('filters.clearFilters')}
              </button>
            }
          />
        ) : (
          <EmptyState
            illustration={<NoPurchasesIllustration />}
            title={t('myPurchases.noBidsTitle')}
            description={t('myPurchases.noBidsDesc')}
          />
        )
      ) : viewMode === 'grid' ? (
        <div className={getGridClasses(columnCount)}>
          {paginatedResults.map((bid, index) => (
            <div key={bid.tokenName} className="card-stagger" style={{ animationDelay: `${Math.min(index, 9) * 50}ms` }}>
              <MyPurchaseBidCard
                bid={bid}
                encryption={getEncryption(bid.encryptionToken)}
                onCancel={handleCancelBid}
                onUpdateBid={onUpdateBid}
                onDecrypt={handleDecrypt}
                purchaseStage={getPurchaseStage(bid)}
                decryptFailed={failedDecryptTokens?.has(bid.encryptionToken)}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedResults.map((bid, index) => (
            <div key={bid.tokenName} className="card-stagger" style={{ animationDelay: `${Math.min(index, 9) * 50}ms` }}>
              <MyPurchaseBidCard
                bid={bid}
                encryption={getEncryption(bid.encryptionToken)}
                onCancel={handleCancelBid}
                onUpdateBid={onUpdateBid}
                onDecrypt={handleDecrypt}
                purchaseStage={getPurchaseStage(bid)}
                decryptFailed={failedDecryptTokens?.has(bid.encryptionToken)}
                compact
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
            {t('myPurchases.showingOf', { shown: paginatedResults.length, count: filteredAndSorted.length })}
          </p>
          <button
            onClick={() => dispatch({ type: 'SET_PAGE', payload: currentPage + 1 })}
            className="px-6 py-2.5 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-tertiary"
          >
            {t('filters.loadMore')}
          </button>
          <div ref={sentinelRef} className="h-1" />
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
