import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import '../i18n';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import { useNode } from '../contexts/NodeContext';
import { encryptionsApi, bidsApi, chainApi } from '../services/api';
import type { EncryptionDisplay, BidDisplay } from '../services/api';
import { optimisticStore } from '../services/optimisticStore';
import SalesListingCard from './SalesListingCard';
import BidsModal from './BidsModal';
import { SkeletonCard, SkeletonGrid } from './SkeletonCard';
import EmptyState, { PackageIcon } from './EmptyState';
import { NoSalesIllustration, NoResultsIllustration } from './EmptyStateIllustrations';
import { listCachedImages, deleteCachedImage, type ImageCacheStatus } from '../services/imageCache';
import { getNsfwEnabled } from '../services/nsfwStorage';
import { getOnboardingState } from '../services/onboardingStorage';
import RefreshIndicator from './RefreshIndicator';
import AcceptBidQueuePanel from './AcceptBidQueuePanel';
import type { MySalesFilters, MySalesAction, CardSize, ColumnCount } from '../hooks/useTabFilterState';
import { getGridClasses } from '../hooks/useTabFilterState';
import LayoutPopover from './LayoutPopover';
import { getTransactions, reencryptionHistoryToCSV } from '../services/transactionHistory';
import { exportTextFile } from '../services/fileExport';
import { useDebounce } from '../hooks/useDebounce';
import { formatAda } from '../utils/formatAda';
import Select from './Select';

