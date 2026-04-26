/**
 * Transaction History Service
 *
 * Persists transaction records in localStorage, keyed by wallet PKH.
 * Tracks pending, confirmed, and failed transactions submitted via the dApp.
 */

import { invoke } from '@tauri-apps/api/core';
import { getPendingTxPool } from './providers';
import { storageGet, storageSet, storageGetJSON, storageSetJSON, storageRemove } from './storageUtils';
import { playSound } from './notificationSound';
import type { EncryptionDisplay, BidDisplay } from './api';

export type TransactionType = 'create-listing' | 'remove-listing' | 'place-bid' | 'cancel-bid' | 'accept-bid' | 'cancel-pending' | 'complete-sale' | 'create-collateral' | 'optimize-wallet' | 'update-price' | 'update-bid' | 'send' | 'receive';
export type TransactionStatus = 'pending' | 'confirmed' | 'failed';

export interface TransactionRecord {
  txHash: string;
  type: TransactionType;
  tokenName?: string;
  timestamp: number;
  status: TransactionStatus;
  description?: string;
  /** Listing draft ID for file listings — enables retry without re-upload. */
  draftId?: string;
  /** Transaction amount in lovelace. Undefined for types with no meaningful amount. */
  amountLovelace?: number;
  /** Counterparty payment key hash (56 hex chars). */
  counterparty?: string;
  /** Block height at which this transaction was confirmed. */
  confirmedAtBlock?: number;
}

const STORAGE_KEY_PREFIX = 'veiled_tx_history_';
const OLD_STORAGE_KEY_PREFIX = 'peace_tx_history_';

function getStorageKey(walletPkh: string): string {
  return STORAGE_KEY_PREFIX + walletPkh;
}

/** One-time migration from old "peace_" prefix to "veiled_" prefix. */
function migrateKeyPrefix(walletPkh: string): void {
  const oldKey = OLD_STORAGE_KEY_PREFIX + walletPkh;
  const newKey = getStorageKey(walletPkh);
  const old = storageGet(oldKey);
  if (old && !storageGet(newKey)) {
    storageSet(newKey, old);
    storageRemove(oldKey);
  }
}

/**
 * Get all transaction records for a wallet.
 */
export function getTransactions(walletPkh: string): TransactionRecord[] {
  migrateKeyPrefix(walletPkh);
  return storageGetJSON<TransactionRecord[]>(getStorageKey(walletPkh), []);
}

/**
 * Add a transaction record for a wallet.
 */
export function addTransaction(walletPkh: string, record: TransactionRecord): void {
  const records = getTransactions(walletPkh);
  records.unshift(record); // newest first
  // Keep at most 50 records
  if (records.length > 50) records.length = 50;
  storageSetJSON(getStorageKey(walletPkh), records);
}

/**
 * Update the status of a transaction by hash.
 */
export function updateTransactionStatus(
  walletPkh: string,
  txHash: string,
  status: TransactionStatus,
  extra?: { confirmedAtBlock?: number },
): void {
  const records = getTransactions(walletPkh);
  const record = records.find(r => r.txHash === txHash);
  if (record) {
    const wasNotConfirmed = record.status !== 'confirmed';
    record.status = status;
    if (extra?.confirmedAtBlock !== undefined) {
      record.confirmedAtBlock = extra.confirmedAtBlock;
    }
    storageSetJSON(getStorageKey(walletPkh), records);
    if (status === 'confirmed' && wasNotConfirmed) {
      playSound('tx_confirmed');
    }
  }
}

/**
 * Get count of pending transactions for a wallet.
 */
export function getPendingCount(walletPkh: string): number {
  return getTransactions(walletPkh).filter(r => r.status === 'pending').length;
}

/**
 * Clear all transaction history for a wallet.
 */
export function clearHistory(walletPkh: string): void {
  storageRemove(getStorageKey(walletPkh));
}

/**
 * Clear transactions older than a given number of days.
 * Returns the number of records removed.
 */
export function clearOlderThan(walletPkh: string, days: number): number {
  const records = getTransactions(walletPkh);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const filtered = records.filter(r => r.timestamp >= cutoff);
  const removed = records.length - filtered.length;
  if (removed > 0) {
    storageSetJSON(getStorageKey(walletPkh), filtered);
  }
  return removed;
}

/**
 * Clear only failed transactions.
 * Returns the number of records removed.
 */
export function clearFailed(walletPkh: string): number {
  const records = getTransactions(walletPkh);
  const filtered = records.filter(r => r.status !== 'failed');
  const removed = records.length - filtered.length;
  if (removed > 0) {
    storageSetJSON(getStorageKey(walletPkh), filtered);
  }
  return removed;
}

export interface ReconciliationDiscrepancy {
  txHash: string;
  localStatus: TransactionStatus;
  resolvedStatus: TransactionStatus;
}

export interface ReconciliationResult {
  records: TransactionRecord[];
  discrepancies: ReconciliationDiscrepancy[];
}

/**
 * Reconcile local history with on-chain records and persist changes.
 *
 * - Local pending/failed records matched by txHash to on-chain are promoted to confirmed
 * - On-chain records not in local storage are added (so they persist after UTxO removal)
 * - Returns the updated list and any discrepancies found
 */
