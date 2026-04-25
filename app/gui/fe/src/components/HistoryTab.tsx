import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import '../i18n';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useNode } from '../contexts/NodeContext';
import Select from './Select';
import { encryptionsApi, bidsApi, chainApi } from '../services/api';
import TransactionLink from './TransactionLink';
import EmptyState from './EmptyState';
import { HistoryEmptyIllustration, NoResultsIllustration } from './EmptyStateIllustrations';
import LoadingSpinner, { DelayedSpinner } from './LoadingSpinner';
import { SkeletonHistoryList } from './SkeletonCard';
import ConfirmModal from './ConfirmModal';
import InfoTooltip from './InfoTooltip';
import type { TransactionRecord, TransactionType } from '../services/transactionHistory';
import {
  getTypeLabelKey,
  clearHistory,
  getTransactions,
  reconcileWithOnChain,
  resolvePendingTxs,
  updateTransactionStatus,
  toCSV,
} from '../services/transactionHistory';
import { exportTextFile } from '../services/fileExport';
import type { HistoryFilters, HistoryAction } from '../hooks/useTabFilterState';
import { useDebounce } from '../hooks/useDebounce';

const ALL_TX_TYPES: TransactionType[] = [
  'create-listing', 'remove-listing', 'place-bid', 'cancel-bid',
  'accept-bid', 'cancel-pending', 'complete-sale',
];

type DateRange = 'all' | '24h' | '7d' | '30d';

const DATE_RANGE_CUTOFFS: Record<Exclude<DateRange, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

interface HistoryTabProps {
  userPkh?: string;
  transactions: TransactionRecord[];
  onClearHistory?: () => void;
  onHistoryUpdated?: (records: TransactionRecord[]) => void;
  onRetryListing?: (draftId: string) => void;
  onLocalRefresh?: () => void;
  historySignal?: number;
  filters: HistoryFilters;
  dispatch: React.Dispatch<HistoryAction>;
}

