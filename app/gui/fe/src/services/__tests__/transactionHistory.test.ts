import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getTransactions,
  addTransaction,
  updateTransactionStatus,
  getPendingCount,
  clearHistory,
  reconcileWithOnChain,
  resolvePendingTxs,
  getTypeLabel,
  type TransactionRecord,
} from '../transactionHistory';

const WALLET = 'abc123pkh';

function makeRecord(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    txHash: 'a'.repeat(64),
    type: 'create-listing',
    timestamp: Date.now(),
    status: 'pending',
    ...overrides,
  };
}

describe('transactionHistory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // --- getTransactions ---

  it('getTransactions returns [] for unknown wallet', () => {
    expect(getTransactions('unknown_wallet')).toEqual([]);
  });

  it('getTransactions returns [] when localStorage has corrupted JSON', () => {
    localStorage.setItem('peace_tx_history_' + WALLET, '{broken');
    expect(getTransactions(WALLET)).toEqual([]);
  });

  // --- addTransaction ---

  it('addTransaction adds record at front', () => {
    const first = makeRecord({ txHash: '1'.repeat(64), timestamp: 1000 });
    const second = makeRecord({ txHash: '2'.repeat(64), timestamp: 2000 });

    addTransaction(WALLET, first);
    addTransaction(WALLET, second);

    const records = getTransactions(WALLET);
    expect(records[0].txHash).toBe('2'.repeat(64));
    expect(records[1].txHash).toBe('1'.repeat(64));
  });

  it('addTransaction caps at 50 records', () => {
    for (let i = 0; i < 55; i++) {
      addTransaction(
        WALLET,
        makeRecord({ txHash: i.toString(16).padStart(64, '0') })
      );
    }
    const records = getTransactions(WALLET);
    expect(records).toHaveLength(50);
  });

  // --- updateTransactionStatus ---

  it('updateTransactionStatus updates matching txHash', () => {
    const hash = 'b'.repeat(64);
    addTransaction(WALLET, makeRecord({ txHash: hash, status: 'pending' }));

    updateTransactionStatus(WALLET, hash, 'confirmed');

    const records = getTransactions(WALLET);
    expect(records[0].status).toBe('confirmed');
  });

  it('updateTransactionStatus does nothing for non-existent hash', () => {
    addTransaction(WALLET, makeRecord({ txHash: 'c'.repeat(64), status: 'pending' }));

    updateTransactionStatus(WALLET, 'd'.repeat(64), 'failed');

    const records = getTransactions(WALLET);
    expect(records[0].status).toBe('pending');
  });

  // --- getPendingCount ---

  it('getPendingCount counts only pending status', () => {
    addTransaction(WALLET, makeRecord({ txHash: '1'.repeat(64), status: 'pending' }));
    addTransaction(WALLET, makeRecord({ txHash: '2'.repeat(64), status: 'confirmed' }));
    addTransaction(WALLET, makeRecord({ txHash: '3'.repeat(64), status: 'pending' }));

    expect(getPendingCount(WALLET)).toBe(2);
  });

  it('getPendingCount returns 0 when no pending', () => {
    addTransaction(WALLET, makeRecord({ txHash: '1'.repeat(64), status: 'confirmed' }));
    addTransaction(WALLET, makeRecord({ txHash: '2'.repeat(64), status: 'failed' }));

    expect(getPendingCount(WALLET)).toBe(0);
  });

  // --- clearHistory ---

  it('clearHistory makes getTransactions return []', () => {
    addTransaction(WALLET, makeRecord());
    clearHistory(WALLET);

    expect(getTransactions(WALLET)).toEqual([]);
  });

  // --- reconcileWithOnChain ---

  it('reconcileWithOnChain promotes pending to confirmed when on-chain match found', () => {
    const hash = 'e'.repeat(64);
    addTransaction(WALLET, makeRecord({ txHash: hash, status: 'pending' }));

    const onChain = [makeRecord({ txHash: hash, status: 'confirmed' })];
    const result = reconcileWithOnChain(WALLET, onChain);

    expect(result.find(r => r.txHash === hash)?.status).toBe('confirmed');
  });

  it('reconcileWithOnChain adds on-chain records not in local', () => {
    const localHash = 'f'.repeat(64);
    const onChainHash = '0'.repeat(64);
    addTransaction(WALLET, makeRecord({ txHash: localHash }));

    const onChain = [makeRecord({ txHash: onChainHash, status: 'confirmed' })];
    const result = reconcileWithOnChain(WALLET, onChain);

    expect(result.some(r => r.txHash === onChainHash)).toBe(true);
    expect(result.some(r => r.txHash === localHash)).toBe(true);
  });

  it('reconcileWithOnChain sorts newest first', () => {
    addTransaction(WALLET, makeRecord({ txHash: '1'.repeat(64), timestamp: 1000 }));

    const onChain = [
      makeRecord({ txHash: '2'.repeat(64), timestamp: 3000, status: 'confirmed' }),
      makeRecord({ txHash: '3'.repeat(64), timestamp: 2000, status: 'confirmed' }),
    ];
    const result = reconcileWithOnChain(WALLET, onChain);

    expect(result[0].timestamp).toBeGreaterThanOrEqual(result[1].timestamp);
    if (result.length > 2) {
      expect(result[1].timestamp).toBeGreaterThanOrEqual(result[2].timestamp);
    }
  });

  it('reconcileWithOnChain caps at 100', () => {
    // Pre-fill 60 local records
    for (let i = 0; i < 50; i++) {
      addTransaction(WALLET, makeRecord({ txHash: i.toString(16).padStart(64, '0') }));
    }

    // Add 60 new on-chain records
    const onChain: TransactionRecord[] = [];
    for (let i = 50; i < 110; i++) {
      onChain.push(makeRecord({ txHash: i.toString(16).padStart(64, '0'), status: 'confirmed' }));
    }

    const result = reconcileWithOnChain(WALLET, onChain);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('reconcileWithOnChain does not write to localStorage when nothing changed', () => {
    const hash = 'a'.repeat(64);
    addTransaction(WALLET, makeRecord({ txHash: hash, status: 'confirmed' }));

    const spy = vi.spyOn(Storage.prototype, 'setItem');

    // Pass empty on-chain array — nothing to promote, nothing to add
    reconcileWithOnChain(WALLET, []);

    // The only setItem calls should be from addTransaction above, not from reconcile
    const reconcileCalls = spy.mock.calls.filter(
      (call) => call[0] === 'peace_tx_history_' + WALLET
    );
    // addTransaction called setItem once; reconcile should NOT have called it again
    expect(reconcileCalls).toHaveLength(0);

    spy.mockRestore();
  });

  // --- resolvePendingTxs ---

  it('resolvePendingTxs confirms tx when Kupo returns matches', async () => {
    const hash = 'b'.repeat(64);
    addTransaction(WALLET, makeRecord({ txHash: hash, status: 'pending' }));

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ some: 'match' }]), { status: 200 })
    );

    const result = await resolvePendingTxs(WALLET);
    expect(result.find(r => r.txHash === hash)?.status).toBe('confirmed');

    fetchSpy.mockRestore();
  });

  it('resolvePendingTxs marks as failed after 5 min with no matches', async () => {
    const hash = 'c'.repeat(64);
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
    addTransaction(WALLET, makeRecord({ txHash: hash, status: 'pending', timestamp: sixMinutesAgo }));

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 })
    );

    const result = await resolvePendingTxs(WALLET);
    expect(result.find(r => r.txHash === hash)?.status).toBe('failed');

    fetchSpy.mockRestore();
  });

  // --- getTypeLabel ---

  it('getTypeLabel returns expected labels for all 7 types', () => {
    expect(getTypeLabel('create-listing')).toBe('Create Listing');
    expect(getTypeLabel('remove-listing')).toBe('Remove Listing');
    expect(getTypeLabel('place-bid')).toBe('Place Bid');
    expect(getTypeLabel('cancel-bid')).toBe('Cancel Bid');
    expect(getTypeLabel('accept-bid')).toBe('Accept Bid');
    expect(getTypeLabel('cancel-pending')).toBe('Cancel Pending');
    expect(getTypeLabel('complete-sale')).toBe('Complete Sale');
  });
});
