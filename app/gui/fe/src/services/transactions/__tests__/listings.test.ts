/**
 * Tests for listings.ts — listing lifecycle transactions.
 *
 * Mocks all external dependencies (wallet, MeshTxBuilder, providers, crypto, storage)
 * to test the listing creation, removal, cancellation, and retry flows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IWallet } from '@meshsdk/core';
import type { CreateListingFormData } from '../../../components/CreateListingModal';
import type { EncryptionStatus } from '../../api';
import type { ListingDraft } from '../../listingDraftStorage';

// ── Hoisted mocks ──────────────────────────────────────────────────

const {
  mockComplete,
  mockTxBuilder,
  mockFetcher,
  mockGetConfig,
  mockCreateEncryptionWithWallet,
  mockStoreSecrets,
  mockInvoke,
  mockEncryptAndUpload,
  mockIagonListFiles,
  mockGetStoredApiKey,
  mockCreateListingDraft,
  mockUpdateListingDraft,
  mockCopyToLibrary,
  mockSaveContentMetadata,
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
    mockFetcher: { fetchAddressUTxOs: vi.fn() },
    mockGetConfig: vi.fn(),
    mockCreateEncryptionWithWallet: vi.fn(),
    mockStoreSecrets: vi.fn(),
    mockInvoke: vi.fn(),
    mockEncryptAndUpload: vi.fn(),
    mockIagonListFiles: vi.fn(),
    mockGetStoredApiKey: vi.fn(),
    mockCreateListingDraft: vi.fn(),
    mockUpdateListingDraft: vi.fn(),
    mockCopyToLibrary: vi.fn(),
    mockSaveContentMetadata: vi.fn(),
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
  getKupoAdapter: () => mockFetcher,
  getChainingAdapter: () => mockFetcher,
  getOgmiosProvider: vi.fn(),
  getPendingTxPool: () => ({
    registerTx: vi.fn().mockResolvedValue(undefined),
    confirmTx: vi.fn(),
    invalidateChain: vi.fn(),
    clear: vi.fn(),
  }),
}));

vi.mock('../../secretStorage', () => ({
  storeSecrets: mockStoreSecrets,
}));

vi.mock('../../crypto', () => ({
  createEncryptionWithWallet: mockCreateEncryptionWithWallet,
  getStubWarning: () => 'stub warning',
  registerToPlutusJson: vi.fn(() => ({ constructor: 0, fields: ['reg'] })),
  createPublicRegister: vi.fn((_g: string, _u: string) => ({ g: _g, u: _u, sk: 0n })),
  halfLevelToPlutusJson: vi.fn(() => ({ constructor: 0, fields: ['half'] })),
  fullLevelToPlutusJson: vi.fn(() => ({ constructor: 0, fields: ['full'] })),
}));

vi.mock('../../crypto/payload', () => ({
  buildPayload: vi.fn(() => new Uint8Array([1, 2, 3])),
}));

vi.mock('../../crypto/fileEncryption', () => ({
  encodeFileSecret: vi.fn(() => new Uint8Array(44)),
}));

vi.mock('../../crypto/bls12381', () => ({
  hexToBytes: vi.fn((hex: string) => new Uint8Array(hex.length / 2)),
}));

vi.mock('../../api', () => ({
  protocolApi: { getConfig: mockGetConfig },
}));

vi.mock('../../metadata', () => ({
  buildEncryptionMetadata: vi.fn(() => ({ msg: ['test'] })),
}));

vi.mock('../../iagonApi', () => ({
  encryptAndUpload: mockEncryptAndUpload,
  listFiles: mockIagonListFiles,
}));

vi.mock('../../iagonAuth', () => ({
  getStoredApiKey: mockGetStoredApiKey,
}));

vi.mock('../../listingDraftStorage', () => ({
  createListingDraft: mockCreateListingDraft,
  updateListingDraft: mockUpdateListingDraft,
}));

vi.mock('../../contentStorage', () => ({
  copyToLibrary: mockCopyToLibrary,
  saveContentMetadata: mockSaveContentMetadata,
}));

vi.mock('../../snark', () => ({
  getSnarkProver: vi.fn(),
}));

vi.mock('../../crypto/walletSecret', () => ({
  deriveSecretFromWallet: vi.fn(),
}));

// ── Import after mocks ─────────────────────────────────────────────

import {
  createListing,
  removeListing,
  cancelPendingListing,
  retryListingFromDraft,
  createListingFromImport,
} from '../listings';

import { createEncryption } from '../../../test/factories';

// ── Helpers ─────────────────────────────────────────────────────────

const mockConfig = {
  contracts: {
    encryptionAddress: 'addr_test1_encryption',
    encryptionPolicyId: 'aa'.repeat(28),
    biddingAddress: 'addr_test1_bidding',
    biddingPolicyId: 'bb'.repeat(28),
  },
  referenceScripts: {
    encryption: { txHash: 'cc'.repeat(32), outputIndex: 0 },
    bidding: { txHash: 'dd'.repeat(32), outputIndex: 0 },
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
    submitTx: vi.fn().mockResolvedValue('tx_hash_abc'),
  } as unknown as IWallet;
}

const mockArtifacts = {
  a: 100n,
  r: 200n,
  register: { g: 'gen', u: 'pub', sk: 42n },
  schnorr: { e: 'e', z: 'z' },
  binding: { e: 'be', z1: 'bz1', z2: 'bz2' },
  halfLevel: { r1: 'r1', r2_g1: 'r2', r4: 'r4' },
  capsule: { nonce: 'n', aad: 'a', ct: 'c' },
  plutusJson: {
    register: { constructor: 0, fields: ['reg'] },
    schnorr: { constructor: 0, fields: ['sch'] },
    binding: { constructor: 0, fields: ['bind'] },
    halfLevel: { constructor: 0, fields: ['half'] },
    fullLevel: { constructor: 1, fields: [] },
    capsule: { constructor: 0, fields: ['cap'] },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_USE_STUBS', '');
  mockGetConfig.mockResolvedValue(mockConfig);
  mockCreateEncryptionWithWallet.mockResolvedValue(mockArtifacts);
  mockComplete.mockResolvedValue('unsigned_tx_hex');
});

// ── Tests ───────────────────────────────────────────────────────────

describe('createListing', () => {
  describe('text listing', () => {
    it('creates a text listing successfully', async () => {
      const wallet = mockWallet();
      const formData = {
        description: 'My listing',
        secretMessage: 'secret data',
        category: 'text' as const,
        suggestedPrice: '5',
        imageLink: '',
      } as CreateListingFormData;

      const result = await createListing(wallet, formData);

      expect(result.success).toBe(true);
      expect(result.txHash).toBe('tx_hash_abc');
      expect(result.tokenName).toBeDefined();
      expect(mockStoreSecrets).toHaveBeenCalled();
      expect(mockTxBuilder.mintPlutusScriptV3).toHaveBeenCalled();
      expect(mockTxBuilder.mint).toHaveBeenCalledWith('1', mockConfig.contracts.encryptionPolicyId, expect.any(String));
    });

    it('returns error when no UTxOs', async () => {
      const wallet = mockWallet();
      wallet.getUtxos.mockResolvedValue([]);
      const formData = { category: 'text', secretMessage: 'x' } as CreateListingFormData;

      const result = await createListing(wallet, formData);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No UTxOs/);
    });

    it('returns error when no collateral', async () => {
      const wallet = mockWallet();
      wallet.getCollateral.mockResolvedValue([]);
      const formData = { category: 'text', secretMessage: 'x' } as CreateListingFormData;

      const result = await createListing(wallet, formData);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/collateral/i);
    });

    it('returns error when config missing encryption address', async () => {
      mockGetConfig.mockResolvedValue({
        contracts: { encryptionAddress: '', encryptionPolicyId: '' },
        referenceScripts: {},
      });
      const wallet = mockWallet();
      const formData = { category: 'text', secretMessage: 'x' } as CreateListingFormData;

      const result = await createListing(wallet, formData);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/config missing/i);
    });

    it('returns error when no used addresses', async () => {
      const wallet = mockWallet();
      wallet.getUsedAddresses.mockResolvedValue([]);
      const formData = { category: 'text', secretMessage: 'x' } as CreateListingFormData;

      const result = await createListing(wallet, formData);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No used addresses/);
    });

    it('calls progress callbacks', async () => {
      const wallet = mockWallet();
      const formData = { category: 'text', secretMessage: 'x', suggestedPrice: '0', imageLink: '' } as CreateListingFormData;
      const steps: string[] = [];

      await createListing(wallet, formData, (step) => steps.push(step));

      expect(steps).toContain('building');
      expect(steps).toContain('signing');
      expect(steps).toContain('submitting');
    });

    it('calls onSubmitted with txHash and tokenName', async () => {
      const wallet = mockWallet();
      const formData = { category: 'text', secretMessage: 'x', suggestedPrice: '0', imageLink: '' } as CreateListingFormData;
      const onSubmitted = vi.fn();

      await createListing(wallet, formData, undefined, onSubmitted);

      expect(onSubmitted).toHaveBeenCalledWith('tx_hash_abc', expect.any(String));
    });
  });

  describe('file listing', () => {
    it('returns error when no file path', async () => {
      const wallet = mockWallet();
      const formData = {
        category: 'document',
        secretMessage: '',
        filePath: undefined,
      } as CreateListingFormData;

      const result = await createListing(wallet, formData);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No file selected/);
    });

    it('returns error when Iagon not connected', async () => {
      mockGetStoredApiKey.mockResolvedValue(null);
      const wallet = mockWallet();
      const formData = {
        category: 'document',
        filePath: '/path/to/file.pdf',
        fileName: 'file.pdf',
        secretMessage: '',
      } as CreateListingFormData;

      const result = await createListing(wallet, formData);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Iagon is not connected/);
    });

    it('creates file listing with draft and upload', async () => {
      mockGetStoredApiKey.mockResolvedValue('api_key');
      mockEncryptAndUpload.mockResolvedValue({
        key_hex: 'aa'.repeat(32),
        nonce_hex: 'bb'.repeat(12),
        digest_hex: 'cc'.repeat(32),
        file_info: { _id: 'iagon_file_id' },
      });
      mockIagonListFiles.mockResolvedValue([{ _id: 'iagon_file_id' }]);

      const wallet = mockWallet();
      const formData = {
        category: 'document',
        filePath: '/path/to/file.pdf',
        fileName: 'file.pdf',
        fileSize: 1024,
        secretMessage: '',
        description: 'test doc',
        suggestedPrice: '10',
        imageLink: '',
      } as CreateListingFormData;

      const result = await createListing(wallet, formData);

      expect(result.success).toBe(true);
      expect(result.draftId).toBeDefined();
      expect(mockCreateListingDraft).toHaveBeenCalled();
      expect(mockUpdateListingDraft).toHaveBeenCalled();
      expect(mockEncryptAndUpload).toHaveBeenCalled();
    });

    it('copies file to library after successful listing', async () => {
      mockGetStoredApiKey.mockResolvedValue('api_key');
      mockEncryptAndUpload.mockResolvedValue({
        key_hex: 'aa'.repeat(32),
        nonce_hex: 'bb'.repeat(12),
        digest_hex: 'cc'.repeat(32),
        file_info: { _id: 'file_id' },
      });
      mockIagonListFiles.mockResolvedValue([{ _id: 'file_id' }]);

      const wallet = mockWallet();
      const formData = {
        category: 'audio',
        filePath: '/path/song.mp3',
        fileName: 'song.mp3',
        secretMessage: '',
        description: 'test',
        suggestedPrice: '5',
        imageLink: '',
      } as CreateListingFormData;

      await createListing(wallet, formData);

      expect(mockCopyToLibrary).toHaveBeenCalledWith(
        '/path/song.mp3',
        expect.any(String),
        'audio',
        '.mp3',
      );
      expect(mockSaveContentMetadata).toHaveBeenCalled();
    });

    it('updates draft to failed on upload verification failure', async () => {
      mockGetStoredApiKey.mockResolvedValue('api_key');
      mockEncryptAndUpload.mockResolvedValue({
        key_hex: 'aa'.repeat(32),
        nonce_hex: 'bb'.repeat(12),
        digest_hex: 'cc'.repeat(32),
        file_info: { _id: 'missing_id' },
      });
      // listFiles returns empty — verification fails
      mockIagonListFiles.mockResolvedValue([]);

      const wallet = mockWallet();
      const formData = {
        category: 'document',
        filePath: '/path/to/file.pdf',
        fileName: 'file.pdf',
        secretMessage: '',
      } as CreateListingFormData;

      const result = await createListing(wallet, formData);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/verification failed/i);
      expect(mockUpdateListingDraft).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'failed' }),
      );
    });
  });
});

describe('removeListing', () => {
  describe('real mode', () => {
    it('removes listing successfully', async () => {
      const wallet = mockWallet();
      const enc = {
        tokenName: 'aabb',
        utxo: { txHash: 'aa'.repeat(32), outputIndex: 0 },
        datum: { owner_vkh: 'dd'.repeat(28) },
      };

      const result = await removeListing(wallet, enc);

      expect(result.success).toBe(true);
      expect(result.txHash).toBe('tx_hash_abc');
      expect(mockTxBuilder.spendingPlutusScriptV3).toHaveBeenCalled();
      expect(mockTxBuilder.mint).toHaveBeenCalledWith('-1', mockConfig.contracts.encryptionPolicyId, 'aabb');
    });

    it('returns error when no UTxOs', async () => {
      const wallet = mockWallet();
      wallet.getUtxos.mockResolvedValue([]);
      const enc = {
        tokenName: 'aabb',
        utxo: { txHash: 'aa'.repeat(32), outputIndex: 0 },
        datum: { owner_vkh: 'dd'.repeat(28) },
      };

      const result = await removeListing(wallet, enc);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No UTxOs/);
    });

    it('returns error when config missing policy ID', async () => {
      mockGetConfig.mockResolvedValue({
        contracts: { encryptionPolicyId: '' },
        referenceScripts: {},
      });
      const wallet = mockWallet();
      const enc = {
        tokenName: 'aabb',
        utxo: { txHash: 'aa'.repeat(32), outputIndex: 0 },
        datum: { owner_vkh: 'dd'.repeat(28) },
      };

      const result = await removeListing(wallet, enc);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/policy ID/i);
    });

    it('calls onSubmitted callback', async () => {
      const wallet = mockWallet();
      const onSubmitted = vi.fn();
      const enc = {
        tokenName: 'aabb',
        utxo: { txHash: 'aa'.repeat(32), outputIndex: 0 },
        datum: { owner_vkh: 'dd'.repeat(28) },
      };

      await removeListing(wallet, enc, onSubmitted);

      expect(onSubmitted).toHaveBeenCalledWith('tx_hash_abc', 'aabb');
    });
  });
});

describe('cancelPendingListing', () => {
  const pendingEnc = createEncryption({
    status: { type: 'Pending' } as EncryptionStatus,
    description: 'Test desc',
    suggestedPrice: 10,
    storageLayer: 'ipfs',
    category: 'text',
  });

  describe('real mode', () => {
    it('cancels pending listing successfully', async () => {
      const result = await cancelPendingListing(mockWallet(), pendingEnc);

      expect(result.success).toBe(true);
      expect(result.txHash).toBe('tx_hash_abc');
      expect(mockTxBuilder.spendingPlutusScriptV3).toHaveBeenCalled();
      expect(mockTxBuilder.txOutInlineDatumValue).toHaveBeenCalled();
    });

    it('returns error when no collateral', async () => {
      const wallet = mockWallet();
      wallet.getCollateral.mockResolvedValue([]);

      const result = await cancelPendingListing(wallet, pendingEnc);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/collateral/i);
    });
  });
});

describe('retryListingFromDraft', () => {
  const baseDraft = {
    id: 'draft-123',
    iagonFileId: 'iagon_id',
    fileKey: 'aa'.repeat(32),
    fileNonce: 'bb'.repeat(12),
    fileDigest: 'cc'.repeat(32),
    fileExtension: '.pdf',
    category: 'document',
    description: 'test',
    suggestedPrice: '10',
    imageLink: '',
    retryCount: 0,
    status: 'failed' as const,
  } as ListingDraft;

  it('returns error when draft missing upload data', async () => {
    const incompleteDraft = { ...baseDraft, iagonFileId: undefined };
    const result = await retryListingFromDraft(mockWallet(), incompleteDraft);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing upload data/i);
  });

  it('retries listing from draft successfully', async () => {
    mockGetStoredApiKey.mockResolvedValue('api_key');
    mockIagonListFiles.mockResolvedValue([{ _id: 'iagon_id' }]);

    const result = await retryListingFromDraft(mockWallet(), baseDraft);

    expect(result.success).toBe(true);
    expect(result.txHash).toBe('tx_hash_abc');
    expect(result.draftId).toBe('draft-123');
    expect(mockUpdateListingDraft).toHaveBeenCalled();
  });

  it('returns error when file no longer on Iagon', async () => {
    mockGetStoredApiKey.mockResolvedValue('api_key');
    mockIagonListFiles.mockResolvedValue([]);

    const result = await retryListingFromDraft(mockWallet(), baseDraft);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no longer found on Iagon/i);
  });
});

describe('createListingFromImport', () => {
  const importData = {
    iagonFileId: 'iagon_123',
    aesKeyHex: 'aa'.repeat(32),
    gcmNonceHex: 'bb'.repeat(12),
    sha256DigestHex: 'cc'.repeat(32),
    fileExtension: '.pdf',
    description: 'imported doc',
    suggestedPrice: '15',
    imageLink: '',
    category: 'document' as const,
  };

  describe('real mode', () => {
    it('creates listing from import successfully', async () => {
      const result = await createListingFromImport(mockWallet(), importData);

      expect(result.success).toBe(true);
      expect(result.txHash).toBe('tx_hash_abc');
      expect(result.tokenName).toBeDefined();
      expect(mockStoreSecrets).toHaveBeenCalled();
      expect(mockTxBuilder.mintPlutusScriptV3).toHaveBeenCalled();
    });

    it('returns error when no UTxOs', async () => {
      const wallet = mockWallet();
      wallet.getUtxos.mockResolvedValue([]);

      const result = await createListingFromImport(wallet, importData);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No UTxOs/);
    });

    it('returns error when config missing', async () => {
      mockGetConfig.mockResolvedValue({
        contracts: { encryptionAddress: '', encryptionPolicyId: '' },
        referenceScripts: {},
      });

      const result = await createListingFromImport(mockWallet(), importData);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/config missing/i);
    });

    it('calls progress callbacks', async () => {
      const steps: string[] = [];
      await createListingFromImport(mockWallet(), importData, (step) => steps.push(step));

      expect(steps).toContain('building');
      expect(steps).toContain('signing');
      expect(steps).toContain('submitting');
    });
  });
});
