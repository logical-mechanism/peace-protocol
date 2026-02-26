import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { encryptionsApi, bidsApi, chainApi } from '../services/api';
import TransactionLink from './TransactionLink';
import EmptyState from './EmptyState';
import { HistoryEmptyIllustration, NoResultsIllustration } from './EmptyStateIllustrations';
import LoadingSpinner from './LoadingSpinner';
import { SkeletonHistoryList } from './SkeletonCard';
import type { TransactionRecord, TransactionType } from '../services/transactionHistory';
import {
  getTypeLabel,
  clearHistory,
  getTransactions,
  reconcileWithOnChain,
  resolvePendingTxs,
  updateTransactionStatus,
  toCSV,
} from '../services/transactionHistory';
import { exportTextFile } from '../services/fileExport';
import type { HistoryFilters, HistoryAction } from '../hooks/useTabFilterState';

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
  historySignal,
  filters,
  dispatch,
}: HistoryTabProps) {
  // Destructure filter state from Dashboard-level reducer
  const { statusFilter, typeFilter, dateRange, searchQuery } = filters;
  const [allRecords, setAllRecords] = useState<TransactionRecord[]>(transactions);
  const [loading, setLoading] = useState(true);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [confirmations, setConfirmations] = useState<Map<string, number>>(new Map());
  const confirmationsRef = useRef<Map<string, number>>(new Map());

  // Reconcile local history with on-chain data and check pending txs
  const refresh = useCallback(async () => {
    if (!userPkh) {
      setAllRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
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
            description: e.description || `Listing ${e.tokenName.slice(0, 12)}...`,
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
            description: `Bid ${(b.amount / 1_000_000).toLocaleString()} ADA`,
          });
        }
      }

      // 2. Reconcile: persist on-chain records + promote matching pending -> confirmed
      reconcileWithOnChain(userPkh, onChainRecords);

      // 3. Check remaining pending txs against Blockfrost (for remove-listing etc.)
      const resolved = await resolvePendingTxs(userPkh);
      setAllRecords(resolved);
      onHistoryUpdated?.(resolved);
    } catch (err) {
      console.error('Failed to refresh history:', err);
      // Fall back to localStorage
      const fallback = getTransactions(userPkh);
      setAllRecords(fallback);
      onHistoryUpdated?.(fallback);
    } finally {
      setLoading(false);
    }
  }, [userPkh, onHistoryUpdated]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-fetch when Dashboard signals a history refresh
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    refresh();
  }, [historySignal]); // eslint-disable-line react-hooks/exhaustive-deps

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
          const { confirmations: count, blockHeight } = await chainApi.getConfirmations(tx.txHash);
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
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(tx =>
        tx.txHash.toLowerCase().includes(query) ||
        (tx.description && tx.description.toLowerCase().includes(query)) ||
        (tx.tokenName && tx.tokenName.toLowerCase().includes(query))
      );
    }

    return result;
  }, [allRecords, statusFilter, typeFilter, dateRange, searchQuery]);

  const pendingCount = useMemo(
    () => allRecords.filter(tx => tx.status === 'pending').length,
    [allRecords]
  );

  const handleClear = () => {
    if (!userPkh) return;
    if (!confirm('Clear locally recorded transaction history?')) return;
    clearHistory(userPkh);
    setAllRecords([]);
    confirmationsRef.current = new Map();
    setConfirmations(new Map());
    onClearHistory?.();
  };

  const handleExportCsv = async () => {
    if (filtered.length === 0) return;
    try {
      const csv = toCSV(filtered);
      const filename = `veiled-tx-history-${new Date().toISOString().slice(0, 10)}.csv`;
      const result = await exportTextFile(csv, filename);
      if (result) {
        setExportMessage(`Exported to ${result}`);
        setTimeout(() => setExportMessage(null), 3000);
      }
    } catch (err) {
      console.error('Failed to export CSV:', err);
      setExportMessage('Export failed');
      setTimeout(() => setExportMessage(null), 3000);
    }
  };

  if (loading) {
    return <SkeletonHistoryList />;
  }

  if (allRecords.length === 0) {
    return (
      <EmptyState
        illustration={<HistoryEmptyIllustration />}
        title="No transaction history"
        description="Transactions you submit through the dApp will appear here"
      />
    );
  }

  return (
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
            placeholder="Search by tx hash, description, or token..."
            value={searchQuery}
            onChange={(e) => dispatch({ type: 'SET_SEARCH', payload: e.target.value })}
            aria-label="Search transaction history"
            className="w-full pl-10 pr-4 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:shadow-[var(--shadow-glow)] transition-all duration-150"
          />
        </div>

        {/* Filters row */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => dispatch({ type: 'SET_STATUS', payload: e.target.value as HistoryFilters['statusFilter'] })}
            aria-label="Filter by status"
            className="px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            <option value="all">All Status ({allRecords.length})</option>
            <option value="pending">Pending ({pendingCount})</option>
            <option value="confirmed">Confirmed ({allRecords.filter(tx => tx.status === 'confirmed').length})</option>
            <option value="failed">Failed ({allRecords.filter(tx => tx.status === 'failed').length})</option>
          </select>

          {/* Type filter */}
          <select
            value={typeFilter}
            onChange={(e) => dispatch({ type: 'SET_TYPE', payload: e.target.value as HistoryFilters['typeFilter'] })}
            aria-label="Filter by type"
            className="px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            <option value="all">All Types</option>
            {ALL_TX_TYPES.map(t => (
              <option key={t} value={t}>{getTypeLabel(t)}</option>
            ))}
          </select>

          {/* Date range filter */}
          <select
            value={dateRange}
            onChange={(e) => dispatch({ type: 'SET_DATE_RANGE', payload: e.target.value as HistoryFilters['dateRange'] })}
            aria-label="Filter by date range"
            className="px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            <option value="all">All Time</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>

          <div className="flex-1" />

          {/* Action buttons */}
          <button
            onClick={refresh}
            className="px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] btn-base btn-icon"
            title="Refresh history"
            aria-label="Refresh history"
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
            title="Export as CSV"
            aria-label="Export as CSV"
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
            className="px-3 py-2 text-sm rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--error)] hover:border-[var(--error)] btn-base btn-tertiary"
          >
            Clear History
          </button>
        </div>
      </div>

      {/* Export feedback */}
      {exportMessage && (
        <div className="mb-4 px-3 py-2 text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)]">
          {exportMessage}
        </div>
      )}

      {/* Transaction list or filtered empty state */}
      {filtered.length === 0 ? (
        <EmptyState
          illustration={<NoResultsIllustration />}
          title="No matching transactions"
          description="Try adjusting your filters or search query"
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((tx, index) => {
            const query = searchQuery.trim().toLowerCase();
            const hashMatchesSearch = query !== '' && tx.txHash.toLowerCase().includes(query);
            return (
            <div key={tx.txHash} className="card-stagger" style={{ animationDelay: `${Math.min(index, 9) * 50}ms` }}>
            <div
              className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-4 flex items-center gap-4"
            >
              {/* Status icon */}
              <div className="flex-shrink-0">
                {tx.status === 'pending' ? (
                  <LoadingSpinner size="sm" />
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
                    {getTypeLabel(tx.type)}
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
                      ? `pending (${confirmations.get(tx.txHash)} conf.)`
                      : tx.status}
                  </span>
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  <TransactionLink txHash={tx.txHash} truncate={!hashMatchesSearch} className="text-xs" />
                </div>
                {tx.description && (
                  <p className="text-xs text-[var(--text-muted)] mt-1 truncate">
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
                  title="Retry listing without re-uploading the file"
                >
                  Retry
                </button>
              )}

              {/* Timestamp */}
              <div className="flex-shrink-0 text-xs text-[var(--text-muted)]">
                {formatTimestamp(tx.timestamp)}
              </div>
            </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default memo(HistoryTab);
