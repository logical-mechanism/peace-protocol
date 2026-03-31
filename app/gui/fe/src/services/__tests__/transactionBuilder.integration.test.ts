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
    // Plutus script spending chain methods
    spendingPlutusScriptV3: vi.fn().mockReturnThis(),
    spendingTxInReference: vi.fn().mockReturnThis(),
    txInInlineDatumPresent: vi.fn().mockReturnThis(),
    txInRedeemerValue: vi.fn().mockReturnThis(),
    invalidBefore: vi.fn().mockReturnThis(),
    invalidHereafter: vi.fn().mockReturnThis(),
    // Property set by createTxBuilder
    txEvaluationMultiplier: 1.0,
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

const { mockInvokeForTxBuilder } = vi.hoisted(() => ({
  mockInvokeForTxBuilder: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvokeForTxBuilder,
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

vi.mock('../providers', () => ({
  getKupoAdapter: () => mockFetcher,
  getChainingAdapter: () => mockFetcher,
  getOgmiosProvider: vi.fn(),
  getPendingTxPool: () => ({ registerTx: vi.fn().mockResolvedValue(undefined), confirmTx: vi.fn(), invalidateChain: vi.fn(), clear: vi.fn() }),
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
  encodeFileSecret: vi.fn(),
}));

vi.mock('../iagonApi', () => ({
  encryptAndUpload: vi.fn(),
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

import { placeBid, cancelBid, removeListing, computeTokenName } from '../transactionBuilder';

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

  // Mock invoke for Ogmios health endpoint (fetchCurrentSlot via Tauri IPC)
  mockInvokeForTxBuilder.mockResolvedValue(
    JSON.stringify({ lastKnownTip: { slot: 100_000 } })
  );

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
    expect(datum.fields).toHaveLength(6);
    // Field 0: owner_vkh
    expect(datum.fields[0]).toHaveProperty('bytes');
    // Field 1: register (constructor 0 with 2 fields: generator, public_value)
    expect(datum.fields[1]).toEqual(bidArtifacts.plutusJson.register);
    // Field 2: pointer (bid token name)
    expect(datum.fields[2]).toHaveProperty('bytes');
    // Field 3: encryption token name
    expect(datum.fields[3].bytes).toBe('enc_token');
    // Field 4: locked_until (POSIX ms)
    expect(datum.fields[4]).toHaveProperty('int');
  });
});

// ── cancelBid integration ──────────────────────────────────────────

describe('cancelBid integration', () => {
  const bidInput = {
    tokenName: 'bid_token_name_hex',
    utxo: { txHash: 'b'.repeat(64), outputIndex: 0 },
    datum: { owner_vkh: 'abc123def456abc123def456abc123de', locked_until: 0 },
  };

  it('returns success with txHash', async () => {
    const result = await cancelBid(mockWallet as never, bidInput);

    expect(result.success).toBe(true);
    expect(result.txHash).toBe('submitted_tx_hash_abc123');
  });

  it('burns the bid token (-1 mint)', async () => {
    await cancelBid(mockWallet as never, bidInput);

    expect(mockTxBuilder.mint).toHaveBeenCalledWith(
      '-1',
      'bid_policy_id_hex',
      bidInput.tokenName,
    );
  });

  it('spends the bid UTxO as input', async () => {
    await cancelBid(mockWallet as never, bidInput);

    expect(mockTxBuilder.txIn).toHaveBeenCalledWith(
      bidInput.utxo.txHash,
      bidInput.utxo.outputIndex,
    );
  });

  it('requires signer hash matching bid owner', async () => {
    await cancelBid(mockWallet as never, bidInput);

    expect(mockTxBuilder.requiredSignerHash).toHaveBeenCalledWith(
      bidInput.datum.owner_vkh,
    );
  });

  it('returns error when wallet has no UTxOs', async () => {
    mockWallet.getUtxos.mockResolvedValue([]);

    const result = await cancelBid(mockWallet as never, bidInput);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No UTxOs found/);
  });

  it('returns error when no collateral is set', async () => {
    mockWallet.getCollateral.mockResolvedValue([]);

    const result = await cancelBid(mockWallet as never, bidInput);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No collateral/);
  });
});

// ── removeListing integration ──────────────────────────────────────

