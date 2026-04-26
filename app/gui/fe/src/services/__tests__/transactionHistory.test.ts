import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../notificationSound', () => ({
  playSound: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import {
  getTransactions,
  addTransaction,
  updateTransactionStatus,
  getPendingCount,
  clearHistory,
  clearOlderThan,
  clearFailed,
  reconcileWithOnChain,
  resolvePendingTxs,
  getTypeLabel,
  toCSV,
  reencryptionHistoryToCSV,
  type TransactionRecord,
} from '../transactionHistory';
import type { ReencryptionEvent } from '../api';

const mockInvoke = vi.mocked(invoke);

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
    localStorage.setItem('veiled_tx_history_' + WALLET, '{broken');
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

  it('updateTransactionStatus stores confirmedAtBlock when extra param provided', () => {
    const hash = 'e'.repeat(64);
    addTransaction(WALLET, makeRecord({ txHash: hash, status: 'pending' }));

    updateTransactionStatus(WALLET, hash, 'confirmed', { confirmedAtBlock: 12345 });

    const records = getTransactions(WALLET);
    expect(records[0].status).toBe('confirmed');
    expect(records[0].confirmedAtBlock).toBe(12345);
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

  // --- clearOlderThan ---

  it('clearOlderThan removes records older than N days and returns count', () => {
    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const recent = Date.now() - 1000;
    addTransaction(WALLET, makeRecord({ txHash: '1'.repeat(64), timestamp: thirtyOneDaysAgo }));
    addTransaction(WALLET, makeRecord({ txHash: '2'.repeat(64), timestamp: recent }));

    const removed = clearOlderThan(WALLET, 30);
    expect(removed).toBe(1);

    const remaining = getTransactions(WALLET);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].txHash).toBe('2'.repeat(64));
  });

  it('clearOlderThan returns 0 when nothing is old enough', () => {
    addTransaction(WALLET, makeRecord({ txHash: '1'.repeat(64), timestamp: Date.now() }));

    const removed = clearOlderThan(WALLET, 30);
    expect(removed).toBe(0);
    expect(getTransactions(WALLET)).toHaveLength(1);
  });

  // --- clearFailed ---

  it('clearFailed removes only failed records and returns count', () => {
    addTransaction(WALLET, makeRecord({ txHash: '1'.repeat(64), status: 'failed' }));
    addTransaction(WALLET, makeRecord({ txHash: '2'.repeat(64), status: 'confirmed' }));
    addTransaction(WALLET, makeRecord({ txHash: '3'.repeat(64), status: 'pending' }));

    const removed = clearFailed(WALLET);
    expect(removed).toBe(1);

    const remaining = getTransactions(WALLET);
    expect(remaining).toHaveLength(2);
    expect(remaining.every(r => r.status !== 'failed')).toBe(true);
  });

  it('clearFailed returns 0 when no failed records exist', () => {
    addTransaction(WALLET, makeRecord({ txHash: '1'.repeat(64), status: 'confirmed' }));
    addTransaction(WALLET, makeRecord({ txHash: '2'.repeat(64), status: 'pending' }));

    const removed = clearFailed(WALLET);
    expect(removed).toBe(0);
    expect(getTransactions(WALLET)).toHaveLength(2);
  });

  // --- reconcileWithOnChain ---

  it('reconcileWithOnChain promotes pending to confirmed when on-chain match found', () => {
    const hash = 'e'.repeat(64);
    addTransaction(WALLET, makeRecord({ txHash: hash, status: 'pending' }));

    const onChain = [makeRecord({ txHash: hash, status: 'confirmed' })];
    const { records } = reconcileWithOnChain(WALLET, onChain);

    expect(records.find(r => r.txHash === hash)?.status).toBe('confirmed');
  });

  it('reconcileWithOnChain adds on-chain records not in local', () => {
    const localHash = 'f'.repeat(64);
    const onChainHash = '0'.repeat(64);
    addTransaction(WALLET, makeRecord({ txHash: localHash }));

    const onChain = [makeRecord({ txHash: onChainHash, status: 'confirmed' })];
    const { records } = reconcileWithOnChain(WALLET, onChain);

    expect(records.some(r => r.txHash === onChainHash)).toBe(true);
    expect(records.some(r => r.txHash === localHash)).toBe(true);
  });

  it('reconcileWithOnChain sorts newest first', () => {
    addTransaction(WALLET, makeRecord({ txHash: '1'.repeat(64), timestamp: 1000 }));

    const onChain = [
      makeRecord({ txHash: '2'.repeat(64), timestamp: 3000, status: 'confirmed' }),
      makeRecord({ txHash: '3'.repeat(64), timestamp: 2000, status: 'confirmed' }),
    ];
    const { records } = reconcileWithOnChain(WALLET, onChain);

    expect(records[0].timestamp).toBeGreaterThanOrEqual(records[1].timestamp);
    if (records.length > 2) {
      expect(records[1].timestamp).toBeGreaterThanOrEqual(records[2].timestamp);
    }
  });

  it('reconcileWithOnChain refreshes timestamp on existing record when on-chain has a real one', () => {
    const hash = 'a'.repeat(64);
    // Earlier reconcile saved this with a stale 0 timestamp (the historical bug).
    addTransaction(WALLET, makeRecord({ txHash: hash, status: 'confirmed', timestamp: 0, type: 'receive' }));

    // New reconcile: on-chain now reports the real timestamp.
    reconcileWithOnChain(WALLET, [
      makeRecord({ txHash: hash, status: 'confirmed', timestamp: 1777135121000, type: 'receive' }),
    ]);

    const records = getTransactions(WALLET);
    expect(records).toHaveLength(1);
    expect(records[0].timestamp).toBe(1777135121000);
  });

  it('reconcileWithOnChain backfills missing amount/counterparty/block on existing records', () => {
    const hash = 'b'.repeat(64);
    addTransaction(WALLET, makeRecord({ txHash: hash, status: 'confirmed', timestamp: 0, type: 'receive' }));

    reconcileWithOnChain(WALLET, [
      makeRecord({
        txHash: hash,
        status: 'confirmed',
        timestamp: 1777135121000,
        type: 'receive',
        amountLovelace: 12_345_678,
        counterparty: 'dd996ca1174aa2e32dbbad88046b440ff563a3cde0716a56865400c6',
        confirmedAtBlock: 4643117,
      }),
    ]);

    const [r] = getTransactions(WALLET);
    expect(r.amountLovelace).toBe(12_345_678);
    expect(r.counterparty).toBe('dd996ca1174aa2e32dbbad88046b440ff563a3cde0716a56865400c6');
    expect(r.confirmedAtBlock).toBe(4643117);
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

    const { records } = reconcileWithOnChain(WALLET, onChain);
    expect(records.length).toBeLessThanOrEqual(100);
  });

  it('reconcileWithOnChain does not write to localStorage when nothing changed', () => {
    const hash = 'a'.repeat(64);
    addTransaction(WALLET, makeRecord({ txHash: hash, status: 'confirmed' }));

    const spy = vi.spyOn(Storage.prototype, 'setItem');

    // Pass empty on-chain array — nothing to promote, nothing to add
    reconcileWithOnChain(WALLET, []);

    // The only setItem calls should be from addTransaction above, not from reconcile
    const reconcileCalls = spy.mock.calls.filter(
      (call) => call[0] === 'veiled_tx_history_' + WALLET
    );
    // addTransaction called setItem once; reconcile should NOT have called it again
    expect(reconcileCalls).toHaveLength(0);

    spy.mockRestore();
  });

  it('reconcileWithOnChain promotes failed to confirmed when found on-chain', () => {
    const hash = 'd'.repeat(64);
    addTransaction(WALLET, makeRecord({ txHash: hash, status: 'failed' }));

    const onChain = [makeRecord({ txHash: hash, status: 'confirmed' })];
    const { records, discrepancies } = reconcileWithOnChain(WALLET, onChain);

    expect(records.find(r => r.txHash === hash)?.status).toBe('confirmed');
    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0].localStatus).toBe('failed');
    expect(discrepancies[0].resolvedStatus).toBe('confirmed');
  });

  it('reconcileWithOnChain reports discrepancy when promoting pending', () => {
    const hash = 'e'.repeat(64);
    addTransaction(WALLET, makeRecord({ txHash: hash, status: 'pending' }));

    const onChain = [makeRecord({ txHash: hash, status: 'confirmed' })];
    const { discrepancies } = reconcileWithOnChain(WALLET, onChain);

    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0].localStatus).toBe('pending');
    expect(discrepancies[0].resolvedStatus).toBe('confirmed');
  });

  it('reconcileWithOnChain does not flag confirmed records as discrepancies', () => {
    const hash = 'f'.repeat(64);
    addTransaction(WALLET, makeRecord({ txHash: hash, status: 'confirmed' }));

    const onChain = [makeRecord({ txHash: hash, status: 'confirmed' })];
    const { discrepancies } = reconcileWithOnChain(WALLET, onChain);

    expect(discrepancies).toHaveLength(0);
  });

  it('reconcileWithOnChain reports multiple discrepancies', () => {
    const h1 = '1'.repeat(64);
    const h2 = '2'.repeat(64);
    addTransaction(WALLET, makeRecord({ txHash: h1, status: 'pending' }));
    addTransaction(WALLET, makeRecord({ txHash: h2, status: 'failed' }));

    const onChain = [
      makeRecord({ txHash: h1, status: 'confirmed' }),
      makeRecord({ txHash: h2, status: 'confirmed' }),
    ];
    const { discrepancies } = reconcileWithOnChain(WALLET, onChain);

    expect(discrepancies).toHaveLength(2);
    expect(discrepancies.find(d => d.txHash === h1)?.localStatus).toBe('pending');
    expect(discrepancies.find(d => d.txHash === h2)?.localStatus).toBe('failed');
  });

  it('reconcileWithOnChain returns empty discrepancies when nothing changes', () => {
    addTransaction(WALLET, makeRecord({ txHash: 'a'.repeat(64), status: 'confirmed' }));

    const { discrepancies } = reconcileWithOnChain(WALLET, []);

    expect(discrepancies).toHaveLength(0);
  });

  // --- resolvePendingTxs ---

  it('resolvePendingTxs confirms tx when Kupo returns matches', async () => {
    const hash = 'b'.repeat(64);
    addTransaction(WALLET, makeRecord({ txHash: hash, status: 'pending' }));

    mockInvoke.mockResolvedValue(JSON.stringify([{ some: 'match' }]));

    const result = await resolvePendingTxs(WALLET);
    expect(result.find(r => r.txHash === hash)?.status).toBe('confirmed');
  });

  it('resolvePendingTxs marks as failed after 5 min with no matches', async () => {
    const hash = 'c'.repeat(64);
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
    addTransaction(WALLET, makeRecord({ txHash: hash, status: 'pending', timestamp: sixMinutesAgo }));

    mockInvoke.mockResolvedValue(JSON.stringify([]));

    const result = await resolvePendingTxs(WALLET);
    expect(result.find(r => r.txHash === hash)?.status).toBe('failed');
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

  describe('toCSV', () => {
    const CSV_HEADER = 'Date,Type,Status,Tx Hash,Token Name,Description,Amount (ADA),Confirmation Block,Counterparty';

    it('returns header-only for empty records', () => {
      const csv = toCSV([]);
      expect(csv).toBe(CSV_HEADER);
    });

    it('generates valid CSV rows', () => {
      const records = [
        makeRecord({
          txHash: 'a'.repeat(64),
          type: 'create-listing',
          status: 'confirmed',
          timestamp: 1700000000000,
          tokenName: 'abc123',
          description: 'Test listing',
        }),
      ];
      const csv = toCSV(records);
      const lines = csv.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe(CSV_HEADER);
      expect(lines[1]).toContain('Create Listing');
      expect(lines[1]).toContain('confirmed');
      expect(lines[1]).toContain('abc123');
      expect(lines[1]).toContain('Test listing');
    });

    it('handles missing optional fields', () => {
      const records = [makeRecord({ tokenName: undefined, description: undefined })];
      const csv = toCSV(records);
      const lines = csv.split('\n');
      expect(lines).toHaveLength(2);
      const fields = lines[1].split(',');
      expect(fields[4]).toBe(''); // Token Name
      expect(fields[5]).toBe(''); // Description
      expect(fields[6]).toBe(''); // Amount (ADA) — no amount
      expect(fields[7]).toBe(''); // Confirmation Block
      expect(fields[8]).toBe(''); // Counterparty
    });

    it('escapes descriptions containing commas', () => {
      const records = [makeRecord({ description: 'Bid 1,000 ADA' })];
      const csv = toCSV(records);
      expect(csv).toContain('"Bid 1,000 ADA"');
    });

    it('escapes descriptions containing double quotes', () => {
      const records = [makeRecord({ description: 'A "test" listing' })];
      const csv = toCSV(records);
      expect(csv).toContain('"A ""test"" listing"');
    });

    it('escapes descriptions containing newlines', () => {
      const records = [makeRecord({ description: 'Line one\nLine two' })];
      const csv = toCSV(records);
      expect(csv).toContain('"Line one\nLine two"');
    });

    it('generates multiple rows in order', () => {
      const records = [
        makeRecord({ type: 'create-listing', timestamp: 1700000000000 }),
        makeRecord({ type: 'place-bid', timestamp: 1700000001000 }),
      ];
      const csv = toCSV(records);
      const lines = csv.split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[1]).toContain('Create Listing');
      expect(lines[2]).toContain('Place Bid');
    });

    it('uses ISO date format', () => {
      const records = [makeRecord({ timestamp: 1700000000000 })];
      const csv = toCSV(records);
      // 1700000000000 = 2023-11-14T22:13:20.000Z
      expect(csv).toContain('2023-11-14T22:13:20.000Z');
    });

    it('includes amountLovelace as ADA with 6 decimal places', () => {
      const records = [makeRecord({ amountLovelace: 50_000_000 })];
      const csv = toCSV(records);
      const lines = csv.split('\n');
      const fields = lines[1].split(',');
      expect(fields[6]).toBe('50.000000');
    });

    it('includes confirmedAtBlock and counterparty', () => {
      const records = [makeRecord({
        confirmedAtBlock: 98765,
        counterparty: 'f'.repeat(56),
      })];
      const csv = toCSV(records);
      const lines = csv.split('\n');
      const fields = lines[1].split(',');
      expect(fields[7]).toBe('98765');
      expect(fields[8]).toBe('f'.repeat(56));
    });

    it('backward compat: old records without new fields produce empty columns', () => {
      // Simulate a record without the new optional fields
      const records = [makeRecord()];
      const csv = toCSV(records);
      const lines = csv.split('\n');
      const fields = lines[1].split(',');
      expect(fields[6]).toBe(''); // no amount
      expect(fields[7]).toBe(''); // no block
      expect(fields[8]).toBe(''); // no counterparty
    });
  });

  describe('reencryptionHistoryToCSV', () => {
    const REENC_HEADER =
      'Date,Side,Token Name,Bid Amount (ADA),Future Price (ADA),Seller PKH,Buyer PKH,Tx Hash,Block Height';
    const USER = 'a'.repeat(56);
    const OTHER = 'b'.repeat(56);

    function makeEvent(overrides: Partial<ReencryptionEvent> = {}): ReencryptionEvent {
      return {
        txHash: 'c'.repeat(64),
        blockHeight: 4_000_000,
        timestamp: 1_700_000_000_000,
        encryptionTokenName: 'enc_token_alpha',
        buyerPkh: USER,
        sellerPkh: OTHER,
        bidAmountLovelace: 25_000_000,
        futurePriceLovelace: 60_000_000,
        ...overrides,
      };
    }

    it('returns header-only for empty input', () => {
      expect(reencryptionHistoryToCSV([], USER)).toBe(REENC_HEADER);
    });

    it('marks rows where the user is the buyer as Purchase', () => {
      const csv = reencryptionHistoryToCSV([makeEvent({ buyerPkh: USER, sellerPkh: OTHER })], USER);
      const fields = csv.split('\n')[1].split(',');
      expect(fields[0]).toBe('2023-11-14T22:13:20.000Z');
      expect(fields[1]).toBe('Purchase');
      expect(fields[2]).toBe('enc_token_alpha');
      expect(fields[3]).toBe('25.000000');
      expect(fields[4]).toBe('60.000000');
      expect(fields[5]).toBe(OTHER); // seller
      expect(fields[6]).toBe(USER);  // buyer
      expect(fields[7]).toBe('c'.repeat(64));
      expect(fields[8]).toBe('4000000');
    });

    it('marks rows where the user is the seller as Sale', () => {
      const csv = reencryptionHistoryToCSV([makeEvent({ buyerPkh: OTHER, sellerPkh: USER })], USER);
      const fields = csv.split('\n')[1].split(',');
      expect(fields[1]).toBe('Sale');
      expect(fields[5]).toBe(USER);  // seller
      expect(fields[6]).toBe(OTHER); // buyer
    });

    it('emits one row per event in input order', () => {
      const events = [
        makeEvent({ txHash: '1'.repeat(64), buyerPkh: USER, sellerPkh: OTHER }),
        makeEvent({ txHash: '2'.repeat(64), buyerPkh: OTHER, sellerPkh: USER }),
      ];
      const csv = reencryptionHistoryToCSV(events, USER);
      const lines = csv.split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[1]).toContain('Purchase');
      expect(lines[2]).toContain('Sale');
    });

    it('formats ADA amounts to 6 decimal places', () => {
      const csv = reencryptionHistoryToCSV(
        [makeEvent({ bidAmountLovelace: 1_500_000, futurePriceLovelace: 0 })],
        USER,
      );
      const fields = csv.split('\n')[1].split(',');
      expect(fields[3]).toBe('1.500000');
      expect(fields[4]).toBe('0.000000');
    });
  });
});
