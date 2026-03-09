import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isWasmDecryptAvailable,
  isStubMode,
  fetchEncryptionHistory,
  canDecrypt,
  decryptBid,
  getDecryptionExplanation,
} from '../decrypt';
import { createBid, createEncryption } from '../../../test/factories';

// ── Mocks ───────────────────────────────────────────────────────────

// Mock the heavy crypto/network dependencies so we can test decrypt logic in isolation
vi.mock('../ecies', () => ({
  decrypt: vi.fn(),
}));

vi.mock('../payload', () => ({
  parsePayload: vi.fn(),
}));

vi.mock('../bls12381', () => ({
  bytesToHex: vi.fn((b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')),
  g2Point: vi.fn(() => 'mock_g2_point'),
  scale: vi.fn(() => 'mock_scaled_point'),
}));

vi.mock('../constants', () => ({
  H0: 'mock_H0',
}));

vi.mock('../../snark', () => ({
  getSnarkProver: vi.fn(() => ({
    decryptToHash: vi.fn().mockResolvedValue('aa'.repeat(32)),
  })),
}));

vi.mock('../walletSecret', () => ({
  deriveSecretFromWallet: vi.fn().mockResolvedValue(42n),
}));

vi.mock('../fileEncryption', () => ({
  decryptDownloadedFile: vi.fn(),
  decodeFileSecret: vi.fn(),
  verifyFileDigest: vi.fn(),
}));

vi.mock('../../iagonApi', () => ({
  downloadFile: vi.fn(),
  downloadAndSave: vi.fn(),
}));

vi.mock('../../iagonAuth', () => ({
  getStoredApiKey: vi.fn(),
}));

vi.mock('../../api', () => ({
  encryptionsApi: {
    getLevels: vi.fn(),
  },
}));

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