describe('removeListing integration', () => {
  const encryptionInput = {
    tokenName: 'enc_token_name_hex',
    utxo: { txHash: 'e'.repeat(64), outputIndex: 1 },
    datum: { owner_vkh: 'abc123def456abc123def456abc123de' },
  };

  it('returns success with txHash and tokenName', async () => {
    const result = await removeListing(mockWallet as never, encryptionInput);

    expect(result.success).toBe(true);
    expect(result.txHash).toBe('submitted_tx_hash_abc123');
    expect(result.tokenName).toBe(encryptionInput.tokenName);
  });

  it('burns the encryption token (-1 mint)', async () => {
    await removeListing(mockWallet as never, encryptionInput);

    expect(mockTxBuilder.mint).toHaveBeenCalledWith(
      '-1',
      'enc_policy_id_hex',
      encryptionInput.tokenName,
    );
  });

  it('spends the encryption UTxO as input', async () => {
    await removeListing(mockWallet as never, encryptionInput);

    expect(mockTxBuilder.txIn).toHaveBeenCalledWith(
      encryptionInput.utxo.txHash,
      encryptionInput.utxo.outputIndex,
    );
  });

  it('requires signer hash matching encryption owner', async () => {
    await removeListing(mockWallet as never, encryptionInput);

    expect(mockTxBuilder.requiredSignerHash).toHaveBeenCalledWith(
      encryptionInput.datum.owner_vkh,
    );
  });

  it('returns error when wallet has no UTxOs', async () => {
    mockWallet.getUtxos.mockResolvedValue([]);

    const result = await removeListing(mockWallet as never, encryptionInput);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No UTxOs found/);
  });

  it('returns error when protocol config missing encryption policy', async () => {
    mockGetConfig.mockResolvedValue({
      ...protocolConfig,
      contracts: { ...protocolConfig.contracts, encryptionPolicyId: '' },
    });

    const result = await removeListing(mockWallet as never, encryptionInput);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing encryption/i);
  });
});

// ── Cross-flow: listing → bid → cancel bid lifecycle ───────────────

describe('listing + bid lifecycle', () => {
  it('bid token name is deterministic from wallet UTxO', () => {
    // The same UTxO always produces the same token name
    const name1 = computeTokenName(testUtxo.input.txHash, testUtxo.input.outputIndex);
    const name2 = computeTokenName(testUtxo.input.txHash, testUtxo.input.outputIndex);
    expect(name1).toBe(name2);
  });

  it('different UTxOs produce different token names', () => {
    const name1 = computeTokenName(testUtxo.input.txHash, 0);
    const name2 = computeTokenName(testUtxo.input.txHash, 1);
    expect(name1).not.toBe(name2);
  });

  it('placeBid then cancelBid uses same policy ID', async () => {
    // Place a bid
    await placeBid(
      mockWallet as never,
      'enc_token',
      10,
      { txHash: 'e'.repeat(64), outputIndex: 0 },
    );

    const placeMintCall = mockTxBuilder.mint.mock.calls[0];
    expect(placeMintCall[0]).toBe('1'); // +1 mint
    const policyUsedForPlace = placeMintCall[1];

    vi.clearAllMocks();
    // Reset mocks for cancel
    mockGetConfig.mockResolvedValue(protocolConfig);
    mockWallet.getUtxos.mockResolvedValue([testUtxo]);
    mockWallet.getUsedAddresses.mockResolvedValue(['addr_test1_wallet']);
    mockWallet.getChangeAddress.mockResolvedValue('addr_test1_wallet');
    mockWallet.getCollateral.mockResolvedValue([collateralUtxo]);
    mockWallet.signTx.mockResolvedValue('signed_tx_hex');
    mockWallet.submitTx.mockResolvedValue('cancel_tx_hash');
    mockFetcher.fetchAddressUTxOs.mockResolvedValue([genesisRefUtxo]);
    Object.values(mockTxBuilder).forEach(fn => {
      if (typeof fn === 'function' && fn !== mockComplete) {
        fn.mockReturnThis();
      }
    });
    mockComplete.mockResolvedValue('unsigned_tx_hex');

    // Cancel the bid
    const bidTokenName = computeTokenName(testUtxo.input.txHash, 0);
    await cancelBid(mockWallet as never, {
      tokenName: bidTokenName,
      utxo: { txHash: 'f'.repeat(64), outputIndex: 0 },
      datum: { owner_vkh: 'abc123def456abc123def456abc123de', locked_until: 0 },
    });

    const cancelMintCall = mockTxBuilder.mint.mock.calls[0];
    expect(cancelMintCall[0]).toBe('-1'); // -1 burn
    const policyUsedForCancel = cancelMintCall[1];

    // Same policy ID for minting and burning
    expect(policyUsedForCancel).toBe(policyUsedForPlace);
  });

  it('transaction builder error propagates as result.error', async () => {
    mockComplete.mockRejectedValue(new Error('Insufficient funds'));

    const result = await placeBid(
      mockWallet as never,
      'enc_token',
      10,
      { txHash: 'e'.repeat(64), outputIndex: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Insufficient funds/);
  });

  it('wallet submitTx error propagates as result.error', async () => {
    mockWallet.submitTx.mockRejectedValue(new Error('Submit failed: UTxO already spent'));

    const result = await placeBid(
      mockWallet as never,
      'enc_token',
      10,
      { txHash: 'e'.repeat(64), outputIndex: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Submit failed/);
  });
});
