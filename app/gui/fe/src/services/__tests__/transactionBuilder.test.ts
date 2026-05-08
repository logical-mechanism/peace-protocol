import { describe, it, expect, vi } from 'vitest';

// Mock heavy dependencies that pull in libsodium WASM / Tauri APIs
vi.mock('@meshsdk/core', () => ({ MeshTxBuilder: vi.fn(), deserializeAddress: vi.fn() }));
vi.mock('@meshsdk/provider', () => ({ OgmiosProvider: vi.fn() }));
vi.mock('../providers', () => ({ getKupoAdapter: vi.fn(), getChainingAdapter: vi.fn(), getOgmiosProvider: vi.fn(), getPendingTxPool: () => ({ registerTx: vi.fn().mockResolvedValue(undefined), confirmTx: vi.fn(), invalidateChain: vi.fn(), clear: vi.fn() }) }));
vi.mock('../secretStorage', () => ({ storeSecrets: vi.fn() }));
vi.mock('../bidSecretStorage', () => ({ storeBidSecrets: vi.fn(), removeBidSecrets: vi.fn() }));
vi.mock('../acceptBidStorage', () => ({ storeAcceptBidSecrets: vi.fn(), getAcceptBidSecrets: vi.fn() }));
vi.mock('../crypto/walletSecret', () => ({ deriveSecretFromWallet: vi.fn() }));

import { computeTokenName, estimateMinLovelace, getStorageLayerUri } from '../transactionBuilder';
import type { FileCategory } from '../../config/categories';

function makeFormData(category: FileCategory) {
  return { category, subcategory: '', nsfw: false, secretMessage: '', file: null, filePath: null, fileName: null, fileSize: null, description: '', suggestedPrice: '', imageLink: '' };
}

describe('computeTokenName (mirrors on-chain util.construct_token_name byte-for-byte)', () => {
  const txHash = 'a'.repeat(64);

  it('index 0: single 00 byte prepended', () => {
    const result = computeTokenName(txHash, 0);
    expect(result).toHaveLength(64);
    expect(result.startsWith('00')).toBe(true);
  });

  it('index 23: single 17 byte prepended', () => {
    const result = computeTokenName(txHash, 23);
    expect(result).toHaveLength(64);
    expect(result.startsWith('17')).toBe(true);
  });

  // I-08 regression: index 24 used to emit `1818` (CBOR major-type-0
  // 1-byte encoding), which desynced from on-chain `bytearray.push` and
  // made the mint fail. Now must emit a SINGLE 18 byte.
  it('index 24: single 18 byte prepended (I-08 regression)', () => {
    const result = computeTokenName(txHash, 24);
    expect(result).toHaveLength(64);
    expect(result.startsWith('18')).toBe(true);
    expect(result.startsWith('1818')).toBe(false);
  });

  it('index 255: single ff byte prepended', () => {
    const result = computeTokenName(txHash, 255);
    expect(result).toHaveLength(64);
    expect(result.startsWith('ff')).toBe(true);
    expect(result.startsWith('18ff')).toBe(false);
  });

  // bytearray.push on-chain rejects values outside [0, 255]; off-chain
  // must reject too rather than silently produce a desynced token name.
  it('index 256: throws (mirrors on-chain bytearray.push rejection)', () => {
    expect(() => computeTokenName(txHash, 256)).toThrow(/0, 255/);
  });

  it('index -1: throws', () => {
    expect(() => computeTokenName(txHash, -1)).toThrow(/0, 255/);
  });

  it('non-integer index: throws', () => {
    expect(() => computeTokenName(txHash, 1.5)).toThrow(/0, 255/);
  });

  it('all in-range results are exactly 64 hex chars', () => {
    for (const idx of [0, 1, 23, 24, 100, 200, 255]) {
      const result = computeTokenName(txHash, idx);
      expect(result).toHaveLength(64);
      expect(result).toMatch(/^[0-9a-f]+$/);
    }
  });
});

describe('estimateMinLovelace', () => {
  it('small datum returns string with parseInt >= 2_000_000', () => {
    const datum = {
      constructor: 0,
      fields: [
        { bytes: 'aa'.repeat(28) },
        { int: 42 },
      ],
    };
    const result = estimateMinLovelace(datum);
    expect(typeof result).toBe('string');
    expect(parseInt(result, 10)).toBeGreaterThanOrEqual(2_000_000);
  });

  it('large datum returns > 2_000_000', () => {
    const datum: object = {
      constructor: 0,
      fields: [
        { bytes: 'ff'.repeat(200) },
        { bytes: 'ee'.repeat(200) },
        { bytes: 'dd'.repeat(200) },
        { constructor: 1, fields: [{ int: 999 }] },
      ],
    };
    const result = estimateMinLovelace(datum);
    expect(parseInt(result, 10)).toBeGreaterThan(2_000_000);
  });

  it('result is always a string', () => {
    const datum = { constructor: 0, fields: [] };
    const result = estimateMinLovelace(datum);
    expect(typeof result).toBe('string');
  });
});

describe('getStorageLayerUri', () => {
  it('text category returns on-chain', () => {
    expect(getStorageLayerUri(makeFormData('text'))).toBe('on-chain');
  });

  it('document category returns iagon', () => {
    expect(getStorageLayerUri(makeFormData('document'))).toBe('iagon');
  });

  it('image category returns iagon', () => {
    expect(getStorageLayerUri(makeFormData('image'))).toBe('iagon');
  });

  it('all non-text categories return iagon', () => {
    for (const cat of ['document', 'audio', 'image', 'video', 'other'] as FileCategory[]) {
      expect(getStorageLayerUri(makeFormData(cat))).toBe('iagon');
    }
  });
});

// ── Error path tests ─────────────────────────────────────────────────

describe('computeTokenName — edge cases', () => {
  it('handles txHash shorter than 64 chars (truncated hash)', () => {
    // Should not throw — result may be shorter but function doesn't validate
    const result = computeTokenName('abcd', 0);
    expect(typeof result).toBe('string');
  });

  it('rejects out-of-range index values (was: silently produced bad token names)', () => {
    const txHash = 'a'.repeat(64);
    expect(() => computeTokenName(txHash, 100_000)).toThrow();
  });
});

describe('estimateMinLovelace — edge cases', () => {
  it('handles empty datum (no fields)', () => {
    const result = estimateMinLovelace({ constructor: 0, fields: [] });
    expect(parseInt(result, 10)).toBeGreaterThanOrEqual(2_000_000);
  });

  it('handles deeply nested datum without crashing', () => {
    const nested = {
      constructor: 0,
      fields: [
        { constructor: 1, fields: [
          { constructor: 2, fields: [
            { bytes: 'aa'.repeat(48) },
            { int: 999 },
          ] },
        ] },
      ],
    };
    const result = estimateMinLovelace(nested);
    expect(parseInt(result, 10)).toBeGreaterThanOrEqual(2_000_000);
  });

  it('handles datum with no hex bytes (all ints)', () => {
    const datum = {
      constructor: 0,
      fields: [{ int: 1 }, { int: 2 }, { int: 3 }],
    };
    const result = estimateMinLovelace(datum);
    expect(parseInt(result, 10)).toBeGreaterThanOrEqual(2_000_000);
  });
});
