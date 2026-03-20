/**
 * Tests for acceptBid.ts — accept-bid & re-encryption transactions.
 *
 * Mocks all external dependencies to test prepareSnarkInputs, acceptBidSnark,
 * completeReEncryption, and acceptBidAndReEncrypt flows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IWallet } from '@meshsdk/core';

// ── Hoisted mocks ──────────────────────────────────────────────────

const {
  mockComplete,
  mockTxBuilder,
  mockFetchAddressUTxOs,
  mockGetConfig,
  mockStoreAcceptBidSecrets,
  mockGetAcceptBidSecrets,
  mockDeriveSecretFromWallet,
  mockGtToHash,
  mockInvoke,
  mockRng,
  mockG1Point,
  mockScale,
  mockCombine,
  mockToInt,
} = vi.hoisted(() => {
  const mockComplete = vi.fn().mockResolvedValue('unsigned_tx_hex');
  const mockTxBuilder = {
    txIn: vi.fn().mockReturnThis(),
    readOnlyTxInReference: vi.fn().mockReturnThis(),
    mintPlutusScriptV3: vi.fn().mockReturnThis(),
    mint: vi.fn().mockReturnThis(),
    mintTxInReference: vi.fn().mockReturnThis(),
    mintRedeemerValue: vi.fn().mockReturnThis(),
    txOut: vi.fn().mockReturnThis(),
    txOutInlineDatumValue: vi.fn().mockReturnThis(),
    txInCollateral: vi.fn().mockReturnThis(),
    requiredSignerHash: vi.fn().mockReturnThis(),
    metadataValue: vi.fn().mockReturnThis(),
    changeAddress: vi.fn().mockReturnThis(),
    selectUtxosFrom: vi.fn().mockReturnThis(),
    complete: mockComplete,
    completeSync: vi.fn(),
    spendingPlutusScriptV3: vi.fn().mockReturnThis(),
    spendingTxInReference: vi.fn().mockReturnThis(),
    txInInlineDatumPresent: vi.fn().mockReturnThis(),
    txInRedeemerValue: vi.fn().mockReturnThis(),
    invalidBefore: vi.fn().mockReturnThis(),
    invalidHereafter: vi.fn().mockReturnThis(),
    withdrawalPlutusScriptV3: vi.fn().mockReturnThis(),
    withdrawal: vi.fn().mockReturnThis(),
    withdrawalTxInReference: vi.fn().mockReturnThis(),
    withdrawalRedeemerValue: vi.fn().mockReturnThis(),
    txEvaluationMultiplier: 1.0,
  };
  return {
    mockComplete,
    mockTxBuilder,
    mockFetchAddressUTxOs: vi.fn(),
    mockGetConfig: vi.fn(),
    mockStoreAcceptBidSecrets: vi.fn(),
    mockGetAcceptBidSecrets: vi.fn(),
    mockDeriveSecretFromWallet: vi.fn().mockResolvedValue(42n),
    mockGtToHash: vi.fn().mockResolvedValue('aa'.repeat(32)),
    mockInvoke: vi.fn(),
    mockRng: vi.fn(),
    mockG1Point: vi.fn(() => 'g1_point'),
    mockScale: vi.fn(() => 'scaled_point'),
    mockCombine: vi.fn(() => 'combined_point'),
    mockToInt: vi.fn(() => 99n),
  };
});

// ── Module mocks ───────────────────────────────────────────────────

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

vi.mock('@meshsdk/core', () => ({
  MeshTxBuilder: vi.fn(() => mockTxBuilder),
  deserializeAddress: vi.fn(() => ({
    pubKeyHash: 'abc123def456abc123def456abc123de',
  })),
}));

vi.mock('@meshsdk/provider', () => ({
  OgmiosProvider: vi.fn(),
}));

vi.mock('@scure/base', () => ({
  bech32: {
    toWords: vi.fn(() => [0, 1, 2]),
    encode: vi.fn(() => 'stake_test1_mock_address'),
  },
}));

vi.mock('../../providers', () => ({
  getKupoAdapter: () => ({ fetchAddressUTxOs: mockFetchAddressUTxOs }),
  getChainingAdapter: () => ({ fetchAddressUTxOs: mockFetchAddressUTxOs }),
  getOgmiosProvider: vi.fn(),
  getPendingTxPool: () => ({
    registerTx: vi.fn().mockResolvedValue(undefined),
    confirmTx: vi.fn(),
    invalidateChain: vi.fn(),
    clear: vi.fn(),
    toOgmiosAdditionalUtxo: vi.fn().mockReturnValue([]),
  }),
}));

vi.mock('../../secretStorage', () => ({
  storeSecrets: vi.fn(),
  getSecrets: vi.fn(),
}));

vi.mock('../../acceptBidStorage', () => ({
  storeAcceptBidSecrets: mockStoreAcceptBidSecrets,
  getAcceptBidSecrets: mockGetAcceptBidSecrets,
}));

vi.mock('../../crypto/walletSecret', () => ({
  deriveSecretFromWallet: mockDeriveSecretFromWallet,
}));

vi.mock('../../crypto', () => ({
  rng: mockRng,
  g1Point: mockG1Point,
  g2Point: vi.fn(() => 'g2_point'),
  scale: mockScale,
  combine: mockCombine,
  invertG2: vi.fn(() => 'inv_g2'),
  toInt: mockToInt,
  generate: vi.fn(() => 'hash_hex'),
  H0: 'H0_point',
  H1: 'H1_point',
  H2: 'H2_point',
  H2I_DOMAIN_TAG: 'h2i_tag',
  createPublicRegister: vi.fn((_g: string, _u: string) => ({ g: _g, u: _u, sk: 0n })),
  registerToPlutusJson: vi.fn(() => ({ constructor: 0, fields: ['reg'] })),
  bindingProof: vi.fn(() => ({ e: 'be', z1: 'bz1', z2: 'bz2' })),
  bindingToPlutusJson: vi.fn(() => ({ constructor: 0, fields: ['binding'] })),
  halfLevelToPlutusJson: vi.fn(() => ({ constructor: 0, fields: ['half'] })),
  fullLevelToPlutusJson: vi.fn(() => ({ constructor: 0, fields: ['full'] })),
  getStubWarning: () => 'stub warning',
}));

vi.mock('../../api', () => ({
  protocolApi: { getConfig: mockGetConfig },
}));

vi.mock('../../snark', () => ({
  getSnarkProver: vi.fn(() => ({
    gtToHash: mockGtToHash,
  })),
}));

vi.mock('../../metadata', () => ({
  buildEncryptionMetadata: vi.fn(() => ({ msg: ['test'] })),
}));

// ── Import after mocks ─────────────────────────────────────────────

import {
  acceptBidSnark,
  prepareSnarkInputs,
  completeReEncryption,
  acceptBidAndReEncrypt,
} from '../acceptBid';
import { createEncryption, createBid } from '../../../test/factories';

// ── Helpers ─────────────────────────────────────────────────────────

const fullConfig = {
  network: 'preprod',
  contracts: {
    encryptionAddress: 'addr_test1_encryption',
    encryptionPolicyId: 'aa'.repeat(28),
    biddingAddress: 'addr_test1_bidding',
    biddingPolicyId: 'bb'.repeat(28),
    grothPolicyId: 'cc'.repeat(28),
    referenceAddress: 'addr_test1_reference',
  },
  referenceScripts: {
    encryption: { txHash: 'ee'.repeat(32), outputIndex: 0 },
    bidding: { txHash: 'ff'.repeat(32), outputIndex: 0 },
    groth: { txHash: 'dd'.repeat(32), outputIndex: 0 },
  },
  genesisToken: {
    policyId: 'genesis_policy',
    tokenName: 'genesis_token',
  },
};

function makeUtxo(txHash: string, outputIndex: number, lovelace = '10000000') {
  return {
    input: { txHash, outputIndex },
    output: {
      address: 'addr_test1_user',
      amount: [{ unit: 'lovelace', quantity: lovelace }],
    },
  };
}

const collateralUtxo = makeUtxo('col'.padEnd(64, '0'), 0, '5000000');

function mockWallet() {
  return {
    getUtxos: vi.fn().mockResolvedValue([
      makeUtxo('aa'.repeat(32), 0),
      makeUtxo('bb'.repeat(32), 1),
    ]),
    getUsedAddresses: vi.fn().mockResolvedValue(['addr_test1_user']),
    getChangeAddress: vi.fn().mockResolvedValue('addr_test1_change'),
    getCollateral: vi.fn().mockResolvedValue([collateralUtxo]),
    signTx: vi.fn().mockResolvedValue('signed_tx_hex'),
    submitTx: vi.fn().mockResolvedValue('tx_hash_snark'),
  } as unknown as IWallet & {
    getUtxos: ReturnType<typeof vi.fn>;
    getUsedAddresses: ReturnType<typeof vi.fn>;
    getChangeAddress: ReturnType<typeof vi.fn>;
    getCollateral: ReturnType<typeof vi.fn>;
    signTx: ReturnType<typeof vi.fn>;
    submitTx: ReturnType<typeof vi.fn>;
  };
}

const testSnarkProof = {
  proofJson: JSON.stringify({
    piA: 'aa'.repeat(48),
    piB: 'bb'.repeat(96),
    piC: 'cc'.repeat(48),
    commitments: [],
    commitmentPok: '',
  }),
  publicJson: JSON.stringify({
    inputs: ['1', ...Array(36).fill('42')],
    commitmentWire: '12345',
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_USE_STUBS', '');
  mockGetConfig.mockResolvedValue(fullConfig);
  mockComplete.mockResolvedValue('unsigned_tx_hex');
  mockRng.mockReturnValueOnce(100n).mockReturnValueOnce(200n);
  // Mock fetchCurrentSlot — invoke('ogmios_fetch') returns JSON *string*
  mockInvoke.mockResolvedValue(JSON.stringify({ lastKnownTip: { slot: 1000 } }));
  // Default: return genesis UTxO for reference address, encryption UTxO for encryption address
  mockFetchAddressUTxOs.mockImplementation(async (address: string) => {
    if (address === fullConfig.contracts.referenceAddress) {
      return [{
        input: { txHash: 'g'.repeat(64), outputIndex: 0 },
        output: {
          address,
          amount: [
            { unit: 'lovelace', quantity: '2000000' },
            { unit: 'genesis_policygenesis_token', quantity: '1' },
          ],
        },
      }];
    }
    if (address === fullConfig.contracts.encryptionAddress) {
      // Return a UTxO with the encryption token — tokenName will vary per test,
      // so we return one with a wildcard-ish token. Tests that need specific tokens
      // should override this mock.
      return [{
        input: { txHash: 'e'.repeat(64), outputIndex: 0 },
        output: {
          address,
          amount: [
            { unit: 'lovelace', quantity: '5000000' },
          ],
        },
      }];
    }
    return [];
  });
});

// ── Tests ───────────────────────────────────────────────────────────

describe('prepareSnarkInputs', () => {
  it('generates a0, r0 and computes public inputs', async () => {
    const bid = createBid({ status: 'accepted' });

    const result = await prepareSnarkInputs(bid);

    expect(result.a0).toBe(100n);
    expect(result.r0).toBe(200n);
    expect(result.hk).toBe(99n); // toInt returns 99n
    expect(result.inputs.secretA).toBe('0x64'); // 100 in hex
    expect(result.inputs.secretR).toBe('0xc8'); // 200 in hex
    expect(result.inputs.publicV).toBe(bid.datum.owner_g1.public_value);
    expect(result.inputs.publicW0).toBe('g1_point');
    expect(result.inputs.publicW1).toBe('combined_point');
  });

  it('calls gtToHash with 0x-prefixed a0 hex', async () => {
    const bid = createBid();
    await prepareSnarkInputs(bid);

    expect(mockGtToHash).toHaveBeenCalledWith('0x64'); // 100n
  });

  it('computes W1 as combine(g1Point(a0), scale(V, r0))', async () => {
    const bid = createBid();
    await prepareSnarkInputs(bid);

    expect(mockG1Point).toHaveBeenCalledWith(100n);
    expect(mockScale).toHaveBeenCalledWith(bid.datum.owner_g1.public_value, 200n);
    expect(mockCombine).toHaveBeenCalledWith('g1_point', 'scaled_point');
  });
});

describe('acceptBidSnark', () => {
  it('returns error when config missing encryption policy ID', async () => {
    mockGetConfig.mockResolvedValue({
      contracts: { encryptionPolicyId: '' },
      referenceScripts: {},
    });

    const result = await acceptBidSnark(
      mockWallet(), createEncryption(), createBid(),
      testSnarkProof, 100n, 200n, 99n,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/encryption policy ID/);
  });

  it('returns error when config missing groth policy ID', async () => {
    mockGetConfig.mockResolvedValue({
      contracts: { encryptionPolicyId: 'aa'.repeat(28), grothPolicyId: '' },
      referenceScripts: { encryption: { txHash: 'x', outputIndex: 0 } },
    });

    const result = await acceptBidSnark(
      mockWallet(), createEncryption(), createBid(),
      testSnarkProof, 100n, 200n, 99n,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/groth policy ID/);
  });

  it('returns error when no UTxOs', async () => {
    const wallet = mockWallet();
    wallet.getUtxos.mockResolvedValue([]);

    const result = await acceptBidSnark(
      wallet, createEncryption(), createBid(),
      testSnarkProof, 100n, 200n, 99n,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No UTxOs/);
  });

  it('returns error when no collateral', async () => {
    const wallet = mockWallet();
    wallet.getCollateral.mockResolvedValue([]);

    const result = await acceptBidSnark(
      wallet, createEncryption(), createBid(),
      testSnarkProof, 100n, 200n, 99n,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/collateral/i);
  });

  it('returns error when genesis UTxO not found', async () => {
    mockFetchAddressUTxOs.mockResolvedValue([]);

    const result = await acceptBidSnark(
      mockWallet(), createEncryption(), createBid(),
      testSnarkProof, 100n, 200n, 99n,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Genesis token/);
  });

  it('accepts bid successfully and stores secrets', async () => {
    const enc = createEncryption();
    const bid = createBid({ status: 'accepted' });

    const result = await acceptBidSnark(
      mockWallet(), enc, bid,
      testSnarkProof, 100n, 200n, 99n,
    );

    expect(result.success).toBe(true);
    expect(result.txHash).toBe('tx_hash_snark');
    expect(mockStoreAcceptBidSecrets).toHaveBeenCalledWith(
      enc.tokenName, bid.tokenName, 100n, 200n, 99n,
      expect.any(Array), expect.any(Number), 'tx_hash_snark',
    );
    expect(mockTxBuilder.spendingPlutusScriptV3).toHaveBeenCalled();
    expect(mockTxBuilder.withdrawalPlutusScriptV3).toHaveBeenCalled();
  });

  it('calls onSubmitted with txHash', async () => {
    const onSubmitted = vi.fn();
    const enc = createEncryption();

    await acceptBidSnark(
      mockWallet(), enc, createBid(),
      testSnarkProof, 100n, 200n, 99n, onSubmitted,
    );

    expect(onSubmitted).toHaveBeenCalledWith('tx_hash_snark', enc.tokenName);
  });
});

describe('completeReEncryption', () => {
  it('returns error when config missing encryption policy ID', async () => {
    mockGetConfig.mockResolvedValue({
      contracts: { encryptionPolicyId: '' },
      referenceScripts: {},
    });

    const result = await completeReEncryption(
      mockWallet(), createEncryption(), createBid(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/encryption policy ID/);
  });

  it('returns error when accept-bid secrets not found', async () => {
    mockGetAcceptBidSecrets.mockResolvedValue(null);

    const result = await completeReEncryption(
      mockWallet(), createEncryption(), createBid(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/secrets not found/i);
  });

  it('returns error when no collateral', async () => {
    mockGetAcceptBidSecrets.mockResolvedValue({
      a0: 100n, r0: 200n, hk: 99n,
      publicInputs: [], ttl: Date.now() + 100000, snarkTxHash: 'tx',
    });
    const wallet = mockWallet();
    wallet.getCollateral.mockResolvedValue([]);

    const result = await completeReEncryption(wallet, createEncryption(), createBid());

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/collateral/i);
  });

  it('completes re-encryption successfully', async () => {
    mockGetAcceptBidSecrets.mockResolvedValue({
      a0: 100n, r0: 200n, hk: 99n,
      publicInputs: [], ttl: Date.now() + 100000, snarkTxHash: 'snark_tx',
    });

    const enc = createEncryption();
    const bid = createBid({ status: 'accepted' });
    const wallet = mockWallet();
    wallet.submitTx.mockResolvedValue('tx_hash_reencrypt');

    // Mock fetcher to return the encryption token UTxO
    const encPolicyId = fullConfig.contracts.encryptionPolicyId;
    mockFetchAddressUTxOs.mockImplementation(async (address: string) => {
      if (address === fullConfig.contracts.referenceAddress) {
        return [{
          input: { txHash: 'g'.repeat(64), outputIndex: 0 },
          output: {
            address,
            amount: [
              { unit: 'lovelace', quantity: '2000000' },
              { unit: 'genesis_policygenesis_token', quantity: '1' },
            ],
          },
        }];
      }
      if (address === fullConfig.contracts.encryptionAddress) {
        return [{
          input: { txHash: 'e'.repeat(64), outputIndex: 0 },
          output: {
            address,
            amount: [
              { unit: 'lovelace', quantity: '5000000' },
              { unit: encPolicyId + enc.tokenName, quantity: '1' },
            ],
          },
        }];
      }
      return [];
    });

    const result = await completeReEncryption(wallet, enc, bid);

    expect(result.success).toBe(true);
    expect(result.txHash).toBe('tx_hash_reencrypt');
    expect(mockTxBuilder.spendingPlutusScriptV3).toHaveBeenCalled();
    expect(mockTxBuilder.mint).toHaveBeenCalled();
  });
});

describe('acceptBidAndReEncrypt', () => {
  it('returns snark failure when snark tx fails', async () => {
    // Make config fail to trigger error in acceptBidSnark
    mockGetConfig.mockResolvedValue({
      contracts: { encryptionPolicyId: '' },
      referenceScripts: {},
    });

    const result = await acceptBidAndReEncrypt(
      mockWallet(), createEncryption(), createBid(),
      testSnarkProof, 100n, 200n, 99n,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/encryption policy ID/);
  });

  it('returns success with snarkTxHash when both succeed', async () => {
    const enc = createEncryption();
    mockGetAcceptBidSecrets.mockResolvedValue({
      a0: 100n, r0: 200n, hk: 99n,
      publicInputs: [], ttl: Date.now() + 100000, snarkTxHash: 'snark_tx',
    });
    const wallet = mockWallet();
    wallet.submitTx
      .mockResolvedValueOnce('tx_hash_snark') // snark tx
      .mockResolvedValueOnce('tx_hash_reencrypt'); // re-encrypt tx

    // Mock fetcher to return both genesis and encryption UTxOs
    const encPolicyId = fullConfig.contracts.encryptionPolicyId;
    mockFetchAddressUTxOs.mockImplementation(async (address: string) => {
      if (address === fullConfig.contracts.referenceAddress) {
        return [{
          input: { txHash: 'g'.repeat(64), outputIndex: 0 },
          output: {
            address,
            amount: [
              { unit: 'lovelace', quantity: '2000000' },
              { unit: 'genesis_policygenesis_token', quantity: '1' },
            ],
          },
        }];
      }
      if (address === fullConfig.contracts.encryptionAddress) {
        return [{
          input: { txHash: 'e'.repeat(64), outputIndex: 0 },
          output: {
            address,
            amount: [
              { unit: 'lovelace', quantity: '5000000' },
              { unit: encPolicyId + enc.tokenName, quantity: '1' },
            ],
          },
        }];
      }
      return [];
    });

    const steps: string[] = [];
    const result = await acceptBidAndReEncrypt(
      wallet, enc, createBid({ status: 'accepted' }),
      testSnarkProof, 100n, 200n, 99n,
      (step) => steps.push(step),
    );

    expect(result.success).toBe(true);
    expect(result.txHash).toBe('tx_hash_reencrypt');
    expect(result.snarkTxHash).toBe('tx_hash_snark');
    expect(steps).toContain('submitting-snark');
    expect(steps).toContain('complete');
  });

  it('returns partial success when re-encryption fails', async () => {
    // Make re-encryption fail (no accept-bid secrets)
    mockGetAcceptBidSecrets.mockResolvedValue(null);
    const wallet = mockWallet();
    wallet.submitTx.mockResolvedValue('tx_hash_snark');

    const steps: string[] = [];
    const result = await acceptBidAndReEncrypt(
      wallet, createEncryption(), createBid(),
      testSnarkProof, 100n, 200n, 99n,
      (step) => steps.push(step),
    );

    expect(result.success).toBe(true);
    expect(result.txHash).toBe('tx_hash_snark');
    expect(result.snarkTxHash).toBe('tx_hash_snark');
    expect(result.error).toContain('re-encryption failed');
    expect(steps).toContain('fallback');
  });

  it('handles re-encryption exception gracefully', async () => {
    // Make completeReEncryption throw
    mockGetAcceptBidSecrets.mockRejectedValue(new Error('storage error'));
    const wallet = mockWallet();
    wallet.submitTx.mockResolvedValue('tx_hash_snark');

    const result = await acceptBidAndReEncrypt(
      wallet, createEncryption(), createBid(),
      testSnarkProof, 100n, 200n, 99n,
    );

    expect(result.success).toBe(true);
    expect(result.snarkTxHash).toBe('tx_hash_snark');
    expect(result.error).toContain('re-encryption failed');
  });
});
