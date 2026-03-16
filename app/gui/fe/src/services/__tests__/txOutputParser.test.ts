import { describe, it, expect, vi } from 'vitest';

// Mock @meshsdk/core-cst since it requires WASM that won't load in test env
vi.mock('@meshsdk/core-cst', () => {
  // Simulated deserialized transaction structure matching the real API
  function createMockTx(inputs: Array<{ txId: string; idx: number }>, outputs: Array<{ addr: string; coin: string; multiasset?: Map<string, bigint>; datum?: string }>) {
    return {
      body: () => ({
        inputs: () => ({
          values: () => inputs.map((inp) => ({
            transactionId: () => ({ toString: () => inp.txId }),
            index: () => ({ toString: () => String(inp.idx) }),
          })),
        }),
        outputs: () => outputs.map((out) => ({
          address: () => ({
            toBech32: () => out.addr,
          }),
          amount: () => ({
            coin: () => ({ toString: () => out.coin }),
            multiasset: () => out.multiasset ? {} : undefined,
            toCore: () => ({
              assets: out.multiasset ?? undefined,
            }),
          }),
          datum: () => out.datum ? ({
            toCbor: () => out.datum,
          }) : undefined,
          scriptRef: () => undefined,
        })),
      }),
      getId: () => ({ toString: () => 'mock_tx_hash' }),
    };
  }

  return {
    deserializeTx: vi.fn((cbor: string) => {
      // Return different mocks based on CBOR input for testing
      if (cbor === 'simple_tx') {
        return createMockTx(
          [{ txId: 'aabbccdd', idx: 0 }],
          [{ addr: 'addr_test1qz...', coin: '5000000' }],
        );
      }
      if (cbor === 'multiasset_tx') {
        return createMockTx(
          [{ txId: 'input1', idx: 0 }, { txId: 'input2', idx: 1 }],
          [
            {
              addr: 'addr_test1_contract',
              coin: '2000000',
              multiasset: new Map([['policyIdTokenName', BigInt(1)]]),
            },
            { addr: 'addr_test1_change', coin: '8000000' },
          ],
        );
      }
      if (cbor === 'datum_tx') {
        return createMockTx(
          [{ txId: 'datum_input', idx: 0 }],
          [{ addr: 'addr_test1_script', coin: '3000000', datum: 'd8799f00ff' }],
        );
      }
      if (cbor === 'empty_tx') {
        return createMockTx([], []);
      }
      // Default
      return createMockTx([], []);
    }),
  };
});

import { parseTxInputs, parseTxOutputs } from '../txOutputParser';

describe('txOutputParser', () => {
  describe('parseTxInputs', () => {
    it('parses inputs from a simple transaction', async () => {
      const inputs = await parseTxInputs('simple_tx');
      expect(inputs).toEqual([{ txHash: 'aabbccdd', outputIndex: 0 }]);
    });

    it('parses multiple inputs', async () => {
      const inputs = await parseTxInputs('multiasset_tx');
      expect(inputs).toHaveLength(2);
      expect(inputs[0]).toEqual({ txHash: 'input1', outputIndex: 0 });
      expect(inputs[1]).toEqual({ txHash: 'input2', outputIndex: 1 });
    });

    it('handles transactions with no inputs', async () => {
      const inputs = await parseTxInputs('empty_tx');
      expect(inputs).toEqual([]);
    });
  });

  describe('parseTxOutputs', () => {
    it('parses a simple lovelace-only output', async () => {
      const outputs = await parseTxOutputs('simple_tx', 'my_tx_hash');
      expect(outputs).toHaveLength(1);
      expect(outputs[0]).toEqual({
        input: { txHash: 'my_tx_hash', outputIndex: 0 },
        output: {
          address: 'addr_test1qz...',
          amount: [{ unit: 'lovelace', quantity: '5000000' }],
          dataHash: undefined,
          plutusData: undefined,
          scriptHash: undefined,
          scriptRef: undefined,
        },
      });
    });

    it('parses multiasset outputs', async () => {
      const outputs = await parseTxOutputs('multiasset_tx', 'multi_hash');
      expect(outputs).toHaveLength(2);

      // First output: contract with token
      expect(outputs[0].input).toEqual({ txHash: 'multi_hash', outputIndex: 0 });
      expect(outputs[0].output.address).toBe('addr_test1_contract');
      expect(outputs[0].output.amount).toContainEqual({ unit: 'lovelace', quantity: '2000000' });
      expect(outputs[0].output.amount).toContainEqual({ unit: 'policyIdTokenName', quantity: '1' });

      // Second output: change (lovelace only)
      expect(outputs[1].input).toEqual({ txHash: 'multi_hash', outputIndex: 1 });
      expect(outputs[1].output.address).toBe('addr_test1_change');
      expect(outputs[1].output.amount).toHaveLength(1);
    });

    it('parses outputs with inline datum', async () => {
      const outputs = await parseTxOutputs('datum_tx', 'datum_hash');
      expect(outputs).toHaveLength(1);
      expect(outputs[0].output.plutusData).toBe('d8799f00ff');
    });

    it('handles transactions with no outputs', async () => {
      const outputs = await parseTxOutputs('empty_tx', 'empty_hash');
      expect(outputs).toEqual([]);
    });

    it('uses provided txHash for all output indices', async () => {
      const outputs = await parseTxOutputs('multiasset_tx', 'custom_hash');
      expect(outputs[0].input.txHash).toBe('custom_hash');
      expect(outputs[1].input.txHash).toBe('custom_hash');
      expect(outputs[0].input.outputIndex).toBe(0);
      expect(outputs[1].input.outputIndex).toBe(1);
    });
  });
});
