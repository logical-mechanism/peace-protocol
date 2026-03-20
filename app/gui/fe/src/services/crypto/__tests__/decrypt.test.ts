import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────
const {
  mockEciesDecrypt,
  mockParsePayload,
  mockDecryptToHash,
  mockDeriveSecretFromWallet,
  mockDecodeFileSecret,
  mockDownloadAndSave,
  mockGetStoredApiKey,
  mockGetLevels,
  mockG2Point,
  mockScale,
} = vi.hoisted(() => ({
  mockEciesDecrypt: vi.fn(),
  mockParsePayload: vi.fn(),
  mockDecryptToHash: vi.fn().mockResolvedValue('aa'.repeat(32)),
  mockDeriveSecretFromWallet: vi.fn().mockResolvedValue(42n),
  mockDecodeFileSecret: vi.fn(),
  mockDownloadAndSave: vi.fn(),
  mockGetStoredApiKey: vi.fn(),
  mockGetLevels: vi.fn(),
  mockG2Point: vi.fn(() => 'mock_g2_point'),
  mockScale: vi.fn(() => 'mock_scaled_point'),
}));

vi.mock('../ecies', () => ({
  decrypt: mockEciesDecrypt,
}));

vi.mock('../payload', () => ({
  parsePayload: mockParsePayload,
}));

