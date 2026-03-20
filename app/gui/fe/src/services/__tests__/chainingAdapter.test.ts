import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChainingAdapter } from '../chainingAdapter';
import { PendingTxPool } from '../pendingTxPool';
import type { KupoAdapter } from '../kupoAdapter';
import type { UTxO, AccountInfo, AssetMetadata, BlockInfo, Protocol, TransactionInfo, GovernanceProposalInfo } from '@meshsdk/core';

// Mock the txOutputParser so PendingTxPool.registerTx works in isolation
vi.mock('../txOutputParser', () => ({
  parseTxInputs: vi.fn().mockResolvedValue([]),
  parseTxOutputs: vi.fn().mockResolvedValue([]),
}));

function makeUtxo(txHash: string, outputIndex: number, address: string, lovelace: string, assets: Array<{ unit: string; quantity: string }> = []): UTxO {
  return {
    input: { txHash, outputIndex },
    output: {
      address,
      amount: [{ unit: 'lovelace', quantity: lovelace }, ...assets],
    },
  };
}

function createMockAdapter(): KupoAdapter {
  return {
    fetchAddressUTxOs: vi.fn().mockResolvedValue([]),
    fetchUTxOs: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({}),
    fetchAccountInfo: vi.fn(),
    fetchAssetAddresses: vi.fn(),
    fetchAssetMetadata: vi.fn(),
    fetchBlockInfo: vi.fn(),
    fetchCollectionAssets: vi.fn(),
    fetchProtocolParameters: vi.fn(),
    fetchTxInfo: vi.fn(),
    fetchGovernanceProposal: vi.fn(),
  } as unknown as KupoAdapter;
}

