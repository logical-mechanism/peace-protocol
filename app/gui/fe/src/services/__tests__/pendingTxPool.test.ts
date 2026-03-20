import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PendingTxPool } from '../pendingTxPool';
import type { UTxO } from '@meshsdk/core';

// Mock the txOutputParser module
vi.mock('../txOutputParser', () => ({
  parseTxInputs: vi.fn(),
  parseTxOutputs: vi.fn(),
}));

import { parseTxInputs, parseTxOutputs } from '../txOutputParser';

const mockParseTxInputs = parseTxInputs as ReturnType<typeof vi.fn>;
const mockParseTxOutputs = parseTxOutputs as ReturnType<typeof vi.fn>;

function makeUtxo(txHash: string, outputIndex: number, address: string, lovelace: string, assets: Array<{ unit: string; quantity: string }> = []): UTxO {
  return {
    input: { txHash, outputIndex },
    output: {
      address,
      amount: [{ unit: 'lovelace', quantity: lovelace }, ...assets],
    },
  };
}

describe('PendingTxPool', () => {
  let pool: PendingTxPool;

  beforeEach(() => {
    pool = new PendingTxPool();
    vi.clearAllMocks();
  });

  describe('registerTx', () => {
    it('registers a transaction and tracks inputs/outputs', async () => {
      const inputs = [{ txHash: 'aaa', outputIndex: 0 }];
      const outputs = [makeUtxo('tx1', 0, 'addr1', '5000000')];
      mockParseTxInputs.mockResolvedValue(inputs);
      mockParseTxOutputs.mockResolvedValue(outputs);

      await pool.registerTx('cbor_hex', 'tx1');

      expect(pool.size).toBe(1);
      expect(pool.hasPendingTxs()).toBe(true);
      expect(pool.isSpent('aaa', 0)).toBe(true);
      expect(pool.getPendingOutputsByTxHash('tx1')).toEqual(outputs);
    });

    it('ignores duplicate registrations', async () => {
      mockParseTxInputs.mockResolvedValue([]);
      mockParseTxOutputs.mockResolvedValue([]);

      await pool.registerTx('cbor', 'tx1');
      await pool.registerTx('cbor', 'tx1');

      expect(pool.size).toBe(1);
    });

    it('detects dependencies on other pending txs', async () => {
      // Register tx A
      mockParseTxInputs.mockResolvedValue([{ txHash: 'external', outputIndex: 0 }]);
      mockParseTxOutputs.mockResolvedValue([makeUtxo('txA', 0, 'addr1', '5000000')]);
      await pool.registerTx('cbor_a', 'txA');

      // Register tx B that spends tx A's output
      mockParseTxInputs.mockResolvedValue([{ txHash: 'txA', outputIndex: 0 }]);
      mockParseTxOutputs.mockResolvedValue([makeUtxo('txB', 0, 'addr2', '4000000')]);
      await pool.registerTx('cbor_b', 'txB');

      expect(pool.size).toBe(2);
    });
  });

  describe('isSpent', () => {
    it('returns false for unspent UTxOs', () => {
      expect(pool.isSpent('unknown', 0)).toBe(false);
    });

    it('returns true for UTxOs spent by a pending tx', async () => {
      mockParseTxInputs.mockResolvedValue([{ txHash: 'spent_hash', outputIndex: 2 }]);
      mockParseTxOutputs.mockResolvedValue([]);
      await pool.registerTx('cbor', 'tx1');

      expect(pool.isSpent('spent_hash', 2)).toBe(true);
      expect(pool.isSpent('spent_hash', 0)).toBe(false);
    });
  });

  describe('getPendingOutputsByTxHash', () => {
    it('returns empty array for unknown tx', () => {
      expect(pool.getPendingOutputsByTxHash('unknown')).toEqual([]);
    });

    it('returns outputs for known pending tx', async () => {
      const outputs = [
        makeUtxo('tx1', 0, 'addr1', '5000000'),
        makeUtxo('tx1', 1, 'addr2', '2000000'),
      ];
      mockParseTxInputs.mockResolvedValue([]);
      mockParseTxOutputs.mockResolvedValue(outputs);
      await pool.registerTx('cbor', 'tx1');

      expect(pool.getPendingOutputsByTxHash('tx1')).toEqual(outputs);
    });

    it('excludes outputs consumed by later pending tx', async () => {
      // Register tx A with one output
      const outputA = makeUtxo('txA', 0, 'addr1', '5000000');
      mockParseTxInputs.mockResolvedValue([]);
      mockParseTxOutputs.mockResolvedValue([outputA]);
      await pool.registerTx('cbor_a', 'txA');

      // Register tx B that spends tx A's output
      mockParseTxInputs.mockResolvedValue([{ txHash: 'txA', outputIndex: 0 }]);
      mockParseTxOutputs.mockResolvedValue([makeUtxo('txB', 0, 'addr2', '4000000')]);
      await pool.registerTx('cbor_b', 'txB');

      // tx A's output should be excluded (spent by tx B)
      expect(pool.getPendingOutputsByTxHash('txA')).toEqual([]);
      // tx B's output should be available
      expect(pool.getPendingOutputsByTxHash('txB')).toHaveLength(1);
    });
  });

  describe('getAdjustedUtxos', () => {
    it('returns real UTxOs unchanged when pool is empty', () => {
      const real = [makeUtxo('real1', 0, 'addr1', '10000000')];
      expect(pool.getAdjustedUtxos(real)).toEqual(real);
    });

    it('removes spent UTxOs from real results', async () => {
      mockParseTxInputs.mockResolvedValue([{ txHash: 'real1', outputIndex: 0 }]);
      mockParseTxOutputs.mockResolvedValue([makeUtxo('tx1', 0, 'addr1', '9000000')]);
      await pool.registerTx('cbor', 'tx1');

      const real = [
        makeUtxo('real1', 0, 'addr1', '10000000'),
        makeUtxo('real2', 0, 'addr1', '5000000'),
      ];

      const adjusted = pool.getAdjustedUtxos(real);
      expect(adjusted).toHaveLength(2); // real2 + pending tx1 output
      expect(adjusted.find(u => u.input.txHash === 'real1')).toBeUndefined();
      expect(adjusted.find(u => u.input.txHash === 'real2')).toBeDefined();
      expect(adjusted.find(u => u.input.txHash === 'tx1')).toBeDefined();
    });

    it('adds pending outputs matching address filter', async () => {
      const pendingOutput = makeUtxo('tx1', 0, 'addr1', '5000000');
      mockParseTxInputs.mockResolvedValue([]);
      mockParseTxOutputs.mockResolvedValue([
        pendingOutput,
        makeUtxo('tx1', 1, 'addr2', '3000000'),
      ]);
      await pool.registerTx('cbor', 'tx1');

      const real: UTxO[] = [];
      const adjusted = pool.getAdjustedUtxos(real, 'addr1');
      expect(adjusted).toHaveLength(1);
      expect(adjusted[0].output.address).toBe('addr1');
    });

    it('filters pending outputs by asset', async () => {
      const withToken = makeUtxo('tx1', 0, 'addr1', '5000000', [
        { unit: 'policy123token456', quantity: '1' },
      ]);
      const withoutToken = makeUtxo('tx1', 1, 'addr1', '3000000');
      mockParseTxInputs.mockResolvedValue([]);
      mockParseTxOutputs.mockResolvedValue([withToken, withoutToken]);
      await pool.registerTx('cbor', 'tx1');

      const adjusted = pool.getAdjustedUtxos([], 'addr1', 'policy123token456');
      expect(adjusted).toHaveLength(1);
      expect(adjusted[0].input.outputIndex).toBe(0);
    });

    it('deduplicates when Kupo catches up', async () => {
      const utxo = makeUtxo('tx1', 0, 'addr1', '5000000');
      mockParseTxInputs.mockResolvedValue([]);
      mockParseTxOutputs.mockResolvedValue([utxo]);
      await pool.registerTx('cbor', 'tx1');

      // Real results now include the same UTxO
      const realUtxo = makeUtxo('tx1', 0, 'addr1', '5000000');
      const adjusted = pool.getAdjustedUtxos([realUtxo]);
      expect(adjusted).toHaveLength(1); // Not 2
    });
  });

  describe('confirmTx', () => {
    it('removes a confirmed tx from the pool', async () => {
      mockParseTxInputs.mockResolvedValue([]);
      mockParseTxOutputs.mockResolvedValue([]);
      await pool.registerTx('cbor', 'tx1');
      expect(pool.size).toBe(1);

      pool.confirmTx('tx1');
      expect(pool.size).toBe(0);
      expect(pool.hasPendingTxs()).toBe(false);
    });

    it('is a no-op for unknown tx', () => {
      pool.confirmTx('unknown');
      expect(pool.size).toBe(0);
    });
  });

  describe('invalidateChain', () => {
    it('removes a single tx with no dependents', async () => {
      mockParseTxInputs.mockResolvedValue([]);
      mockParseTxOutputs.mockResolvedValue([]);
      await pool.registerTx('cbor', 'tx1');

      const invalidated = pool.invalidateChain('tx1');
      expect(invalidated).toEqual(['tx1']);
      expect(pool.size).toBe(0);
    });

    it('removes a tx and all its dependents', async () => {
      // tx A
      mockParseTxInputs.mockResolvedValue([]);
      mockParseTxOutputs.mockResolvedValue([makeUtxo('txA', 0, 'addr1', '5000000')]);
      await pool.registerTx('cbor_a', 'txA');

      // tx B depends on tx A
      mockParseTxInputs.mockResolvedValue([{ txHash: 'txA', outputIndex: 0 }]);
      mockParseTxOutputs.mockResolvedValue([makeUtxo('txB', 0, 'addr2', '4000000')]);
      await pool.registerTx('cbor_b', 'txB');

      // tx C depends on tx B
      mockParseTxInputs.mockResolvedValue([{ txHash: 'txB', outputIndex: 0 }]);
      mockParseTxOutputs.mockResolvedValue([makeUtxo('txC', 0, 'addr3', '3000000')]);
      await pool.registerTx('cbor_c', 'txC');

      const invalidated = pool.invalidateChain('txA');
      expect(invalidated).toContain('txA');
      expect(invalidated).toContain('txB');
      expect(invalidated).toContain('txC');
      expect(pool.size).toBe(0);
    });

    it('returns empty array for unknown tx', () => {
      const invalidated = pool.invalidateChain('unknown');
      expect(invalidated).toEqual([]);
    });
  });

  describe('pruneStale', () => {
    it('removes txs older than maxAge', async () => {
      mockParseTxInputs.mockResolvedValue([]);
      mockParseTxOutputs.mockResolvedValue([]);
      await pool.registerTx('cbor', 'tx1');

      // Fast-forward time
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 400_000);

      const pruned = pool.pruneStale(300_000);
      expect(pruned).toContain('tx1');
      expect(pool.size).toBe(0);
    });

    it('keeps fresh txs', async () => {
      mockParseTxInputs.mockResolvedValue([]);
      mockParseTxOutputs.mockResolvedValue([]);
      await pool.registerTx('cbor', 'tx1');

      const pruned = pool.pruneStale(300_000);
      expect(pruned).toEqual([]);
      expect(pool.size).toBe(1);
    });
  });

  describe('clear', () => {
    it('removes all pending txs', async () => {
      mockParseTxInputs.mockResolvedValue([]);
      mockParseTxOutputs.mockResolvedValue([]);
      await pool.registerTx('cbor1', 'tx1');
      await pool.registerTx('cbor2', 'tx2');

      pool.clear();
      expect(pool.size).toBe(0);
      expect(pool.hasPendingTxs()).toBe(false);
    });
  });

  describe('getPendingTxHashes', () => {
    it('returns all pending tx hashes', async () => {
      mockParseTxInputs.mockResolvedValue([]);
      mockParseTxOutputs.mockResolvedValue([]);
      await pool.registerTx('cbor1', 'tx1');
      await pool.registerTx('cbor2', 'tx2');

      const hashes = pool.getPendingTxHashes();
      expect(hashes).toContain('tx1');
      expect(hashes).toContain('tx2');
    });
  });

  describe('toOgmiosAdditionalUtxo', () => {
    it('returns empty array when pool is empty', () => {
      expect(pool.toOgmiosAdditionalUtxo()).toEqual([]);
    });

    it('formats lovelace-only output as Ogmios v6 entry', async () => {
      const outputs = [makeUtxo('tx1', 0, 'addr_test1abc', '5000000')];
      mockParseTxInputs.mockResolvedValue([]);
      mockParseTxOutputs.mockResolvedValue(outputs);

      await pool.registerTx('cbor1', 'tx1');
      const result = pool.toOgmiosAdditionalUtxo();

      expect(result).toHaveLength(1);
      const entry = result[0] as Record<string, unknown>;
      expect(entry.transaction).toEqual({ id: 'tx1' });
      expect(entry.index).toBe(0);
      expect(entry.address).toBe('addr_test1abc');
      expect(entry.value).toEqual({ ada: { lovelace: 5000000 } });
    });

    it('formats multi-asset output with policy grouping', async () => {
      const policyId = 'a'.repeat(56);
      const assetName = 'ff01';
      const outputs = [makeUtxo('tx1', 0, 'addr1', '2000000', [
        { unit: policyId + assetName, quantity: '1' },
      ])];
      mockParseTxInputs.mockResolvedValue([]);
      mockParseTxOutputs.mockResolvedValue(outputs);

      await pool.registerTx('cbor1', 'tx1');
      const result = pool.toOgmiosAdditionalUtxo();

      const entry = result[0] as Record<string, unknown>;
      const value = entry.value as Record<string, unknown>;
      expect(value.ada).toEqual({ lovelace: 2000000 });
      expect(value[policyId]).toEqual({ [assetName]: 1 });
    });

    it('includes plutusData when present', async () => {
      const outputs: UTxO[] = [{
        input: { txHash: 'tx1', outputIndex: 0 },
        output: {
          address: 'addr1',
          amount: [{ unit: 'lovelace', quantity: '1000000' }],
          plutusData: '{"constructor":0,"fields":[]}',
        },
      }];
      mockParseTxInputs.mockResolvedValue([]);
      mockParseTxOutputs.mockResolvedValue(outputs);

      await pool.registerTx('cbor1', 'tx1');
      const result = pool.toOgmiosAdditionalUtxo();

      const entry = result[0] as Record<string, unknown>;
      expect(entry.datum).toBe('{"constructor":0,"fields":[]}');
    });

    it('includes dataHash when present', async () => {
      const outputs: UTxO[] = [{
        input: { txHash: 'tx1', outputIndex: 0 },
        output: {
          address: 'addr1',
          amount: [{ unit: 'lovelace', quantity: '1000000' }],
          dataHash: 'aa'.repeat(32),
        },
      }];
      mockParseTxInputs.mockResolvedValue([]);
      mockParseTxOutputs.mockResolvedValue(outputs);

      await pool.registerTx('cbor1', 'tx1');
      const result = pool.toOgmiosAdditionalUtxo();

      const entry = result[0] as Record<string, unknown>;
      expect(entry.datumHash).toBe('aa'.repeat(32));
    });

    it('excludes spent outputs', async () => {
      const outputs = [
        makeUtxo('tx1', 0, 'addr1', '3000000'),
        makeUtxo('tx1', 1, 'addr1', '2000000'),
      ];
      mockParseTxInputs.mockResolvedValue([]);
      mockParseTxOutputs.mockResolvedValue(outputs);
      await pool.registerTx('cbor1', 'tx1');

      // Register a second tx that spends output 0 of tx1
      mockParseTxInputs.mockResolvedValue([{ txHash: 'tx1', outputIndex: 0 }]);
      mockParseTxOutputs.mockResolvedValue([makeUtxo('tx2', 0, 'addr1', '1000000')]);
      await pool.registerTx('cbor2', 'tx2');

      const result = pool.toOgmiosAdditionalUtxo();
      // tx1 output 0 is spent, tx1 output 1 and tx2 output 0 remain
      const txHashes = result.map((e) => (e as { transaction: { id: string } }).transaction.id);
      expect(txHashes).not.toContain('tx1-spent');
      expect(result.length).toBe(2);
    });

    it('handles multiple assets from same policy', async () => {
      const policyId = 'b'.repeat(56);
      const outputs = [makeUtxo('tx1', 0, 'addr1', '2000000', [
        { unit: policyId + 'aa', quantity: '10' },
        { unit: policyId + 'bb', quantity: '20' },
      ])];
      mockParseTxInputs.mockResolvedValue([]);
      mockParseTxOutputs.mockResolvedValue(outputs);

      await pool.registerTx('cbor1', 'tx1');
      const result = pool.toOgmiosAdditionalUtxo();

      const value = (result[0] as { value: Record<string, Record<string, number>> }).value;
      expect(value[policyId]).toEqual({ aa: 10, bb: 20 });
    });
  });
});
