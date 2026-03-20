import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IWallet } from '@meshsdk/core';

// ── Hoisted mocks ──────────────────────────────────────────────
const {
  mockRng,
  mockG1Point,
  mockScale,
  mockCombine,
  mockToInt,
  mockGenerate,
  mockCreateRegister,
  mockSchnorrProof,
  mockBindingProof,
  mockEncrypt,
  mockGtToHash,
  mockDeriveSecretFromWallet,
} = vi.hoisted(() => ({
  mockRng: vi.fn(),
  mockG1Point: vi.fn(),
  mockScale: vi.fn(),
  mockCombine: vi.fn(),
  mockToInt: vi.fn(),
  mockGenerate: vi.fn(),
  mockCreateRegister: vi.fn(),
  mockSchnorrProof: vi.fn(),
  mockBindingProof: vi.fn(),
  mockEncrypt: vi.fn(),
  mockGtToHash: vi.fn(),
  mockDeriveSecretFromWallet: vi.fn(),
}));

vi.mock('../bls12381', () => ({
  rng: mockRng,
  g1Point: mockG1Point,
  scale: mockScale,
  combine: mockCombine,
  toInt: mockToInt,
  CURVE_ORDER: 52435875175126190479447740508185965837690552500527637822603658699938581184513n,
}));

vi.mock('../hashing', () => ({
  generate: mockGenerate,
}));

vi.mock('../constants', () => ({
  KEY_DOMAIN_TAG: 'TEST_KEY_TAG',
  H2I_DOMAIN_TAG: 'TEST_H2I_TAG',
  H1: 'H1_POINT',
  H2: 'H2_POINT',
  H3: 'H3_POINT',
}));

vi.mock('../register', () => ({
  createRegister: mockCreateRegister,
  registerToPlutusJson: vi.fn(() => ({ constructor: 0, fields: ['reg'] })),
}));

vi.mock('../schnorr', () => ({
  schnorrProof: mockSchnorrProof,
  schnorrToPlutusJson: vi.fn(() => ({ constructor: 0, fields: ['schnorr'] })),
}));

vi.mock('../binding', () => ({
  bindingProof: mockBindingProof,
  bindingToPlutusJson: vi.fn(() => ({ constructor: 0, fields: ['binding'] })),
}));

vi.mock('../ecies', () => ({
  encrypt: mockEncrypt,
  capsuleToPlutusJson: vi.fn(() => ({ constructor: 0, fields: ['capsule'] })),
}));

vi.mock('../level', () => ({
  halfLevelToPlutusJson: vi.fn(() => ({ constructor: 0, fields: ['half'] })),
  emptyFullLevelToPlutusJson: vi.fn(() => ({ constructor: 1, fields: [] })),
}));

vi.mock('../walletSecret', () => ({
  deriveSecretFromWallet: mockDeriveSecretFromWallet,
  getSigningExplanation: () => 'test explanation',
}));

vi.mock('../../snark', () => ({
  getSnarkProver: () => ({ gtToHash: mockGtToHash }),
}));

import {
  deriveUserSecret,
  createEncryptionArtifacts,
  createEncryptionWithWallet,
  isRealEncryptionAvailable,
  getStubWarning,
  getSigningExplanation,
} from '../createEncryption';

// ── Setup ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default mock returns
  mockRng.mockReturnValueOnce(100n).mockReturnValueOnce(200n); // a=100, r=200
  mockGtToHash.mockResolvedValue('aabb'.repeat(16)); // 64 hex chars
  mockGenerate.mockReturnValue('hashed_hex');
  mockToInt.mockReturnValue(42n);
  mockG1Point.mockReturnValue('g1_point');
  mockScale.mockReturnValue('scaled_point');
  mockCombine.mockReturnValue('combined_point');
  mockCreateRegister.mockReturnValue({ g: 'gen', u: 'pub', sk: 10n });
  mockSchnorrProof.mockReturnValue({ e: 'e_val', z: 'z_val' });
  mockBindingProof.mockReturnValue({ e: 'be', z1: 'bz1', z2: 'bz2' });
  mockEncrypt.mockResolvedValue({ nonce: 'n', aad: 'a', ct: 'c' });
});

// ── Tests ──────────────────────────────────────────────────────

describe('deriveUserSecret', () => {
  it('calls generate with KEY_DOMAIN_TAG + hex and converts to int', () => {
    mockGenerate.mockReturnValue('result_hash');
    mockToInt.mockReturnValue(999n);

    const result = deriveUserSecret('deadbeef');

    expect(mockGenerate).toHaveBeenCalledWith('TEST_KEY_TAGdeadbeef');
    expect(mockToInt).toHaveBeenCalledWith('result_hash');
    expect(result).toBe(999n);
  });
});