export function reconcileWithOnChain(
  walletPkh: string,
  onChainRecords: TransactionRecord[]
): ReconciliationResult {
  const records = getTransactions(walletPkh);
  const onChainHashSet = new Set(onChainRecords.map(o => o.txHash));
  let changed = false;
  const discrepancies: ReconciliationDiscrepancy[] = [];

  // Promote pending/failed -> confirmed if found on-chain (on-chain is source of truth)
  for (const rec of records) {
    if ((rec.status === 'pending' || rec.status === 'failed') && onChainHashSet.has(rec.txHash)) {
      discrepancies.push({
        txHash: rec.txHash,
        localStatus: rec.status,
        resolvedStatus: 'confirmed',
      });
      rec.status = 'confirmed';
      changed = true;
      playSound('tx_confirmed');
    }
  }

  // Add or refresh on-chain records.
  // For new hashes: insert. For existing hashes: refresh fields where on-chain
  // has authoritative data the local copy is missing (timestamp, amount,
  // counterparty, block height). Without this, an entry once persisted with
  // null/0 timestamp would never get its real timestamp from a later reconcile,
  // and would stay sorted at the bottom forever.
  const recordsByHash = new Map(records.map(r => [r.txHash, r]));
  for (const onChain of onChainRecords) {
    const existing = recordsByHash.get(onChain.txHash);
    if (!existing) {
      records.push(onChain);
      changed = true;
      continue;
    }
    if (onChain.timestamp && (!existing.timestamp || existing.timestamp <= 0)) {
      existing.timestamp = onChain.timestamp;
      changed = true;
    }
    if (onChain.amountLovelace !== undefined && existing.amountLovelace === undefined) {
      existing.amountLovelace = onChain.amountLovelace;
      changed = true;
    }
    if (onChain.counterparty && !existing.counterparty) {
      existing.counterparty = onChain.counterparty;
      changed = true;
    }
    if (onChain.confirmedAtBlock && !existing.confirmedAtBlock) {
      existing.confirmedAtBlock = onChain.confirmedAtBlock;
      changed = true;
    }
  }

  if (changed) {
    // Sort newest first and persist
    records.sort((a, b) => b.timestamp - a.timestamp);
    if (records.length > 100) records.length = 100;
    storageSetJSON(getStorageKey(walletPkh), records);
  }

  return { records, discrepancies };
}

/**
 * Check pending tx hashes against Kupo and mark confirmed ones.
 * Uses Kupo /matches to check if a transaction's outputs have been indexed.
 * Used for txs like remove-listing where the UTxO is consumed
 * and won't appear in on-chain UTxO queries.
 */
export async function resolvePendingTxs(walletPkh: string): Promise<TransactionRecord[]> {
  const records = getTransactions(walletPkh);
  const pending = records.filter(r => r.status === 'pending');
  if (pending.length === 0) return records;

  let changed = false;
  for (const rec of pending) {
    // Skip stub tx hashes
    if (rec.txHash.startsWith('stub_')) continue;
    try {
      // Check if Kupo has indexed any output from this transaction.
      // Routed through Tauri IPC to bypass WebKitGTK CORS enforcement.
      const body = await invoke<string>('kupo_fetch', {
        url: `http://127.0.0.1:44203/matches/*@${rec.txHash}`,
      });
      const matches = JSON.parse(body);
      if (Array.isArray(matches) && matches.length > 0) {
        rec.status = 'confirmed';
        changed = true;
        playSound('tx_confirmed');
        // Remove from pending tx pool — Kupo now has the real UTxO state
        getPendingTxPool().confirmTx(rec.txHash);
      } else if (Date.now() - rec.timestamp > 5 * 60 * 1000) {
        // No matches after 5 minutes — likely failed
        rec.status = 'failed';
        changed = true;
        playSound('tx_failed');
        // Invalidate this tx and any chained dependents in the pool
        getPendingTxPool().invalidateChain(rec.txHash);
      }
    } catch {
      // Network error or Kupo not ready, skip
    }
  }

  if (changed) {
    storageSetJSON(getStorageKey(walletPkh), records);
  }

  return records;
}

/** i18n key for a transaction type — resolve via t(`history.txType.${type}`) in dashboard namespace. */
export function getTypeLabelKey(type: TransactionType): string {
  return `history.txType.${type}`;
}

/**
 * Human-readable label for a transaction type (English fallback for non-component contexts like CSV export).
 */
export function getTypeLabel(type: TransactionType): string {
  switch (type) {
    case 'create-listing': return 'Create Listing';
    case 'remove-listing': return 'Remove Listing';
    case 'place-bid': return 'Place Bid';
    case 'cancel-bid': return 'Cancel Bid';
    case 'accept-bid': return 'Accept Bid';
    case 'cancel-pending': return 'Cancel Pending';
    case 'complete-sale': return 'Complete Sale';
    case 'create-collateral': return 'Set Collateral';
    case 'optimize-wallet': return 'Optimize Wallet';
    case 'update-price': return 'Update Price';
    case 'update-bid': return 'Update Bid';
    case 'send': return 'Sent ADA';
    case 'receive': return 'Received ADA';
  }
}