describe('ChainingAdapter', () => {
  let mockAdapter: KupoAdapter;
  let pool: PendingTxPool;
  let adapter: ChainingAdapter;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    pool = new PendingTxPool();
    adapter = new ChainingAdapter(mockAdapter, pool);
  });

  describe('fetchAddressUTxOs', () => {
    it('delegates to real adapter when pool is empty', async () => {
      const real = [makeUtxo('real1', 0, 'addr1', '10000000')];
      (mockAdapter.fetchAddressUTxOs as ReturnType<typeof vi.fn>).mockResolvedValue(real);

      const result = await adapter.fetchAddressUTxOs('addr1');
      expect(result).toEqual(real);
      expect(mockAdapter.fetchAddressUTxOs).toHaveBeenCalledWith('addr1', undefined);
    });

    it('removes spent inputs from real results', async () => {
      const real = [
        makeUtxo('real1', 0, 'addr1', '10000000'),
        makeUtxo('real2', 0, 'addr1', '5000000'),
      ];
      (mockAdapter.fetchAddressUTxOs as ReturnType<typeof vi.fn>).mockResolvedValue(real);

      // Manually configure pool to have real1#0 as spent
      const { parseTxInputs, parseTxOutputs } = await import('../txOutputParser');
      (parseTxInputs as ReturnType<typeof vi.fn>).mockResolvedValue([{ txHash: 'real1', outputIndex: 0 }]);
      (parseTxOutputs as ReturnType<typeof vi.fn>).mockResolvedValue([makeUtxo('tx1', 0, 'addr1', '9000000')]);
      await pool.registerTx('cbor', 'tx1');

      const result = await adapter.fetchAddressUTxOs('addr1');
      expect(result.find(u => u.input.txHash === 'real1')).toBeUndefined();
      expect(result.find(u => u.input.txHash === 'real2')).toBeDefined();
      expect(result.find(u => u.input.txHash === 'tx1')).toBeDefined();
    });

    it('passes asset filter through to pool', async () => {
      (mockAdapter.fetchAddressUTxOs as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const { parseTxInputs, parseTxOutputs } = await import('../txOutputParser');
      (parseTxInputs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (parseTxOutputs as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeUtxo('tx1', 0, 'addr1', '5000000', [{ unit: 'policyToken', quantity: '1' }]),
        makeUtxo('tx1', 1, 'addr1', '3000000'),
      ]);
      await pool.registerTx('cbor', 'tx1');

      const result = await adapter.fetchAddressUTxOs('addr1', 'policyToken');
      expect(result).toHaveLength(1);
      expect(result[0].input.outputIndex).toBe(0);
    });
  });

  describe('fetchUTxOs', () => {
    it('returns pending outputs for a pending tx hash', async () => {
      const { parseTxInputs, parseTxOutputs } = await import('../txOutputParser');
      const outputs = [makeUtxo('txPending', 0, 'addr1', '5000000')];
      (parseTxInputs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (parseTxOutputs as ReturnType<typeof vi.fn>).mockResolvedValue(outputs);
      await pool.registerTx('cbor', 'txPending');

      const result = await adapter.fetchUTxOs('txPending');
      expect(result).toEqual(outputs);
      // Should NOT call real adapter
      expect(mockAdapter.fetchUTxOs).not.toHaveBeenCalled();
    });

    it('filters by output index for pending tx', async () => {
      const { parseTxInputs, parseTxOutputs } = await import('../txOutputParser');
      const outputs = [
        makeUtxo('txPending', 0, 'addr1', '5000000'),
        makeUtxo('txPending', 1, 'addr2', '3000000'),
      ];
      (parseTxInputs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (parseTxOutputs as ReturnType<typeof vi.fn>).mockResolvedValue(outputs);
      await pool.registerTx('cbor', 'txPending');

      const result = await adapter.fetchUTxOs('txPending', 1);
      expect(result).toHaveLength(1);
      expect(result[0].input.outputIndex).toBe(1);
    });

    it('delegates to real adapter for non-pending tx hash', async () => {
      const real = [makeUtxo('confirmed', 0, 'addr1', '10000000')];
      (mockAdapter.fetchUTxOs as ReturnType<typeof vi.fn>).mockResolvedValue(real);

      const result = await adapter.fetchUTxOs('confirmed');
      expect(result).toEqual(real);
      expect(mockAdapter.fetchUTxOs).toHaveBeenCalledWith('confirmed', undefined);
    });

    it('filters out spent UTxOs from real results', async () => {
      const { parseTxInputs, parseTxOutputs } = await import('../txOutputParser');
      (parseTxInputs as ReturnType<typeof vi.fn>).mockResolvedValue([{ txHash: 'confirmed', outputIndex: 0 }]);
      (parseTxOutputs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await pool.registerTx('cbor', 'someTx');

      const real = [
        makeUtxo('confirmed', 0, 'addr1', '10000000'),
        makeUtxo('confirmed', 1, 'addr1', '5000000'),
      ];
      (mockAdapter.fetchUTxOs as ReturnType<typeof vi.fn>).mockResolvedValue(real);

      const result = await adapter.fetchUTxOs('confirmed');
      expect(result).toHaveLength(1);
      expect(result[0].input.outputIndex).toBe(1);
    });
  });

  describe('delegation methods', () => {
    it('delegates get() to real adapter', async () => {
      (mockAdapter.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: 'test' });
      const result = await adapter.get('/test');
      expect(result).toEqual({ data: 'test' });
    });

    it('delegates fetchAccountInfo to real adapter', async () => {
      const info: AccountInfo = { balance: '1000', active: true, rewards: '0', withdrawals: '0' };
      (mockAdapter.fetchAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(info);
      const result = await adapter.fetchAccountInfo('stake_addr');
      expect(result).toEqual(info);
    });

    it('delegates fetchAssetAddresses to real adapter', async () => {
      const addrs = [{ address: 'addr1', quantity: '1' }];
      (mockAdapter.fetchAssetAddresses as ReturnType<typeof vi.fn>).mockResolvedValue(addrs);
      const result = await adapter.fetchAssetAddresses('policyToken');
      expect(result).toEqual(addrs);
    });

    it('delegates fetchAssetMetadata to real adapter', async () => {
      const meta = { name: 'test' } as AssetMetadata;
      (mockAdapter.fetchAssetMetadata as ReturnType<typeof vi.fn>).mockResolvedValue(meta);
      const result = await adapter.fetchAssetMetadata('asset');
      expect(result).toEqual(meta);
    });

    it('delegates fetchBlockInfo to real adapter', async () => {
      const block = { hash: 'abc', height: 100 } as BlockInfo;
      (mockAdapter.fetchBlockInfo as ReturnType<typeof vi.fn>).mockResolvedValue(block);
      const result = await adapter.fetchBlockInfo('abc');
      expect(result).toEqual(block);
    });

    it('delegates fetchCollectionAssets to real adapter', async () => {
      const assets = { assets: [], next: null };
      (mockAdapter.fetchCollectionAssets as ReturnType<typeof vi.fn>).mockResolvedValue(assets);
      const result = await adapter.fetchCollectionAssets('policy1');
      expect(result).toEqual(assets);
    });

    it('delegates fetchProtocolParameters to real adapter', async () => {
      const params = { minFee: 44 } as Protocol;
      (mockAdapter.fetchProtocolParameters as ReturnType<typeof vi.fn>).mockResolvedValue(params);
      const result = await adapter.fetchProtocolParameters(100);
      expect(result).toEqual(params);
    });

    it('delegates fetchTxInfo to real adapter', async () => {
      const txInfo = { hash: 'tx1' } as TransactionInfo;
      (mockAdapter.fetchTxInfo as ReturnType<typeof vi.fn>).mockResolvedValue(txInfo);
      const result = await adapter.fetchTxInfo('tx1');
      expect(result).toEqual(txInfo);
    });

    it('delegates fetchGovernanceProposal to real adapter', async () => {
      const proposal = { txHash: 'tx1', certIndex: 0 } as GovernanceProposalInfo;
      (mockAdapter.fetchGovernanceProposal as ReturnType<typeof vi.fn>).mockResolvedValue(proposal);
      const result = await adapter.fetchGovernanceProposal('tx1', 0);
      expect(result).toEqual(proposal);
    });
  });
});