interface MySalesTabProps {
  userPkh?: string;
  onRemoveListing?: (encryption: EncryptionDisplay) => void;
  onUpdatePrice?: (encryption: EncryptionDisplay) => void;
  onAcceptBid?: (encryption: EncryptionDisplay, bid: BidDisplay) => void;
  onCancelPending?: (encryption: EncryptionDisplay) => void;
  onCompleteSale?: (encryption: EncryptionDisplay) => void;
  onCreateListing?: () => void;
  onBidsViewed?: (encryptionTokenName: string) => void;
  onStartAcceptBidTutorial?: (encryption: EncryptionDisplay) => void;
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
  onStartAcceptBidTutorial,
  onLocalRefresh,
  refreshSignal,
  filters,
  dispatch,
}: MySalesTabProps) {
  const { t } = useTranslation('dashboard');
  const { expressReady } = useNode();
  const [encryptions, setEncryptions] = useState<EncryptionDisplay[]>([]);
  const [bidsMap, setBidsMap] = useState<Map<string, BidDisplay[]>>(new Map());
  const [imageCacheStatus, setImageCacheStatus] = useState<ImageCacheStatus>({ cached: [], banned: [], total_bytes: 0 });
  const [nsfwEnabled] = useState(() => getNsfwEnabled());
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prevDataCount, setPrevDataCount] = useState(0);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  // Destructure filter state from Dashboard-level reducer
  const { viewMode, sortBy, statusFilter, searchQuery, cardSize, columnCount, currentPage } = filters;
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Modal state
  const [selectedListing, setSelectedListing] = useState<EncryptionDisplay | null>(null);
  const [bidsModalOpen, setBidsModalOpen] = useState(false);
  const [acceptBidBannerDismissed, setAcceptBidBannerDismissed] = useState(false);

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
      setError(err instanceof Error ? err.message : t('mySales.failedTitle'));
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [userPkh, t]);

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

  // First active listing with at least one pending bid — used by the
  // accept-bid tutorial banner. Hiding the banner when nothing is bid-worthy
  // prevents a dead-end tooltip (no Accept button to spotlight).
  const firstBidEligibleListing = useMemo(() => {
    return encryptions.find(
      (e) => e.status === 'active' && (bidStats.map.get(e.tokenName) ?? 0) > 0,
    );
  }, [encryptions, bidStats.map]);

  const showAcceptBidBanner = useMemo(() => {
    if (acceptBidBannerDismissed) return false;
    if (!firstBidEligibleListing) return false;
    if (!onStartAcceptBidTutorial) return false;
    const state = getOnboardingState();
    return state.completed && !state.firstBidAcceptedCompleted;
  }, [acceptBidBannerDismissed, firstBidEligibleListing, onStartAcceptBidTutorial]);

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

  const handleExportCsv = async () => {
    if (!userPkh) return;
    try {
      const events = await chainApi.getReencryptionHistory(userPkh);
      const csv = reencryptionHistoryToCSV(events, userPkh);
      const filename = `veiled-tax-records-${new Date().toISOString().slice(0, 10)}.csv`;
      const result = await exportTextFile(csv, filename);
      if (result) {
        setExportMessage(t('history.exportedTo', { path: result }));
        setTimeout(() => setExportMessage(null), 3000);
      }
    } catch (err) {
      console.error('Failed to export CSV:', err);
      setExportMessage(t('history.exportFailed'));
      setTimeout(() => setExportMessage(null), 3000);
    }
  };

  const screenReaderMessage = loading
    ? t('mySales.loading')
    : error
    ? t('mySales.loadError')
    : t('mySales.loadedCount', { count: encryptions.length });

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
          title={t('mySales.failedTitle')}
          description={error}
          action={
            <button
              onClick={() => { fetchData(); onLocalRefresh?.(); }}
              className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
            >
              {t('mySales.tryAgain')}
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
        {userPkh && (
          <div className="flex justify-end mb-4">
            <button
              onClick={handleExportCsv}
              className="px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] btn-base btn-icon"
              title={t('history.exportTitle')}
              aria-label={t('history.exportAria')}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </button>
          </div>
        )}
        {exportMessage && (
          <div className="mb-4 px-3 py-2 text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)]">
            {exportMessage}
          </div>
        )}
        <EmptyState
          illustration={<NoSalesIllustration />}
          title={t('mySales.emptyTitle')}
          description={t('mySales.emptyDesc')}
          action={
            <button
              onClick={onCreateListing}
              className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
            >
              {t('mySales.createListing')}
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
      {userPkh && (
        <div className="flex justify-end mb-4">
          <button
            onClick={handleExportCsv}
            className="px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] btn-base btn-icon"
            title={t('history.exportTitle')}
            aria-label={t('history.exportAria')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </button>
        </div>
      )}
      {exportMessage && (
        <div className="mb-4 px-3 py-2 text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)]">
          {exportMessage}
        </div>
      )}
      {/* Auto-Accept Queue Panel */}
      <AcceptBidQueuePanel />
      {/* First-bid-accepted tutorial banner — only when user actually has a pending bid to accept */}
      {showAcceptBidBanner && firstBidEligibleListing && (
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
            <span className="font-medium">{t('mySales.acceptBidBannerTitle')}</span>{' '}
            <span className="text-[var(--text-secondary)]">{t('mySales.acceptBidBannerDesc')}</span>
          </div>
          <button
            onClick={() => {
              setAcceptBidBannerDismissed(true);
              setSelectedListing(firstBidEligibleListing);
              setBidsModalOpen(true);
              onBidsViewed?.(firstBidEligibleListing.tokenName);
              onStartAcceptBidTutorial?.(firstBidEligibleListing);
            }}
            className="ml-auto px-3 py-1 text-xs font-medium rounded-[var(--radius-sm)] cursor-pointer"
            style={{
              background: 'var(--accent)',
              color: 'var(--bg-primary)',
            }}
          >
            {t('mySales.acceptBidBannerStart')}
          </button>
          <button
            onClick={() => setAcceptBidBannerDismissed(true)}
            className="p-1 rounded-[var(--radius-sm)] cursor-pointer"
            style={{ color: 'var(--accent)' }}
            aria-label={t('mySales.acceptBidBannerDismiss')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      {/* Earnings Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4">
          <p className="text-xs text-[var(--text-muted)] mb-1">{t('mySales.summaryActive')}</p>
          <p className="text-xl font-semibold text-[var(--text-primary)]">
            {salesStats.activeCount}
          </p>
          {salesStats.listedValue > 0 && (
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {t('mySales.summaryListed', { amount: formatAda(salesStats.listedValue) })}
            </p>
          )}
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4">
          <p className="text-xs text-[var(--text-muted)] mb-1">{t('mySales.summaryPendingBids')}</p>
          <p className="text-xl font-semibold text-[var(--accent)]">
            {salesStats.totalBidCount}
          </p>
          {salesStats.totalBidValue > 0 && (
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {t('mySales.summaryBidsTotal', { amount: (salesStats.totalBidValue / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }) })}
            </p>
          )}
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4">
          <p className="text-xs text-[var(--text-muted)] mb-1">{t('mySales.summaryPendingSales')}</p>
          <p className="text-xl font-semibold text-[var(--warning)]">
            {salesStats.pendingCount}
          </p>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4">
          <p className="text-xs text-[var(--text-muted)] mb-1">{t('mySales.summaryCompletedSales')}</p>
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
            placeholder={t('mySales.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => dispatch({ type: 'SET_SEARCH', payload: e.target.value })}
            aria-label={t('mySales.searchAria')}
            className="w-full pl-10 pr-4 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:shadow-[var(--shadow-glow)] transition-all duration-[var(--transition-fast)]"
          />
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          {/* Status Filter */}
          <div className="w-40">
            <Select
              value={statusFilter}
              options={[
                { value: 'all', label: t('filters.allStatus') },
                { value: 'active', label: t('filters.statusActive') },
                { value: 'pending', label: t('filters.statusPending') },
                { value: 'completed', label: t('filters.statusCompleted') },
              ]}
              onChange={(v) => dispatch({ type: 'SET_STATUS', payload: v as MySalesFilters['statusFilter'] })}
              ariaLabel={t('filters.filterByStatus')}
            />
          </div>

          {/* Sort */}
          <div className="w-52">
            <Select
              value={sortBy}
              options={[
                { value: 'newest', label: t('filters.sortNewest') },
                { value: 'oldest', label: t('filters.sortOldest') },
                { value: 'price-high', label: t('filters.sortPriceHigh') },
                { value: 'price-low', label: t('filters.sortPriceLow') },
                { value: 'most-bids', label: t('filters.sortMostBids') },
              ]}
              onChange={(v) => dispatch({ type: 'SET_SORT', payload: v as MySalesFilters['sortBy'] })}
              ariaLabel={t('mySales.sortListingsAria')}
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
            title={t('mySales.refreshTitle')}
            aria-label={t('mySales.refreshAria')}
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
          ? t('mySales.showingOf', { shown: paginatedResults.length, count: filteredAndSorted.length })
          : t('mySales.totalCount', { count: filteredAndSorted.length })}
        {statusFilter !== 'all' && ` ${t('mySales.statusSuffix', { status: statusFilter })}`}
      </div>

      {/* Content */}
      {filteredAndSorted.length === 0 ? (
        searchQuery || statusFilter !== 'all' ? (
          <EmptyState
            illustration={<NoResultsIllustration />}
            title={t('mySales.noMatchingTitle')}
            description={t('mySales.noMatchingDesc')}
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
            illustration={<NoSalesIllustration />}
            title={t('mySales.noListingsTitle')}
            description={t('mySales.noListingsDesc')}
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
            {t('mySales.showingOf', { shown: paginatedResults.length, count: filteredAndSorted.length })}
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