/**
 * Escape a value for CSV: wrap in double quotes if it contains commas,
 * double quotes, or newlines. Internal double quotes are doubled.
 */
function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Convert transaction records to CSV string.
 * Columns: Date, Type, Status, Tx Hash, Token Name, Description
 */
export function toCSV(records: TransactionRecord[]): string {
  const header = 'Date,Type,Status,Tx Hash,Token Name,Description,Amount (ADA),Confirmation Block,Counterparty';
  const rows = records.map(r => {
    const date = new Date(r.timestamp).toISOString();
    const type = getTypeLabel(r.type);
    const status = r.status;
    const hash = r.txHash;
    const token = r.tokenName ?? '';
    const desc = csvEscape(r.description ?? '');
    const amount = r.amountLovelace !== undefined
      ? (r.amountLovelace / 1_000_000).toFixed(6)
      : '';
    const block = r.confirmedAtBlock !== undefined ? String(r.confirmedAtBlock) : '';
    const counterparty = r.counterparty ?? '';
    return `${date},${type},${status},${hash},${token},${desc},${amount},${block},${counterparty}`;
  });
  return [header, ...rows].join('\n');
}

function lovelaceToAda(lovelace: number | undefined | null): string {
  if (lovelace === undefined || lovelace === null) return '';
  return (lovelace / 1_000_000).toFixed(6);
}

/**
 * Convert seller's listings to CSV for tax reporting.
 * Columns: Date, Token Name, Status, Description, Listed Price (ADA),
 * Highest Bid (ADA), Sale Amount (ADA), Buyer PKH, Tx Hash
 *
 * Status maps EncryptionDisplay.status: active→Open, pending→Pending, completed→Sold.
 * Highest Bid is the max amount across pending bids in `bidsMap`.
 * Sale Amount + Buyer PKH come from the accepted bid (when one exists).
 */
export function salesToCSV(
  encryptions: EncryptionDisplay[],
  bidsMap: Map<string, BidDisplay[]>,
): string {
  const header =
    'Date,Token Name,Status,Description,Listed Price (ADA),Highest Bid (ADA),Sale Amount (ADA),Buyer PKH,Tx Hash';
  const rows = encryptions.map((e) => {
    const date = new Date(e.createdAt).toISOString();
    const tokenName = e.tokenName;
    const statusLabel =
      e.status === 'active' ? 'Open'
      : e.status === 'pending' ? 'Pending'
      : 'Sold';
    const desc = csvEscape(e.description ?? '');
    const listed = lovelaceToAda(e.suggestedPrice ?? e.datum?.new_price);
    const bids = bidsMap.get(e.tokenName) ?? [];
    const pendingAmounts = bids.filter((b) => b.status === 'pending').map((b) => b.amount);
    const highestBid = pendingAmounts.length > 0 ? lovelaceToAda(Math.max(...pendingAmounts)) : '';
    const acceptedBid = bids.find((b) => b.status === 'accepted');
    const saleAmount = acceptedBid ? lovelaceToAda(acceptedBid.amount) : '';
    const buyerPkh = acceptedBid?.bidderPkh ?? '';
    const txHash = e.utxo.txHash;
    return `${date},${tokenName},${statusLabel},${desc},${listed},${highestBid},${saleAmount},${buyerPkh},${txHash}`;
  });
  return [header, ...rows].join('\n');
}

/**
 * Convert buyer's bids to CSV for tax reporting.
 * Columns: Date, Token Name, Status, Bid Amount (ADA), Future Price (ADA),
 * Seller PKH, Encryption Token, Tx Hash
 *
 * Status: pending→Active (or Locked while lockedUntil>now), accepted→Won,
 * cancelled→Cancelled, rejected→Rejected.
 */
export function purchasesToCSV(
  bids: BidDisplay[],
  encryptionsMap: Map<string, EncryptionDisplay>,
): string {
  const header =
    'Date,Token Name,Status,Bid Amount (ADA),Future Price (ADA),Seller PKH,Encryption Token,Tx Hash';
  const now = Date.now();
  const rows = bids.map((b) => {
    const date = new Date(b.createdAt).toISOString();
    let statusLabel: string;
    if (b.status === 'pending') {
      statusLabel = b.lockedUntil > now ? 'Locked' : 'Active';
    } else if (b.status === 'accepted') {
      statusLabel = 'Won';
    } else if (b.status === 'cancelled') {
      statusLabel = 'Cancelled';
    } else {
      statusLabel = 'Rejected';
    }
    const bidAmount = lovelaceToAda(b.amount);
    const futurePrice = b.futurePrice !== undefined ? lovelaceToAda(b.futurePrice) : '';
    const enc = encryptionsMap.get(b.encryptionToken);
    const sellerPkh = enc?.sellerPkh ?? '';
    return `${date},${b.tokenName},${statusLabel},${bidAmount},${futurePrice},${sellerPkh},${b.encryptionToken},${b.utxo.txHash}`;
  });
  return [header, ...rows].join('\n');
}