function HistoryTab({
  userPkh,
  transactions,
  onClearHistory,
  onHistoryUpdated,
  onRetryListing,
  onLocalRefresh,
  historySignal,
  filters,
  dispatch,
}: HistoryTabProps) {
  const { t } = useTranslation('dashboard');
  const { expressReady, tipHeight } = useNode();
  // Destructure filter state from Dashboard-level reducer
  const { statusFilter, typeFilter, dateRange, searchQuery } = filters;
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [allRecords, setAllRecords] = useState<TransactionRecord[]>(transactions);
  const [loading, setLoading] = useState(true);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [confirmations, setConfirmations] = useState<Map<string, number>>(new Map());
  const confirmationsRef = useRef<Map<string, number>>(new Map());
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const hasRecoveredRef = useRef(false);

  const hasDataRef = useRef(false);

  // Recover historical transactions from Koios (on-demand or auto-triggered)
  const recoverHistory = useCallback(async () => {
    if (!userPkh || recovering) return;
    setRecovering(true);
    try {
      const recovered = await chainApi.getHistory(userPkh);
      if (recovered.length > 0) {
        const asRecords: TransactionRecord[] = recovered.map(r => ({
          txHash: r.txHash,
          type: (r.type as TransactionRecord['type']) || 'create-listing',
          tokenName: r.tokenName,
          timestamp: r.timestamp,
          status: 'confirmed' as const,
          description: r.description,
          amountLovelace: r.amountLovelace,
          counterparty: r.counterparty,
          confirmedAtBlock: r.confirmedAtBlock,
        }));
        const { records } = reconcileWithOnChain(userPkh, asRecords);
        setAllRecords(records);
        onHistoryUpdated?.(records);
      }
      hasRecoveredRef.current = true;
    } catch (err) {
      console.error('Failed to recover history:', err);
    } finally {
      setRecovering(false);
    }
  }, [userPkh, recovering, onHistoryUpdated]);

  // Reconcile local history with on-chain data and check pending txs
  const refresh = useCallback(async () => {
    if (!userPkh) {
      setAllRecords([]);
      setLoading(false);
      return;
    }
    if (!hasDataRef.current) setLoading(true);
    try {
      // 1. Fetch on-chain data (current UTxOs owned by user)
      const [encryptions, bids] = await Promise.all([
        encryptionsApi.getAll(),
        bidsApi.getAll(),
      ]);

      const onChainRecords: TransactionRecord[] = [];
      for (const e of encryptions) {
        if (e.sellerPkh === userPkh) {
          onChainRecords.push({
            txHash: e.utxo.txHash,
            type: 'create-listing',
            tokenName: e.tokenName,
            timestamp: new Date(e.createdAt).getTime(),
            status: 'confirmed',
            description: e.description || t('history.listingDescription', { tokenName: e.tokenName }),
          });
        }
      }
      for (const b of bids) {
        if (b.bidderPkh === userPkh) {
          onChainRecords.push({
            txHash: b.utxo.txHash,
            type: 'place-bid',
            tokenName: b.tokenName,
            timestamp: new Date(b.createdAt).getTime(),
            status: 'confirmed',
            description: t('history.bidDescription', { amount: (b.amount / 1_000_000).toLocaleString() }),
          });
        }
      }

      // 2. Reconcile: persist on-chain records + promote matching pending/failed -> confirmed
      const { discrepancies } = reconcileWithOnChain(userPkh, onChainRecords);
      for (const d of discrepancies) {
        if (d.localStatus === 'failed') {
          console.warn(
            `Tx ${d.txHash.slice(0, 16)}... status mismatch: local=${d.localStatus} vs chain=${d.resolvedStatus}`
          );
        }
      }

      // 3. Check remaining pending txs against Kupo (for remove-listing etc.)
      const resolved = await resolvePendingTxs(userPkh);
      setIsStale(false);
      setAllRecords(resolved);
      hasDataRef.current = true;
      onHistoryUpdated?.(resolved);
    } catch (err) {
      console.error('Failed to refresh history:', err);
      // Fall back to localStorage
      setIsStale(true);
      const fallback = getTransactions(userPkh);
      setAllRecords(fallback);
      hasDataRef.current = true;
      onHistoryUpdated?.(fallback);
    } finally {
      setLoading(false);
    }
  }, [userPkh, onHistoryUpdated, t]);

  // Fetch on mount and re-fetch when historySignal changes (waits for Express backend)
  useEffect(() => {
    if (!expressReady) return;
    refresh();
  }, [historySignal, refresh, expressReady]);

  // Auto-trigger Koios recovery when history looks sparse (< 5 records)
  useEffect(() => {
    if (!expressReady || !userPkh || hasRecoveredRef.current || recovering) return;
    const localRecords = getTransactions(userPkh);
    if (localRecords.length < 5) {
      recoverHistory();
    }
  }, [expressReady, userPkh, recovering, recoverHistory]);

  // Also update if parent passes new transactions (e.g. after recording a new tx)
  useEffect(() => {
    if (userPkh && transactions.length > 0) {
      setAllRecords(getTransactions(userPkh));
    }
  }, [transactions, userPkh]);

  // Poll confirmation counts for pending transactions
  useEffect(() => {
    const pendingTxs = allRecords.filter(
      tx => tx.status === 'pending' && !tx.txHash.startsWith('stub_')
    );
    if (pendingTxs.length === 0 || !userPkh) return;

    let cancelled = false;

    const fetchConfirmationCounts = async () => {
      const updated = new Map(confirmationsRef.current);
      let statusChanged = false;

      for (const tx of pendingTxs) {
        if (cancelled) break;
        try {
          const { confirmations: count, blockHeight } = await chainApi.getConfirmations(tx.txHash, tipHeight ?? undefined);
          updated.set(tx.txHash, count);

          if (count >= 15) {
            updateTransactionStatus(userPkh, tx.txHash, 'confirmed', {
              confirmedAtBlock: blockHeight,
            });
            statusChanged = true;
          }
        } catch {
          // Skip on error, will retry next poll
        }
      }

      if (!cancelled) {
        confirmationsRef.current = updated;
        setConfirmations(new Map(updated));

        if (statusChanged) {
          const refreshed = getTransactions(userPkh);
          setAllRecords(refreshed);
          onHistoryUpdated?.(refreshed);
        }
      }
    };

    fetchConfirmationCounts();
    const interval = setInterval(fetchConfirmationCounts, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRecords, userPkh]);

  const filtered = useMemo(() => {
    let result = allRecords;

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter(tx => tx.status === statusFilter);
    }

    // Type filter
    if (typeFilter !== 'all') {
      result = result.filter(tx => tx.type === typeFilter);
    }

    // Date range filter
    if (dateRange !== 'all') {
      const cutoff = Date.now() - DATE_RANGE_CUTOFFS[dateRange];
      result = result.filter(tx => tx.timestamp >= cutoff);
    }

    // Search filter (tx hash, description, token name — case-insensitive partial match)
    if (debouncedSearch.trim()) {
      const query = debouncedSearch.toLowerCase();
      result = result.filter(tx =>
        tx.txHash.toLowerCase().includes(query) ||
        (tx.description && tx.description.toLowerCase().includes(query)) ||
        (tx.tokenName && tx.tokenName.toLowerCase().includes(query))
      );
    }

    return result;
  }, [allRecords, statusFilter, typeFilter, dateRange, debouncedSearch]);

  const pendingCount = useMemo(
    () => allRecords.filter(tx => tx.status === 'pending').length,
    [allRecords]
  );

  const handleClear = () => {
    if (!userPkh) return;
    setShowClearConfirm(true);
  };

  const handleClearConfirm = () => {
    if (!userPkh) return;
    clearHistory(userPkh);
    setAllRecords([]);
    confirmationsRef.current = new Map();
    setConfirmations(new Map());
    onClearHistory?.();
    setShowClearConfirm(false);
  };

  const handleExportCsv = async () => {
    if (filtered.length === 0) return;
    try {
      const csv = toCSV(filtered);
      const filename = `veiled-tx-history-${new Date().toISOString().slice(0, 10)}.csv`;
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
      <span>{t('history.staleBannerMessage')}</span>
      <button
        onClick={() => { refresh(); onLocalRefresh?.(); }}
        className="ml-auto px-3 py-1 text-xs font-medium rounded-[var(--radius-sm)] cursor-pointer"
        style={{
          background: 'var(--warning)',
          color: 'var(--bg-primary)',
        }}
        aria-label={t('history.staleRetryAria')}
      >
        {t('history.staleRetry')}
      </button>
      <button
        onClick={() => setIsStale(false)}
        className="p-1 rounded-[var(--radius-sm)] cursor-pointer"
        style={{ color: 'var(--warning)' }}
        aria-label={t('history.staleDismissAria')}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  ) : null;

  const screenReaderMessage = loading
    ? t('history.loading')
    : t('history.loadedCount', { count: allRecords.length });

  if (loading) {
    return (
      <>
        <div className="sr-only" aria-live="polite" role="status">{screenReaderMessage}</div>
        <SkeletonHistoryList />
      </>
    );
  }

  if (allRecords.length === 0) {
    return (
      <>
        <div className="sr-only" aria-live="polite" role="status">{screenReaderMessage}</div>
        {staleBanner}
        <EmptyState
          illustration={<HistoryEmptyIllustration />}
          title={t('history.emptyTitle')}
          description={t('history.emptyDesc')}
        />
      </>
    );
  }

  return (
    <>
    <div className="sr-only" aria-live="polite" role="status">{screenReaderMessage}</div>
    <div>
      {/* Toolbar */}
      <div className="flex flex-col gap-4 mb-6">
        {/* Search */}
        <div className="relative">
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
            placeholder={t('history.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => dispatch({ type: 'SET_SEARCH', payload: e.target.value })}
            aria-label={t('history.searchAria')}
            className="w-full pl-10 pr-4 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:shadow-[var(--shadow-glow)] transition-all duration-[var(--transition-fast)]"
          />
        </div>

        {/* Filters row */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Status filter */}
          <div className="w-48">
            <Select
              value={statusFilter}
              options={[
                { value: 'all', label: t('history.allStatusCount', { count: allRecords.length }) },
                { value: 'pending', label: t('history.pendingCount', { count: pendingCount }) },
                { value: 'confirmed', label: t('history.confirmedCount', { count: allRecords.filter(tx => tx.status === 'confirmed').length }) },
                { value: 'failed', label: t('history.failedCount', { count: allRecords.filter(tx => tx.status === 'failed').length }) },
              ]}
              onChange={(v) => dispatch({ type: 'SET_STATUS', payload: v as HistoryFilters['statusFilter'] })}
              ariaLabel={t('filters.filterByStatus')}
            />
          </div>

          {/* Type filter */}
          <div className="w-48">
            <Select
              value={typeFilter}
              options={[
                { value: 'all', label: t('history.allTypes') },
                ...ALL_TX_TYPES.map((txType) => ({ value: txType, label: t(getTypeLabelKey(txType)) })),
              ]}
              onChange={(v) => dispatch({ type: 'SET_TYPE', payload: v as HistoryFilters['typeFilter'] })}
              ariaLabel={t('history.filterByTypeAria')}
            />
          </div>

          {/* Date range filter */}
          <div className="w-44">
            <Select
              value={dateRange}
              options={[
                { value: 'all', label: t('history.dateAllTime') },
                { value: '24h', label: t('history.dateLast24h') },
                { value: '7d', label: t('history.dateLast7d') },
                { value: '30d', label: t('history.dateLast30d') },
              ]}
              onChange={(v) => dispatch({ type: 'SET_DATE_RANGE', payload: v as HistoryFilters['dateRange'] })}
              ariaLabel={t('history.filterByDateAria')}
            />
          </div>

          <div className="flex-1" />

          {/* Action buttons */}
          <button
            onClick={recoverHistory}
            disabled={recovering}
            className="px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] btn-base btn-icon"
            title={t('history.recoverTitle')}
            aria-label={t('history.recoverAria')}
          >
            {recovering ? (
              <LoadingSpinner size="sm" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            )}
          </button>
          <button
            onClick={() => { refresh(); onLocalRefresh?.(); }}
            className="px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] btn-base btn-icon"
            title={t('history.refreshTitle')}
            aria-label={t('history.refreshAria')}
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
          <button
            onClick={handleExportCsv}
            disabled={filtered.length === 0}
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
          <button
            onClick={handleClear}
            aria-label={t('history.clearAria')}
            className="px-3 py-2 text-sm rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--error)] hover:border-[var(--error)] btn-base btn-tertiary"
          >
            {t('history.clearButton')}
          </button>
        </div>
      </div>

      {/* Export feedback */}
      {exportMessage && (
        <div className="mb-4 px-3 py-2 text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)]">
          {exportMessage}
        </div>
      )}

      {/* Stale data warning */}
      {staleBanner}

      {/* Transaction list or filtered empty state */}
      {filtered.length === 0 ? (
        <EmptyState
          illustration={<NoResultsIllustration />}
          title={t('history.noMatchingTitle')}
          description={t('history.noMatchingDesc')}
          action={
            <button
              onClick={() => dispatch({ type: 'CLEAR_FILTERS' })}
              aria-label={t('filters.clearAllFilters')}
              className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
            >
              {t('filters.clearFilters')}
            </button>
          }
        />
      ) : (
        <VirtualizedHistoryList
          items={filtered}
          searchQuery={searchQuery}
          confirmations={confirmations}
          onRetryListing={onRetryListing}
        />
      )}
    </div>
    <ConfirmModal
      isOpen={showClearConfirm}
      onClose={() => setShowClearConfirm(false)}
      onConfirm={handleClearConfirm}
      title={t('history.clearConfirmTitle')}
      message={t('history.clearConfirmMessage')}
      confirmLabel={t('history.clearConfirmButton')}
      confirmVariant="danger"
    />
    </>
  );
}

function VirtualizedHistoryList({
  items,
  searchQuery,
  confirmations,
  onRetryListing,
}: {
  items: TransactionRecord[];
  searchQuery: string;
  confirmations: Map<string, number>;
  onRetryListing?: (draftId: string) => void;
}) {
  const { t } = useTranslation('dashboard');
  const parentRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 92,
    overscan: 5,
  });

  return (
    <div
      ref={parentRef}
      className="overflow-y-auto"
      style={{ maxHeight: 'calc(100vh - 320px)' }}
    >
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const tx = items[virtualItem.index];
          const query = searchQuery.trim().toLowerCase();
          const hashMatchesSearch = query !== '' && tx.txHash.toLowerCase().includes(query);
          return (
            <div
              key={tx.txHash}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
                paddingBottom: '12px',
              }}
            >
              <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-4 flex items-center gap-4 h-[80px]">
                {/* Status icon */}
                <div className="flex-shrink-0">
                  {tx.status === 'pending' ? (
                    <DelayedSpinner size="sm" />
                  ) : tx.status === 'confirmed' ? (
                    <svg className="w-5 h-5 text-[var(--success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-[var(--error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </div>
                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {t(getTypeLabelKey(tx.type))}
                    </span>
                    {tx.amountLovelace !== undefined && (
                      <span className="text-sm text-[var(--text-secondary)] font-mono">
                        {(tx.amountLovelace / 1_000_000).toLocaleString(undefined, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 2,
                        })} ADA
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      tx.status === 'pending'
                        ? 'bg-[var(--warning)]/20 text-[var(--warning)]'
                        : tx.status === 'confirmed'
                        ? 'bg-[var(--success)]/20 text-[var(--success)]'
                        : 'bg-[var(--error)]/20 text-[var(--error)]'
                    }`}>
                      {tx.status === 'pending' && confirmations.has(tx.txHash)
                        ? t('history.pendingConfirmations', { count: confirmations.get(tx.txHash) ?? 0 })
                        : tx.status === 'pending'
                        ? t('history.statusPending')
                        : tx.status === 'confirmed'
                        ? t('history.statusConfirmed')
                        : t('history.statusFailed')}
                    </span>
                    {tx.status === 'pending' && confirmations.has(tx.txHash) && (
                      <InfoTooltip text={t('history.confirmationsTooltip')} />
                    )}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    <TransactionLink txHash={tx.txHash} truncate={!hashMatchesSearch} className="text-xs" />
                  </div>
                  {tx.description && (
                    <p className="text-xs text-[var(--text-muted)] mt-1 truncate max-w-md" title={tx.description}>
                      {tx.description}
                    </p>
                  )}
                  {tx.status === 'pending' && confirmations.has(tx.txHash) && (
                    <div className="mt-2 h-1 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--warning)] rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, ((confirmations.get(tx.txHash) ?? 0) / 15) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
                {/* Retry button for failed file listings */}
                {tx.status === 'failed' && tx.draftId && onRetryListing && (
                  <button
                    onClick={() => onRetryListing(tx.draftId!)}
                    className="flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] btn-base btn-primary"
                    title={t('history.retryTitle')}
                    aria-label={t('history.retryAria')}
                  >
                    {t('history.retry')}
                  </button>
                )}
                {/* Timestamp */}
                <div className="flex-shrink-0 text-xs text-[var(--text-muted)]">
                  {formatTimestamp(tx.timestamp, t)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatTimestamp(ts: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return t('history.timeJustNow');
  if (diffMin < 60) return t('history.timeMinutesAgo', { count: diffMin });

  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return t('history.timeHoursAgo', { count: diffHrs });

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default memo(HistoryTab);