vi.mock('../bls12381', () => ({
  bytesToHex: vi.fn((b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')),
  g2Point: mockG2Point,
  scale: mockScale,
}));

vi.mock('../constants', () => ({
  H0: 'mock_H0',
}));

vi.mock('../../snark', () => ({
  getSnarkProver: vi.fn(() => ({
    decryptToHash: mockDecryptToHash,
  })),
}));

vi.mock('../walletSecret', () => ({
  deriveSecretFromWallet: mockDeriveSecretFromWallet,
}));

vi.mock('../fileEncryption', () => ({
  decryptDownloadedFile: vi.fn(),
  decodeFileSecret: mockDecodeFileSecret,
  verifyFileDigest: vi.fn(),
}));

vi.mock('../../iagonApi', () => ({
  downloadFile: vi.fn(),
  downloadAndSave: mockDownloadAndSave,
}));

vi.mock('../../iagonAuth', () => ({
  getStoredApiKey: mockGetStoredApiKey,
}));

vi.mock('../../api', () => ({
  encryptionsApi: {
    getLevels: mockGetLevels,
  },
}));

import {
  isWasmDecryptAvailable,
  isStubMode,
  fetchEncryptionHistory,
  canDecrypt,
  decryptBid,
  decryptEncryption,
  computeKEM,
  getDecryptionExplanation,
} from '../decrypt';
import { createBid, createEncryption } from '../../../test/factories';

// ── Helpers ─────────────────────────────────────────────────────────

const acceptedBid = createBid({ status: 'accepted' });
const pendingBid = createBid({ status: 'pending' });
const encryption = createEncryption();

const mockWallet = {
  signData: vi.fn(),
  getUsedAddresses: vi.fn().mockResolvedValue(['addr_test1qz...']),
} as unknown as import('@meshsdk/core').IWallet;

beforeEach(() => {
  vi.clearAllMocks();
  // Reset env var for each test
  vi.stubEnv('VITE_USE_STUBS', '');
});

// ── Tests ───────────────────────────────────────────────────────────

describe('isWasmDecryptAvailable', () => {
  it('always returns true in desktop app', () => {
    expect(isWasmDecryptAvailable()).toBe(true);
  });
});

describe('isStubMode', () => {
  it('returns false when env var is not set', () => {
    vi.stubEnv('VITE_USE_STUBS', '');
    expect(isStubMode()).toBe(false);
  });

  it('returns false when env var is something other than true', () => {
    vi.stubEnv('VITE_USE_STUBS', 'false');
    expect(isStubMode()).toBe(false);
  });

  it('returns true when VITE_USE_STUBS is "true"', () => {
    vi.stubEnv('VITE_USE_STUBS', 'true');
    expect(isStubMode()).toBe(true);
  });
});

describe('fetchEncryptionHistory', () => {
  it('returns null in real mode', async () => {
    vi.stubEnv('VITE_USE_STUBS', '');
    const result = await fetchEncryptionHistory('sometoken');
    expect(result).toBeNull();
  });

  it('returns mock history data in stub mode', async () => {
    vi.stubEnv('VITE_USE_STUBS', 'true');
    const result = await fetchEncryptionHistory('sometoken');
    expect(result).not.toBeNull();
    expect(result!.tokenName).toBe('sometoken');
    expect(result!.levels).toHaveLength(1);
    expect(result!.levels[0].r1).toBeDefined();
    expect(result!.levels[0].r2_g1).toBeDefined();
    expect(result!.capsule.nonce).toBeDefined();
    expect(result!.capsule.aad).toBeDefined();
    expect(result!.capsule.ct).toBeDefined();
  });
});

describe('canDecrypt', () => {
  it('rejects non-accepted bids', async () => {
    const result = await canDecrypt(pendingBid);
    expect(result.canDecrypt).toBe(false);
    expect(result.reason).toMatch(/Only accepted bids/);
  });

  it('allows accepted bids in stub mode', async () => {
    vi.stubEnv('VITE_USE_STUBS', 'true');
    const result = await canDecrypt(acceptedBid);
    expect(result.canDecrypt).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('allows accepted bids in real mode when WASM is available', async () => {
    vi.stubEnv('VITE_USE_STUBS', '');
    const result = await canDecrypt(acceptedBid);
    // isWasmDecryptAvailable() always returns true
    expect(result.canDecrypt).toBe(true);
  });

  it('rejects cancelled bids', async () => {
    const cancelled = createBid({ status: 'cancelled' });
    const result = await canDecrypt(cancelled);
    expect(result.canDecrypt).toBe(false);
    expect(result.reason).toMatch(/Only accepted bids/);
  });
});

describe('decryptBid', () => {
  it('rejects non-accepted bids without calling decrypt', async () => {
    const result = await decryptBid(mockWallet, pendingBid, encryption);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Only accepted bids/);
  });

  it('uses stub decryption in stub mode with known token', async () => {
    vi.stubEnv('VITE_USE_STUBS', 'true');
    const knownToken = '00abc123def456789012345678901234567890123456789012345678901234';
    const bid = createBid({ status: 'accepted', encryptionToken: knownToken });

    const result = await decryptBid(mockWallet, bid, encryption);
    expect(result.success).toBe(true);
    expect(result.isStub).toBe(true);
    expect(result.message).toContain('Premium API Keys');
    expect(result.rawContent).toBeDefined();
    expect(result.rawContent!.length).toBeGreaterThan(0);
  });

  it('uses stub fallback for unknown token', async () => {
    vi.stubEnv('VITE_USE_STUBS', 'true');
    const bid = createBid({ status: 'accepted', encryptionToken: 'unknown_token' });
    const enc = createEncryption({ description: 'My test listing' });

    const result = await decryptBid(mockWallet, bid, enc);
    expect(result.success).toBe(true);
    expect(result.isStub).toBe(true);
    expect(result.message).toContain('[Stub Mode]');
    expect(result.message).toContain('My test listing');
  });

  it('reports progress during stub decryption', async () => {
    vi.stubEnv('VITE_USE_STUBS', 'true');
    const progressCalls: [number, number][] = [];
    const onProgress = (current: number, total: number) => {
      progressCalls.push([current, total]);
    };

    const bid = createBid({ status: 'accepted' });
    await decryptBid(mockWallet, bid, encryption, onProgress);

    // Stub mode simulates 5 fake levels
    expect(progressCalls.length).toBe(6); // 0/5, 1/5, 2/5, 3/5, 4/5, 5/5
    expect(progressCalls[0]).toEqual([0, 5]);
    expect(progressCalls[progressCalls.length - 1]).toEqual([5, 5]);
  });
});

describe('getDecryptionExplanation', () => {
  it('returns stub explanation in stub mode', () => {
    vi.stubEnv('VITE_USE_STUBS', 'true');
    const explanation = getDecryptionExplanation();
    expect(explanation).toContain('development mode');
    expect(explanation).toContain('simulated data');
  });

  it('returns real explanation with WASM status in real mode', () => {
    vi.stubEnv('VITE_USE_STUBS', '');
    const explanation = getDecryptionExplanation();
    expect(explanation).toContain('zero-knowledge cryptography');
    expect(explanation).toContain('BLS12-381');
    expect(explanation).toContain('WASM cryptography loaded and ready');
  });

  it('includes step-by-step description in real mode', () => {
    vi.stubEnv('VITE_USE_STUBS', '');
    const explanation = getDecryptionExplanation();
    expect(explanation).toContain('wallet signature');
    expect(explanation).toContain('blockchain history');
    expect(explanation).toContain('pairing operations');
    expect(explanation).toContain('decrypted locally');
  });
});

// ── computeKEM ──────────────────────────────────────────────────────

describe('computeKEM', () => {
  it('returns null for empty levels', async () => {
    const result = await computeKEM(42n, []);
    expect(result).toBeNull();
  });

  it('processes a single half-level', async () => {
    mockDecryptToHash.mockResolvedValue('bb'.repeat(32));

    const levels = [{ r1: 'r1_hex', r2_g1: 'r2_g1_hex' }];
    const result = await computeKEM(42n, levels);

    expect(result).toBe('bb'.repeat(32));
    expect(mockScale).toHaveBeenCalledWith('mock_H0', 42n); // shared = [b]H0
    expect(mockDecryptToHash).toHaveBeenCalledWith('r2_g1_hex', 'r1_hex', 'mock_scaled_point', '');
  });

  it('processes a single full-level with r2_g2', async () => {
    mockDecryptToHash.mockResolvedValue('cc'.repeat(32));

    const levels = [{ r1: 'r1_hex', r2_g1: 'r2_g1_hex', r2_g2: 'r2_g2_hex' }];
    const result = await computeKEM(10n, levels);

    expect(result).toBe('cc'.repeat(32));
    expect(mockDecryptToHash).toHaveBeenCalledWith('r2_g1_hex', 'r1_hex', 'mock_scaled_point', 'r2_g2_hex');
  });

  it('processes multiple levels with shared point update', async () => {
    mockDecryptToHash
      .mockResolvedValueOnce('dd'.repeat(32))
      .mockResolvedValueOnce('ee'.repeat(32));

    const levels = [
      { r1: 'r1_a', r2_g1: 'r2_a' },
      { r1: 'r1_b', r2_g1: 'r2_b' },
    ];

    const result = await computeKEM(5n, levels);

    expect(result).toBe('ee'.repeat(32));
    // After first level, shared = g2Point(hash_scalar)
    expect(mockG2Point).toHaveBeenCalledWith(BigInt('0x' + 'dd'.repeat(32)));
    expect(mockDecryptToHash).toHaveBeenCalledTimes(2);
  });

  it('reports progress', async () => {
    mockDecryptToHash.mockResolvedValue('ff'.repeat(32));
    const progress: [number, number][] = [];

    await computeKEM(1n, [{ r1: 'r1', r2_g1: 'r2' }], (c, t) => progress.push([c, t]));

    expect(progress).toEqual([[0, 1], [1, 1]]);
  });

  it('returns null on decryptToHash error', async () => {
    mockDecryptToHash.mockRejectedValue(new Error('pairing failed'));

    const result = await computeKEM(1n, [{ r1: 'r1', r2_g1: 'r2' }]);
    expect(result).toBeNull();
  });
});

// ── decryptBid (real mode) ──────────────────────────────────────────

describe('decryptBid (real mode)', () => {
  it('returns error when wallet signing fails', async () => {
    vi.stubEnv('VITE_USE_STUBS', '');
    mockDeriveSecretFromWallet.mockRejectedValue(new Error('User rejected'));

    const bid = createBid({ status: 'accepted' });
    const result = await decryptBid(mockWallet, bid, encryption);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to derive secret');
  });

  it('returns error when encryption history not available', async () => {
    vi.stubEnv('VITE_USE_STUBS', '');
    mockDeriveSecretFromWallet.mockResolvedValue(42n);

    const bid = createBid({ status: 'accepted' });
    const result = await decryptBid(mockWallet, bid, encryption);

    // fetchEncryptionHistory returns null in real mode (no Koios)
    expect(result.success).toBe(false);
    expect(result.error).toContain('encryption history');
  });
});

// ── decryptEncryption ───────────────────────────────────────────────

describe('decryptEncryption', () => {
  const testEncryption = createEncryption();

  it('returns error when wallet signing fails', async () => {
    mockDeriveSecretFromWallet.mockRejectedValue(new Error('User rejected'));

    const result = await decryptEncryption(mockWallet, testEncryption);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to derive secret');
  });

  it('returns error when getLevels fails', async () => {
    mockDeriveSecretFromWallet.mockResolvedValue(42n);
    mockGetLevels.mockRejectedValue(new Error('Network error'));

    const result = await decryptEncryption(mockWallet, testEncryption);

    expect(result.success).toBe(false);
    expect(result.error).toContain('fetch encryption history');
  });

  it('returns error when no levels found', async () => {
    mockDeriveSecretFromWallet.mockResolvedValue(42n);
    mockGetLevels.mockResolvedValue([]);

    const result = await decryptEncryption(mockWallet, testEncryption);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No encryption levels');
  });

  it('returns error when KEM length mismatches', async () => {
    mockDeriveSecretFromWallet.mockResolvedValue(42n);
    mockGetLevels.mockResolvedValue([{ r1: 'r1', r2_g1: 'r2' }]);
    mockDecryptToHash.mockResolvedValue('aa'.repeat(28)); // 56 chars, not 64

    const result = await decryptEncryption(mockWallet, testEncryption);

    expect(result.success).toBe(false);
    expect(result.error).toContain('KEM length mismatch');
    expect(result.error).toContain('56');
  });

  it('returns error when KEM is null', async () => {
    mockDeriveSecretFromWallet.mockResolvedValue(42n);
    mockGetLevels.mockResolvedValue([{ r1: 'r1', r2_g1: 'r2' }]);
    mockDecryptToHash.mockRejectedValue(new Error('pairing failed'));

    const result = await decryptEncryption(mockWallet, testEncryption);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to compute decryption key');
  });

  it('decrypts successfully with valid KEM and raw text payload', async () => {
    mockDeriveSecretFromWallet.mockResolvedValue(42n);
    mockGetLevels.mockResolvedValue([{ r1: 'r1_hex', r2_g1: 'r2_hex' }]);
    mockDecryptToHash.mockResolvedValue('aa'.repeat(32)); // 64 hex chars
    const decryptedBytes = new TextEncoder().encode('Hello secret!');
    mockEciesDecrypt.mockResolvedValue(decryptedBytes);
    // parsePayload throws → falls back to raw text
    mockParsePayload.mockImplementation(() => { throw new Error('not CBOR'); });

    const result = await decryptEncryption(mockWallet, testEncryption);

    expect(result.success).toBe(true);
    expect(result.isStub).toBe(false);
    expect(result.message).toBe('Hello secret!');
    expect(result.rawContent).toEqual(decryptedBytes);
  });

  it('decrypts successfully with CBOR payload (on-chain text)', async () => {
    mockDeriveSecretFromWallet.mockResolvedValue(42n);
    mockGetLevels.mockResolvedValue([{ r1: 'r1', r2_g1: 'r2' }]);
    mockDecryptToHash.mockResolvedValue('aa'.repeat(32));
    const raw = new Uint8Array([1, 2, 3]);
    mockEciesDecrypt.mockResolvedValue(raw);

    const payloadMap = new Map<number, Uint8Array>();
    payloadMap.set(0, new TextEncoder().encode('Decoded message'));
    mockParsePayload.mockReturnValue(payloadMap);

    const result = await decryptEncryption(mockWallet, testEncryption);

    expect(result.success).toBe(true);
    expect(result.message).toBe('Decoded message');
    expect(result.payload).toBe(payloadMap);
  });

  it('handles Iagon payload for file-based encryption', async () => {
    mockDeriveSecretFromWallet.mockResolvedValue(42n);
    mockGetLevels.mockResolvedValue([{ r1: 'r1', r2_g1: 'r2' }]);
    mockDecryptToHash.mockResolvedValue('aa'.repeat(32));
    mockEciesDecrypt.mockResolvedValue(new Uint8Array([1]));

    const payloadMap = new Map<number, Uint8Array>();
    payloadMap.set(0, new TextEncoder().encode('iagon_file_id'));
    payloadMap.set(1, new Uint8Array(44)); // key + nonce
    payloadMap.set(2, new Uint8Array(32)); // digest
    payloadMap.set(3, new TextEncoder().encode('.pdf'));
    mockParsePayload.mockReturnValue(payloadMap);

    mockDecodeFileSecret.mockReturnValue({
      key: new Uint8Array(32),
      nonce: new Uint8Array(12),
    });
    mockGetStoredApiKey.mockResolvedValue('api_key_123');
    mockDownloadAndSave.mockResolvedValue({ path: '/saved/file.pdf', size: 1024 });

    const enc = createEncryption({ storageLayer: 'iagon', category: 'document' });
    const result = await decryptEncryption(mockWallet, enc);

    expect(result.success).toBe(true);
    expect(result.savedPath).toBe('/saved/file.pdf');
    expect(result.savedSize).toBe(1024);
    expect(result.fileExtension).toBe('.pdf');
  });

  it('returns error when Iagon API key missing', async () => {
    mockDeriveSecretFromWallet.mockResolvedValue(42n);
    mockGetLevels.mockResolvedValue([{ r1: 'r1', r2_g1: 'r2' }]);
    mockDecryptToHash.mockResolvedValue('aa'.repeat(32));
    mockEciesDecrypt.mockResolvedValue(new Uint8Array([1]));

    const payloadMap = new Map<number, Uint8Array>();
    payloadMap.set(0, new TextEncoder().encode('file_id'));
    payloadMap.set(1, new Uint8Array(44));
    mockParsePayload.mockReturnValue(payloadMap);

    mockDecodeFileSecret.mockReturnValue({
      key: new Uint8Array(32),
      nonce: new Uint8Array(12),
    });
    mockGetStoredApiKey.mockResolvedValue(null);

    const enc = createEncryption({ storageLayer: 'iagon' });
    const result = await decryptEncryption(mockWallet, enc);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Iagon is not connected');
  });

  it('catches and wraps ECIES decrypt errors', async () => {
    mockDeriveSecretFromWallet.mockResolvedValue(42n);
    mockGetLevels.mockResolvedValue([{ r1: 'r1', r2_g1: 'r2' }]);
    mockDecryptToHash.mockResolvedValue('aa'.repeat(32));
    mockEciesDecrypt.mockRejectedValue(new Error('GCM auth failed'));

    const result = await decryptEncryption(mockWallet, testEncryption);

    expect(result.success).toBe(false);
    expect(result.error).toContain('GCM auth failed');
  });

  it('reports progress through onProgress callback', async () => {
    mockDeriveSecretFromWallet.mockResolvedValue(42n);
    mockGetLevels.mockResolvedValue([
      { r1: 'r1_a', r2_g1: 'r2_a' },
      { r1: 'r1_b', r2_g1: 'r2_b' },
    ]);
    mockDecryptToHash
      .mockResolvedValueOnce('dd'.repeat(32))
      .mockResolvedValueOnce('ee'.repeat(32));
    mockEciesDecrypt.mockResolvedValue(new TextEncoder().encode('msg'));
    mockParsePayload.mockImplementation(() => { throw new Error('not CBOR'); });

    const progress: [number, number][] = [];
    const result = await decryptEncryption(mockWallet, testEncryption, (c, t) => progress.push([c, t]));

    expect(result.success).toBe(true);
    expect(progress).toEqual([[0, 2], [1, 2], [2, 2]]);
  });

  it('handles multi-field CBOR payload with extra fields', async () => {
    mockDeriveSecretFromWallet.mockResolvedValue(42n);
    mockGetLevels.mockResolvedValue([{ r1: 'r1', r2_g1: 'r2' }]);
    mockDecryptToHash.mockResolvedValue('aa'.repeat(32));
    mockEciesDecrypt.mockResolvedValue(new Uint8Array([1]));

    const payloadMap = new Map<number, Uint8Array>();
    payloadMap.set(0, new TextEncoder().encode('locator'));
    payloadMap.set(1, new TextEncoder().encode('secret'));
    payloadMap.set(2, new TextEncoder().encode('digest'));
    mockParsePayload.mockReturnValue(payloadMap);

    // No storageLayer=iagon, so it falls through to text display
    const enc = createEncryption({ storageLayer: undefined });
    const result = await decryptEncryption(mockWallet, enc);

    expect(result.success).toBe(true);
    expect(result.message).toContain('Locator: locator');
    expect(result.message).toContain('Secret:');
    expect(result.message).toContain('Digest:');
  });
});
