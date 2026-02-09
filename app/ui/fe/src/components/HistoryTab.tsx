import { useState, useEffect, useMemo, useCallback } from 'react';
import { encryptionsApi, bidsApi } from '../services/api';
import TransactionLink from './TransactionLink';
import EmptyState, { InboxIcon } from './EmptyState';
import LoadingSpinner from './LoadingSpinner';
import type { TransactionRecord } from '../services/transactionHistory';
import {
  getTypeLabel,
  clearHistory,
  getTransactions,
  reconcileWithOnChain,
  resolvePendingTxs,
} from '../services/transactionHistory';

interface HistoryTabProps {
  userPkh?: string;
  transactions: TransactionRecord[];
  onClearHistory?: () => void;
  onHistoryUpdated?: (records: TransactionRecord[]) => void;
}

export default function HistoryTab({
  userPkh,
  transactions,
  onClearHistory,
  onHistoryUpdated,
}: HistoryTabProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'confirmed' | 'failed'>('all');
  const [allRecords, setAllRecords] = useState<TransactionRecord[]>(transactions);
  const [loading, setLoading] = useState(true);

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

  // Also update if parent passes new transactions (e.g. after recording a new tx)
  useEffect(() => {
    if (userPkh && transactions.length > 0) {
      setAllRecords(getTransactions(userPkh));
    }
  }, [transactions, userPkh]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return allRecords;
    return allRecords.filter(tx => tx.status === statusFilter);
  }, [allRecords, statusFilter]);

  const pendingCount = useMemo(
    () => allRecords.filter(tx => tx.status === 'pending').length,
    [allRecords]
  );

  const handleClear = () => {
    if (!userPkh) return;
    if (!confirm('Clear locally recorded transaction history?')) return;
    clearHistory(userPkh);
    setAllRecords([]);
    onClearHistory?.();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <LoadingSpinner size="lg" className="mx-auto mb-4" />
          <p className="text-[var(--text-muted)]">Loading transaction history...</p>
        </div>
      </div>
    );
  }

  if (allRecords.length === 0) {
    return (
      <EmptyState
        icon={<InboxIcon />}
        title="No transaction history"
        description="Transactions you submit through the dApp will appear here"
      />
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            <option value="all">All ({allRecords.length})</option>
            <option value="pending">Pending ({pendingCount})</option>
            <option value="confirmed">Confirmed ({allRecords.filter(tx => tx.status === 'confirmed').length})</option>
            <option value="failed">Failed ({allRecords.filter(tx => tx.status === 'failed').length})</option>
          </select>
          <button
            onClick={refresh}
            className="px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-all duration-150 cursor-pointer"
            title="Refresh history"
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
        <button
          onClick={handleClear}
          className="px-3 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--error)] hover:border-[var(--error)] transition-all duration-150 cursor-pointer"
        >
          Clear History
        </button>
      </div>

      {/* Transaction list */}
      <div className="space-y-3">
        {filtered.map((tx) => (
          <div
            key={tx.txHash}
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
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  tx.status === 'pending'
                    ? 'bg-[var(--warning)]/20 text-[var(--warning)]'
                    : tx.status === 'confirmed'
                    ? 'bg-[var(--success)]/20 text-[var(--success)]'
                    : 'bg-[var(--error)]/20 text-[var(--error)]'
                }`}>
                  {tx.status}
                </span>
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                <TransactionLink txHash={tx.txHash} className="text-xs" />
              </div>
              {tx.description && (
                <p className="text-xs text-[var(--text-muted)] mt-1 truncate">
                  {tx.description}
                </p>
              )}
            </div>

            {/* Timestamp */}
            <div className="flex-shrink-0 text-xs text-[var(--text-muted)]">
              {formatTimestamp(tx.timestamp)}
            </div>
          </div>
        ))}
      </div>
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
