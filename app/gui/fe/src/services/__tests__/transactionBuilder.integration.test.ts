/**
 * Integration tests for transactionBuilder's createListing and placeBid.
 *
 * These mock external services (MeshTxBuilder, wallet, providers, crypto, storage)
 * and verify the tx builder is called with correct arguments: addresses, datums,
 * mint, metadata, etc.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (accessible inside vi.mock factories) ────────────

const {
  mockComplete,
  mockTxBuilder,
  mockFetcher,
  mockStoreBidSecrets,
  mockCreateBidArtifacts,
  mockGetConfig,
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
  };
  return {
    mockComplete,
    mockTxBuilder,
    mockFetcher: { fetchAddressUTxOs: vi.fn() },
    mockStoreBidSecrets: vi.fn(),
    mockCreateBidArtifacts: vi.fn(),
    mockGetConfig: vi.fn(),
  };
});

// ── Mock external dependencies ──────────────────────────────────────

vi.mock('@meshsdk/core', () => ({
  MeshTxBuilder: vi.fn(() => mockTxBuilder),
  deserializeAddress: vi.fn(() => ({
    pubKeyHash: 'abc123def456abc123def456abc123de',
  })),
}));

vi.mock('@meshsdk/provider', () => ({
  OgmiosProvider: vi.fn(),
}));

vi.mock('../providers', () => ({
  getKupoAdapter: () => mockFetcher,
  getOgmiosProvider: vi.fn(),
}));

vi.mock('../secretStorage', () => ({
  storeSecrets: vi.fn(),
}));

vi.mock('../bidSecretStorage', () => ({
  storeBidSecrets: mockStoreBidSecrets,
  removeBidSecrets: vi.fn(),
}));

vi.mock('../acceptBidStorage', () => ({
  storeAcceptBidSecrets: vi.fn(),
  getAcceptBidSecrets: vi.fn(),
}));

vi.mock('../crypto/walletSecret', () => ({
  deriveSecretFromWallet: vi.fn(),
}));

vi.mock('../crypto', () => ({
  createEncryptionWithWallet: vi.fn(),
  createBidArtifactsFromWallet: mockCreateBidArtifacts,
  getStubWarning: () => 'stub warning',
}));

vi.mock('../api', () => ({
  protocolApi: { getConfig: mockGetConfig },
}));

vi.mock('../snark', () => ({
  getSnarkProver: vi.fn(),
}));

vi.mock('../metadata', () => ({
  buildEncryptionMetadata: vi.fn(() => ({ msg: ['test'] })),
  buildBidMetadata: vi.fn((futurePrice: string) => ({ msg: [futurePrice || '0'] })),
}));

vi.mock('../crypto/fileEncryption', () => ({
  encryptFileForUpload: vi.fn(),
  encodeFileSecret: vi.fn(),
}));

vi.mock('../iagonApi', () => ({
  uploadFile: vi.fn(),
  listFiles: vi.fn(),
}));

vi.mock('../iagonAuth', () => ({
  getStoredApiKey: vi.fn(),
}));

vi.mock('../listingDraftStorage', () => ({
  createListingDraft: vi.fn(),
  updateListingDraft: vi.fn(),
}));

// ── Import after mocks ──────────────────────────────────────────────

import { placeBid, computeTokenName } from '../transactionBuilder';

// ── Test data ───────────────────────────────────────────────────────

const mockWallet = {
  getUtxos: vi.fn(),
  getUsedAddresses: vi.fn(),
  getChangeAddress: vi.fn(),
  getCollateral: vi.fn(),
  signTx: vi.fn(),
  submitTx: vi.fn(),
};

const protocolConfig = {
  contracts: {
    biddingAddress: 'addr_test1_bidding_contract',
    biddingPolicyId: 'bid_policy_id_hex',
    encryptionAddress: 'addr_test1_encryption',
    encryptionPolicyId: 'enc_policy_id_hex',
    referenceAddress: 'addr_test1_reference',
  },
  referenceScripts: {
    bidding: { txHash: 'ref_tx_bid', outputIndex: 0 },
    encryption: { txHash: 'ref_tx_enc', outputIndex: 0 },
  },
  genesisToken: {
    policyId: 'genesis_policy',
    tokenName: 'genesis_token',
  },
};

const testUtxo = {
  input: { txHash: 'a'.repeat(64), outputIndex: 0 },
  output: {
    address: 'addr_test1_wallet',
    amount: [{ unit: 'lovelace', quantity: '10000000' }],
  },
};

const collateralUtxo = {
  input: { txHash: 'c'.repeat(64), outputIndex: 0 },
  output: {
    address: 'addr_test1_wallet',
    amount: [{ unit: 'lovelace', quantity: '5000000' }],
  },
};

const genesisRefUtxo = {
  input: { txHash: 'g'.repeat(64), outputIndex: 0 },
  output: {
    address: 'addr_test1_reference',
    amount: [
      { unit: 'lovelace', quantity: '2000000' },
      { unit: 'genesis_policygenesis_token', quantity: '1' },
    ],
  },
};

const bidArtifacts = {
  b: 'bid_secret_scalar',
  plutusJson: {
    register: {
      constructor: 0,
      fields: [
        { bytes: 'generator_hex'.padEnd(96, '0') },
        { bytes: 'public_value_hex'.padEnd(96, '0') },
      ],
    },
    schnorr: {
      constructor: 0,
      fields: [
        { bytes: 'z_b_hex'.padEnd(64, '0') },
        { bytes: 'g_r_b_hex'.padEnd(96, '0') },
      ],
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();

  // Default mock return values
  mockGetConfig.mockResolvedValue(protocolConfig);
  mockWallet.getUtxos.mockResolvedValue([testUtxo]);
  mockWallet.getUsedAddresses.mockResolvedValue(['addr_test1_wallet']);
  mockWallet.getChangeAddress.mockResolvedValue('addr_test1_wallet');
  mockWallet.getCollateral.mockResolvedValue([collateralUtxo]);
  mockWallet.signTx.mockResolvedValue('signed_tx_hex');
  mockWallet.submitTx.mockResolvedValue('submitted_tx_hash_abc123');
  mockCreateBidArtifacts.mockResolvedValue(bidArtifacts);
  mockFetcher.fetchAddressUTxOs.mockResolvedValue([genesisRefUtxo]);

  // Reset tx builder chain
  Object.values(mockTxBuilder).forEach(fn => {
    if (typeof fn === 'function' && fn !== mockComplete) {
      fn.mockReturnThis();
    }
  });
  mockComplete.mockResolvedValue('unsigned_tx_hex');
});

describe('placeBid integration', () => {
  it('returns success with txHash and tokenName', async () => {
    const result = await placeBid(
      mockWallet as never,
      'encryption_token_name',
      50,
      { txHash: 'e'.repeat(64), outputIndex: 0 },
      { futurePrice: 60 },
    );

    expect(result.success).toBe(true);
    expect(result.txHash).toBe('submitted_tx_hash_abc123');
    expect(result.tokenName).toBeDefined();
  });

  it('stores bid secrets BEFORE submitting transaction', async () => {
    const callOrder: string[] = [];
    mockStoreBidSecrets.mockImplementation(async () => {
      callOrder.push('storeBidSecrets');
    });
    mockWallet.submitTx.mockImplementation(async () => {
      callOrder.push('submitTx');
      return 'tx_hash';
    });

    await placeBid(
      mockWallet as never,
      'enc_token',
      10,
      { txHash: 'e'.repeat(64), outputIndex: 0 },
    );

    expect(callOrder).toEqual(['storeBidSecrets', 'submitTx']);
  });

  it('computes bid token name from first wallet UTxO', async () => {
    const expectedTokenName = computeTokenName(testUtxo.input.txHash, testUtxo.input.outputIndex);

    const result = await placeBid(
      mockWallet as never,
      'enc_token',
      10,
      { txHash: 'e'.repeat(64), outputIndex: 0 },
    );

    expect(result.tokenName).toBe(expectedTokenName);
  });

  it('sends correct bid amount in lovelace to bidding address', async () => {
    await placeBid(
      mockWallet as never,
      'enc_token',
      50,
      { txHash: 'e'.repeat(64), outputIndex: 0 },
    );

    expect(mockTxBuilder.txOut).toHaveBeenCalledWith(
      'addr_test1_bidding_contract',
      expect.arrayContaining([
        { unit: 'lovelace', quantity: '50000000' },
      ]),
    );
  });

  it('includes bid token in output to bidding contract', async () => {
    const expectedTokenName = computeTokenName(testUtxo.input.txHash, testUtxo.input.outputIndex);

    await placeBid(
      mockWallet as never,
      'enc_token',
      10,
      { txHash: 'e'.repeat(64), outputIndex: 0 },
    );

    expect(mockTxBuilder.txOut).toHaveBeenCalledWith(
      'addr_test1_bidding_contract',
      expect.arrayContaining([
        { unit: 'bid_policy_id_hex' + expectedTokenName, quantity: '1' },
      ]),
    );
  });

  it('mints exactly +1 bid token using reference script', async () => {
    const expectedTokenName = computeTokenName(testUtxo.input.txHash, testUtxo.input.outputIndex);

    await placeBid(
      mockWallet as never,
      'enc_token',
      10,
      { txHash: 'e'.repeat(64), outputIndex: 0 },
    );

    expect(mockTxBuilder.mint).toHaveBeenCalledWith('1', 'bid_policy_id_hex', expectedTokenName);
    expect(mockTxBuilder.mintTxInReference).toHaveBeenCalledWith('ref_tx_bid', 0);
  });

  it('includes encryption UTxO as read-only reference', async () => {
    const encUtxo = { txHash: 'e'.repeat(64), outputIndex: 2 };

    await placeBid(
      mockWallet as never,
      'enc_token',
      10,
      encUtxo,
    );

    expect(mockTxBuilder.readOnlyTxInReference).toHaveBeenCalledWith(
      encUtxo.txHash,
      encUtxo.outputIndex,
    );
  });

  it('returns error when wallet has no UTxOs', async () => {
    mockWallet.getUtxos.mockResolvedValue([]);

    const result = await placeBid(
      mockWallet as never,
      'enc_token',
      10,
      { txHash: 'e'.repeat(64), outputIndex: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No UTxOs found/);
  });

  it('returns error when protocol config is incomplete', async () => {
    mockGetConfig.mockResolvedValue({
      ...protocolConfig,
      contracts: { ...protocolConfig.contracts, biddingAddress: '' },
    });

    const result = await placeBid(
      mockWallet as never,
      'enc_token',
      10,
      { txHash: 'e'.repeat(64), outputIndex: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing bidding/i);
  });

  it('returns error when no collateral is set', async () => {
    mockWallet.getCollateral.mockResolvedValue([]);

    const result = await placeBid(
      mockWallet as never,
      'enc_token',
      10,
      { txHash: 'e'.repeat(64), outputIndex: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No collateral/);
  });

  it('returns error when genesis token UTxO not found', async () => {
    mockFetcher.fetchAddressUTxOs.mockResolvedValue([]);

    const result = await placeBid(
      mockWallet as never,
      'enc_token',
      10,
      { txHash: 'e'.repeat(64), outputIndex: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Genesis token UTxO not found/);
  });

  it('sets inline datum with correct bid datum structure', async () => {
    await placeBid(
      mockWallet as never,
      'enc_token',
      10,
      { txHash: 'e'.repeat(64), outputIndex: 0 },
    );

    const datumCall = mockTxBuilder.txOutInlineDatumValue.mock.calls[0];
    const datum = datumCall[0];

    expect(datum.constructor).toBe(0);
    expect(datum.fields).toHaveLength(4);
    // Field 0: owner_vkh
    expect(datum.fields[0]).toHaveProperty('bytes');
    // Field 1: register (constructor 0 with 2 fields: generator, public_value)
    expect(datum.fields[1]).toEqual(bidArtifacts.plutusJson.register);
    // Field 2: pointer (bid token name)
    expect(datum.fields[2]).toHaveProperty('bytes');
    // Field 3: encryption token name
    expect(datum.fields[3].bytes).toBe('enc_token');
  });
});
