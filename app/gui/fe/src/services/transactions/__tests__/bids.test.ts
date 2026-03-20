/**
 * Tests for bids.ts — place and cancel bid transactions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IWallet } from '@meshsdk/core';

// ── Hoisted mocks ──────────────────────────────────────────────────

const {
  mockComplete,
  mockTxBuilder,
  mockFetchAddressUTxOs,
  mockGetConfig,
  mockCreateBidArtifactsFromWallet,
  mockStoreBidSecrets,
  mockRemoveBidSecrets,
  mockInvoke,
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
    spendingPlutusScriptV3: vi.fn().mockReturnThis(),
    spendingTxInReference: vi.fn().mockReturnThis(),
    txInInlineDatumPresent: vi.fn().mockReturnThis(),
    txInRedeemerValue: vi.fn().mockReturnThis(),
    invalidBefore: vi.fn().mockReturnThis(),
    invalidHereafter: vi.fn().mockReturnThis(),
    txEvaluationMultiplier: 1.0,
  };
  return {
    mockComplete,
    mockTxBuilder,
    mockFetchAddressUTxOs: vi.fn(),
    mockGetConfig: vi.fn(),
    mockCreateBidArtifactsFromWallet: vi.fn(),
    mockStoreBidSecrets: vi.fn(),
    mockRemoveBidSecrets: vi.fn(),
    mockInvoke: vi.fn(),
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

vi.mock('../../providers', () => ({
  getKupoAdapter: () => ({ fetchAddressUTxOs: mockFetchAddressUTxOs }),
  getChainingAdapter: () => ({ fetchAddressUTxOs: mockFetchAddressUTxOs }),
  getOgmiosProvider: vi.fn(),
  getPendingTxPool: () => ({
    registerTx: vi.fn().mockResolvedValue(undefined),
    confirmTx: vi.fn(),
    invalidateChain: vi.fn(),
    clear: vi.fn(),
  }),
}));

vi.mock('../../bidSecretStorage', () => ({
  storeBidSecrets: mockStoreBidSecrets,
  removeBidSecrets: mockRemoveBidSecrets,
}));

vi.mock('../../crypto', () => ({
  createBidArtifactsFromWallet: mockCreateBidArtifactsFromWallet,
  getStubWarning: () => 'stub warning',
}));

vi.mock('../../api', () => ({
  protocolApi: { getConfig: mockGetConfig },
}));

vi.mock('../../metadata', () => ({
  buildBidMetadata: vi.fn(() => ({ msg: ['100'] })),
}));

// ── Import after mocks ─────────────────────────────────────────────

import { placeBid, cancelBid } from '../bids';

// ── Helpers ─────────────────────────────────────────────────────────

const fullConfig = {
  network: 'preprod',
  contracts: {
    biddingAddress: 'addr_test1_bidding',
    biddingPolicyId: 'bb'.repeat(28),
    referenceAddress: 'addr_test1_reference',
  },
  referenceScripts: {
    bidding: { txHash: 'ff'.repeat(32), outputIndex: 0 },
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
    submitTx: vi.fn().mockResolvedValue('tx_hash_bid'),
  } as unknown as IWallet;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_USE_STUBS', '');
  mockGetConfig.mockResolvedValue(fullConfig);
  mockComplete.mockResolvedValue('unsigned_tx_hex');
  mockCreateBidArtifactsFromWallet.mockResolvedValue({
    b: 42n,
    register: { g: 'gen', u: 'pub', sk: 42n },
    schnorr: { e: 'e', z: 'z' },
    plutusJson: {
      register: { constructor: 0, fields: ['reg'] },
      schnorr: { constructor: 0, fields: ['schnorr'] },
    },
  });
  // Mock fetchCurrentSlot — invoke('ogmios_fetch') returns JSON string
  mockInvoke.mockResolvedValue(JSON.stringify({ lastKnownTip: { slot: 1000 } }));
  // Default: return genesis UTxO for reference address
  mockFetchAddressUTxOs.mockResolvedValue([{
    input: { txHash: 'g'.repeat(64), outputIndex: 0 },
    output: {
      address: 'addr_test1_reference',
      amount: [
        { unit: 'lovelace', quantity: '2000000' },
        { unit: 'genesis_policygenesis_token', quantity: '1' },
      ],
    },
  }]);
});

// ── Tests ───────────────────────────────────────────────────────────

describe('placeBid', () => {
  it('returns error when config missing bidding address', async () => {
    mockGetConfig.mockResolvedValue({
      contracts: { biddingAddress: '' },
      referenceScripts: {},
    });

    const result = await placeBid(
      mockWallet(), 'enc_token', 50, { txHash: 'x'.repeat(64), outputIndex: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/bidding contract/i);
  });

  it('returns error when reference script not configured', async () => {
    mockGetConfig.mockResolvedValue({
      contracts: { biddingAddress: 'addr', biddingPolicyId: 'bb'.repeat(28) },
      referenceScripts: {},
    });

    const result = await placeBid(
      mockWallet(), 'enc_token', 50, { txHash: 'x'.repeat(64), outputIndex: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/reference script/i);
  });

  it('returns error when genesis token not configured', async () => {
    mockGetConfig.mockResolvedValue({
      contracts: { biddingAddress: 'addr', biddingPolicyId: 'bb'.repeat(28) },
      referenceScripts: { bidding: { txHash: 'x', outputIndex: 0 } },
    });

    const result = await placeBid(
      mockWallet(), 'enc_token', 50, { txHash: 'x'.repeat(64), outputIndex: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/genesis token/i);
  });

  it('returns error when no UTxOs', async () => {
    const wallet = mockWallet();
    wallet.getUtxos.mockResolvedValue([]);

    const result = await placeBid(
      wallet, 'enc_token', 50, { txHash: 'x'.repeat(64), outputIndex: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No UTxOs/);
  });

  it('returns error when no used addresses', async () => {
    const wallet = mockWallet();
    wallet.getUsedAddresses.mockResolvedValue([]);

    const result = await placeBid(
      wallet, 'enc_token', 50, { txHash: 'x'.repeat(64), outputIndex: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No used addresses/);
  });

  it('returns error when no collateral', async () => {
    const wallet = mockWallet();
    wallet.getCollateral.mockResolvedValue([]);

    const result = await placeBid(
      wallet, 'enc_token', 50, { txHash: 'x'.repeat(64), outputIndex: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/collateral/i);
  });

  it('returns error when all UTxOs are collateral', async () => {
    const wallet = mockWallet();
    wallet.getUtxos.mockResolvedValue([collateralUtxo]);

    const result = await placeBid(
      wallet, 'enc_token', 50, { txHash: 'x'.repeat(64), outputIndex: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/non-collateral/i);
  });

  it('returns error when genesis UTxO not found', async () => {
    mockFetchAddressUTxOs.mockResolvedValue([]);

    const result = await placeBid(
      mockWallet(), 'enc_token', 50, { txHash: 'x'.repeat(64), outputIndex: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Genesis token/);
  });

  it('places bid successfully', async () => {
    const encUtxo = { txHash: 'x'.repeat(64), outputIndex: 0 };

    const result = await placeBid(
      mockWallet(), 'enc_token', 50, encUtxo,
    );

    expect(result.success).toBe(true);
    expect(result.txHash).toBe('tx_hash_bid');
    expect(mockStoreBidSecrets).toHaveBeenCalled();
    expect(mockTxBuilder.mintPlutusScriptV3).toHaveBeenCalled();
    expect(mockTxBuilder.readOnlyTxInReference).toHaveBeenCalled();
  });

  it('calls onSubmitted with txHash', async () => {
    const onSubmitted = vi.fn();

    await placeBid(
      mockWallet(), 'enc_token', 50,
      { txHash: 'x'.repeat(64), outputIndex: 0 },
      undefined, onSubmitted,
    );

    expect(onSubmitted).toHaveBeenCalledWith('tx_hash_bid', expect.any(String));
  });
});

describe('cancelBid', () => {
  const bidData = {
    tokenName: 'bid_token_001',
    utxo: { txHash: 'dd'.repeat(32), outputIndex: 0 },
    datum: { owner_vkh: 'abc123', locked_until: Date.now() - 100000 }, // expired lock
  };

  it('returns error when config missing bidding policy', async () => {
    mockGetConfig.mockResolvedValue({
      contracts: { biddingPolicyId: '' },
      referenceScripts: {},
    });

    const result = await cancelBid(mockWallet(), bidData);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/bidding policy/i);
  });

  it('returns error when bid is still locked', async () => {
    const lockedBid = {
      ...bidData,
      datum: { ...bidData.datum, locked_until: Date.now() + 1000000 },
    };

    const result = await cancelBid(mockWallet(), lockedBid);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/locked until/i);
  });

  it('returns error when no UTxOs', async () => {
    const wallet = mockWallet();
    wallet.getUtxos.mockResolvedValue([]);

    const result = await cancelBid(wallet, bidData);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No UTxOs/);
  });

  it('returns error when no collateral', async () => {
    const wallet = mockWallet();
    wallet.getCollateral.mockResolvedValue(null);

    const result = await cancelBid(wallet, bidData);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/collateral/i);
  });

  it('cancels bid successfully', async () => {
    const result = await cancelBid(mockWallet(), bidData);

    expect(result.success).toBe(true);
    expect(result.txHash).toBe('tx_hash_bid');
    expect(mockTxBuilder.spendingPlutusScriptV3).toHaveBeenCalled();
    expect(mockTxBuilder.mint).toHaveBeenCalled();
    expect(mockRemoveBidSecrets).toHaveBeenCalledWith('bid_token_001');
  });

  it('succeeds even if removing bid secrets fails', async () => {
    mockRemoveBidSecrets.mockRejectedValue(new Error('storage error'));

    const result = await cancelBid(mockWallet(), bidData);
    expect(result.success).toBe(true);
  });

  it('calls onSubmitted with txHash', async () => {
    const onSubmitted = vi.fn();
    await cancelBid(mockWallet(), bidData, onSubmitted);
    expect(onSubmitted).toHaveBeenCalledWith('tx_hash_bid', 'bid_token_001');
  });
});
