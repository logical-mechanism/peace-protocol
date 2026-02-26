/**
 * Transaction History Service
 *
 * Persists transaction records in localStorage, keyed by wallet PKH.
 * Tracks pending, confirmed, and failed transactions submitted via the dApp.
 */

export type TransactionType = 'create-listing' | 'remove-listing' | 'place-bid' | 'cancel-bid' | 'accept-bid' | 'cancel-pending' | 'complete-sale';
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

const STORAGE_KEY_PREFIX = 'peace_tx_history_';

function getStorageKey(walletPkh: string): string {
  return STORAGE_KEY_PREFIX + walletPkh;
}

/**
 * Get all transaction records for a wallet.
 */
export function getTransactions(walletPkh: string): TransactionRecord[] {
  try {
    const raw = localStorage.getItem(getStorageKey(walletPkh));
    if (!raw) return [];
    return JSON.parse(raw) as TransactionRecord[];
  } catch {
    return [];
  }
}

/**
 * Add a transaction record for a wallet.
 */
export function addTransaction(walletPkh: string, record: TransactionRecord): void {
  const records = getTransactions(walletPkh);
  records.unshift(record); // newest first
  // Keep at most 50 records
  if (records.length > 50) records.length = 50;
  localStorage.setItem(getStorageKey(walletPkh), JSON.stringify(records));
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
    record.status = status;
    if (extra?.confirmedAtBlock !== undefined) {
      record.confirmedAtBlock = extra.confirmedAtBlock;
    }
    localStorage.setItem(getStorageKey(walletPkh), JSON.stringify(records));
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
  localStorage.removeItem(getStorageKey(walletPkh));
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
    localStorage.setItem(getStorageKey(walletPkh), JSON.stringify(filtered));
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
    localStorage.setItem(getStorageKey(walletPkh), JSON.stringify(filtered));
  }
  return removed;
}

/**
 * Reconcile local history with on-chain records and persist changes.
 *
 * - On-chain records not in local storage are added (so they persist after UTxO removal)
 * - Local pending records matched by txHash to on-chain are promoted to confirmed
 * - Returns the updated list
 */
export function reconcileWithOnChain(
  walletPkh: string,
  onChainRecords: TransactionRecord[]
): TransactionRecord[] {
  const records = getTransactions(walletPkh);
  const existingHashes = new Set(records.map(r => r.txHash));
  let changed = false;

  // Promote pending -> confirmed if found on-chain
  for (const rec of records) {
    if (rec.status === 'pending') {
      const onChain = onChainRecords.find(o => o.txHash === rec.txHash);
      if (onChain) {
        rec.status = 'confirmed';
        changed = true;
      }
    }
  }

  // Add on-chain records not yet in local storage
  for (const onChain of onChainRecords) {
    if (!existingHashes.has(onChain.txHash)) {
      records.push(onChain);
      changed = true;
    }
  }

  if (changed) {
    // Sort newest first and persist
    records.sort((a, b) => b.timestamp - a.timestamp);
    if (records.length > 100) records.length = 100;
    localStorage.setItem(getStorageKey(walletPkh), JSON.stringify(records));
  }

  return records;
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
      // Check if Kupo has indexed any output from this transaction
      const res = await fetch(
        `http://127.0.0.1:1442/matches/*@${rec.txHash}`
      );
      if (res.ok) {
        const matches = await res.json();
        if (Array.isArray(matches) && matches.length > 0) {
          rec.status = 'confirmed';
          changed = true;
        } else if (Date.now() - rec.timestamp > 5 * 60 * 1000) {
          // No matches after 5 minutes — likely failed
          rec.status = 'failed';
          changed = true;
        }
      }
    } catch {
      // Network error, skip
    }
  }

  if (changed) {
    localStorage.setItem(getStorageKey(walletPkh), JSON.stringify(records));
  }

  return records;
}

/**
 * Human-readable label for a transaction type.
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
