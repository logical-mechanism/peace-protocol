import { describe, it, expect, vi } from 'vitest';

// Mock heavy dependencies that pull in libsodium WASM / Tauri APIs
vi.mock('@meshsdk/core', () => ({ MeshTxBuilder: vi.fn(), deserializeAddress: vi.fn() }));
vi.mock('@meshsdk/provider', () => ({ OgmiosProvider: vi.fn() }));
vi.mock('../providers', () => ({ getKupoAdapter: vi.fn(), getOgmiosProvider: vi.fn() }));
vi.mock('../secretStorage', () => ({ storeSecrets: vi.fn() }));
vi.mock('../bidSecretStorage', () => ({ storeBidSecrets: vi.fn(), removeBidSecrets: vi.fn() }));
vi.mock('../acceptBidStorage', () => ({ storeAcceptBidSecrets: vi.fn(), getAcceptBidSecrets: vi.fn() }));
vi.mock('../crypto/walletSecret', () => ({ deriveSecretFromWallet: vi.fn() }));

import { computeTokenName, estimateMinLovelace, getStorageLayerUri } from '../transactionBuilder';
import type { FileCategory } from '../../config/categories';

function makeFormData(category: FileCategory) {
  return { category, secretMessage: '', file: null, description: '', suggestedPrice: '', imageLink: '' };
}

describe('computeTokenName', () => {
  const txHash = 'a'.repeat(64);

  it('index 0: result starts with 00, total length 64', () => {
    const result = computeTokenName(txHash, 0);
    expect(result).toHaveLength(64);
    expect(result.startsWith('00')).toBe(true);
  });

  it('index 23: result starts with 17', () => {
    const result = computeTokenName(txHash, 23);
    expect(result).toHaveLength(64);
    expect(result.startsWith('17')).toBe(true);
  });

  it('index 24: result starts with 1818 (CBOR 1-byte encoding)', () => {
    const result = computeTokenName(txHash, 24);
    expect(result).toHaveLength(64);
    expect(result.startsWith('1818')).toBe(true);
  });

  it('index 255: result starts with 18ff', () => {
    const result = computeTokenName(txHash, 255);
    expect(result).toHaveLength(64);
    expect(result.startsWith('18ff')).toBe(true);
  });

  it('index 256: result starts with 190100 (CBOR 2-byte encoding)', () => {
    const result = computeTokenName(txHash, 256);
    expect(result).toHaveLength(64);
    expect(result.startsWith('190100')).toBe(true);
  });

  it('all results are exactly 64 hex chars', () => {
    for (const idx of [0, 1, 23, 24, 100, 255, 256, 1000]) {
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
    const datum = {
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

  it('document category returns data-layer', () => {
    expect(getStorageLayerUri(makeFormData('document'))).toBe('data-layer');
  });

  it('image category returns data-layer', () => {
    expect(getStorageLayerUri(makeFormData('image'))).toBe('data-layer');
  });

  it('all non-text categories return data-layer', () => {
    for (const cat of ['document', 'audio', 'image', 'video', 'other'] as FileCategory[]) {
      expect(getStorageLayerUri(makeFormData(cat))).toBe('data-layer');
    }
  });
});
