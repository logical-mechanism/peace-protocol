/**
 * Transaction History Service
 *
 * Persists transaction records in localStorage, keyed by wallet PKH.
 * Tracks pending, confirmed, and failed transactions submitted via the dApp.
 */

export type TransactionType = 'create-listing' | 'remove-listing' | 'place-bid' | 'cancel-bid' | 'accept-bid' | 'cancel-pending';
export type TransactionStatus = 'pending' | 'confirmed' | 'failed';

export interface TransactionRecord {
  txHash: string;
  type: TransactionType;
  tokenName?: string;
  timestamp: number;
  status: TransactionStatus;
  description?: string;
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
  status: TransactionStatus
): void {
  const records = getTransactions(walletPkh);
  const record = records.find(r => r.txHash === txHash);
  if (record) {
    record.status = status;
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
 * Check pending tx hashes against Blockfrost and mark confirmed ones.
 * Used for txs like remove-listing where the UTxO is consumed
 * and won't appear in on-chain UTxO queries.
 */
export async function resolvePendingTxs(walletPkh: string): Promise<TransactionRecord[]> {
  const records = getTransactions(walletPkh);
  const pending = records.filter(r => r.status === 'pending');
  if (pending.length === 0) return records;

  const apiKey = import.meta.env.VITE_BLOCKFROST_PROJECT_ID_PREPROD;
  if (!apiKey) return records;

  let changed = false;
  for (const rec of pending) {
    // Skip stub tx hashes
    if (rec.txHash.startsWith('stub_')) continue;
    try {
      const res = await fetch(
        `https://cardano-preprod.blockfrost.io/api/v0/txs/${rec.txHash}`,
        { headers: { project_id: apiKey } }
      );
      if (res.ok) {
        rec.status = 'confirmed';
        changed = true;
      } else if (res.status === 404) {
        // Tx not found yet — still pending, or failed
        // If it's been more than 5 minutes, mark as failed
        if (Date.now() - rec.timestamp > 5 * 60 * 1000) {
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
  }
}