describe('createEncryptionArtifacts', () => {
  it('returns all expected artifact fields', async () => {
    const payload = new Uint8Array([1, 2, 3]);
    const result = await createEncryptionArtifacts('secret_hex', payload, 'tokenABC');

    expect(result.a).toBe(100n);
    expect(result.r).toBe(200n);
    expect(result.register).toBeDefined();
    expect(result.schnorr).toBeDefined();
    expect(result.binding).toBeDefined();
    expect(result.halfLevel).toBeDefined();
    expect(result.capsule).toBeDefined();
  });

  it('calls gtToHash with 0x-prefixed hex of a', async () => {
    const payload = new Uint8Array([]);
    await createEncryptionArtifacts('hex', payload, 'token');

    expect(mockGtToHash).toHaveBeenCalledWith('0x64'); // 100n = 0x64
  });

  it('derives user secret from walletSecretHex', async () => {
    const payload = new Uint8Array([]);
    await createEncryptionArtifacts('my_secret', payload, 'token');

    expect(mockGenerate).toHaveBeenCalledWith('TEST_KEY_TAGmy_secret');
  });

  it('computes half-level with r1, r2_g1, r4', async () => {
    const payload = new Uint8Array([]);
    const result = await createEncryptionArtifacts('hex', payload, 'token');

    expect(result.halfLevel).toEqual({
      r1: 'scaled_point',
      r2_g1: 'scaled_point',
      r4: 'scaled_point',
    });
  });

  it('encrypts payload with r1 and m0', async () => {
    const payload = new Uint8Array([10, 20]);
    await createEncryptionArtifacts('hex', payload, 'token');

    // encrypt(r1, m0, payload)
    expect(mockEncrypt).toHaveBeenCalledWith('scaled_point', 'aabb'.repeat(16), payload);
  });

  it('produces plutusJson with all six fields', async () => {
    const payload = new Uint8Array([]);
    const result = await createEncryptionArtifacts('hex', payload, 'token');

    expect(result.plutusJson.register).toBeDefined();
    expect(result.plutusJson.schnorr).toBeDefined();
    expect(result.plutusJson.binding).toBeDefined();
    expect(result.plutusJson.halfLevel).toBeDefined();
    expect(result.plutusJson.fullLevel).toBeDefined();
    expect(result.plutusJson.capsule).toBeDefined();
  });

  it('calls bindingProof with correct arguments', async () => {
    const payload = new Uint8Array([]);
    await createEncryptionArtifacts('hex', payload, 'myToken');

    expect(mockBindingProof).toHaveBeenCalledWith(
      100n, // a
      200n, // r
      'scaled_point', // r1
      'scaled_point', // r2_g1
      expect.objectContaining({ g: 'gen', u: 'pub' }), // register
      'myToken', // tokenName
    );
  });
});

describe('createEncryptionWithWallet', () => {
  it('derives secret from wallet and creates artifacts', async () => {
    mockDeriveSecretFromWallet.mockResolvedValue(555n);

    const wallet = {} as IWallet;
    const payload = new Uint8Array([1]);
    const result = await createEncryptionWithWallet(wallet, payload, 'token');

    expect(mockDeriveSecretFromWallet).toHaveBeenCalledWith(wallet);
    expect(result.a).toBe(100n);
    expect(result.r).toBe(200n);
    expect(result.register).toBeDefined();
    expect(result.plutusJson.register).toBeDefined();
  });

  it('propagates wallet derivation errors', async () => {
    mockDeriveSecretFromWallet.mockRejectedValue(new Error('Signature rejected'));

    const wallet = {} as IWallet;
    await expect(
      createEncryptionWithWallet(wallet, new Uint8Array([]), 'token'),
    ).rejects.toThrow('Signature rejected');
  });

  it('computes half-level and capsule correctly', async () => {
    mockDeriveSecretFromWallet.mockResolvedValue(42n);

    const wallet = {} as IWallet;
    const payload = new Uint8Array([5, 6, 7]);
    const result = await createEncryptionWithWallet(wallet, payload, 'token');

    expect(result.halfLevel.r1).toBeDefined();
    expect(result.halfLevel.r2_g1).toBeDefined();
    expect(result.halfLevel.r4).toBeDefined();
    expect(result.capsule).toEqual({ nonce: 'n', aad: 'a', ct: 'c' });
    expect(mockEncrypt).toHaveBeenCalled();
  });
});

describe('isRealEncryptionAvailable', () => {
  it('returns true (desktop always has native prover)', () => {
    expect(isRealEncryptionAvailable()).toBe(true);
  });
});

describe('getStubWarning', () => {
  it('returns WASM status message when available', () => {
    const msg = getStubWarning();
    expect(msg).toContain('WASM');
    expect(msg).toContain('BLS12-381');
  });
});

describe('getSigningExplanation (re-export)', () => {
  it('re-exports the signing explanation', () => {
    expect(getSigningExplanation()).toBe('test explanation');
  });
});
