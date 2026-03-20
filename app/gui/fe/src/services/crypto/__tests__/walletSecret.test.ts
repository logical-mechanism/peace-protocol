import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IWallet } from '@meshsdk/core';

/** Partial mock wallet with vi.fn() stubs for tested methods */
interface MockWallet extends Partial<IWallet> {
  signData: ReturnType<typeof vi.fn>;
  getUsedAddresses: ReturnType<typeof vi.fn>;
  getUnusedAddresses: ReturnType<typeof vi.fn>;
}

const { mockGetPaymentKeyHex, mockDeriveZkSecret, mockToInt, mockGenerate } = vi.hoisted(() => ({
  mockGetPaymentKeyHex: vi.fn(),
  mockDeriveZkSecret: vi.fn(),
  mockToInt: vi.fn(),
  mockGenerate: vi.fn(),
}));

vi.mock('../zkKeyDerivation', () => ({
  getPaymentKeyHex: mockGetPaymentKeyHex,
  deriveZkSecret: mockDeriveZkSecret,
}));

vi.mock('../bls12381', () => ({
  toInt: mockToInt,
}));

vi.mock('../hashing', () => ({
  generate: mockGenerate,
}));

vi.mock('../constants', () => ({
  KEY_DOMAIN_TAG: 'TEST_DOMAIN_TAG',
}));

import {
  buildKeyDerivationMessage,
  deriveSecretFromWallet,
  supportsSignData,
  getSigningExplanation,
} from '../walletSecret';

describe('buildKeyDerivationMessage', () => {
  it('returns the exact protocol message string', () => {
    expect(buildKeyDerivationMessage('any-address')).toBe('PEACE_PROTOCOL_v1');
  });

  it('ignores the address parameter (returns same value for different addresses)', () => {
    const a = buildKeyDerivationMessage('addr_test1abc');
    const b = buildKeyDerivationMessage('addr_test1xyz');
    const c = buildKeyDerivationMessage('');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('is stable across calls', () => {
    const first = buildKeyDerivationMessage('x');
    const second = buildKeyDerivationMessage('x');
    expect(first).toBe(second);
  });
});

describe('deriveSecretFromWallet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses desktop path when payment key hex is available', async () => {
    mockGetPaymentKeyHex.mockReturnValue('aabb1122');
    mockDeriveZkSecret.mockReturnValue(42n);

    const wallet: MockWallet = { signData: vi.fn(), getUsedAddresses: vi.fn(), getUnusedAddresses: vi.fn() };
    const result = await deriveSecretFromWallet(wallet as unknown as IWallet);

    expect(result).toBe(42n);
    expect(mockDeriveZkSecret).toHaveBeenCalledWith('aabb1122');
    expect(wallet.signData).not.toHaveBeenCalled();
  });

  it('falls back to browser path when payment key hex is null', async () => {
    mockGetPaymentKeyHex.mockReturnValue(null);
    mockGenerate.mockReturnValue('hashed_value');
    mockToInt.mockReturnValue(99n);

    const wallet: MockWallet = {
      getUsedAddresses: vi.fn().mockResolvedValue(['addr_test1abc']),
      getUnusedAddresses: vi.fn(),
      signData: vi.fn().mockResolvedValue({ signature: 'sig123', key: 'key456' }),
    };

    const result = await deriveSecretFromWallet(wallet as unknown as IWallet);

    expect(result).toBe(99n);
    expect(wallet.signData).toHaveBeenCalledWith('PEACE_PROTOCOL_v1', 'addr_test1abc');
    expect(mockGenerate).toHaveBeenCalled();
    expect(mockToInt).toHaveBeenCalledWith('hashed_value');
  });

  it('falls back to unused addresses when used addresses are empty', async () => {
    mockGetPaymentKeyHex.mockReturnValue(null);
    mockGenerate.mockReturnValue('h');
    mockToInt.mockReturnValue(1n);

    const wallet: MockWallet = {
      getUsedAddresses: vi.fn().mockResolvedValue([]),
      getUnusedAddresses: vi.fn().mockResolvedValue(['addr_unused']),
      signData: vi.fn().mockResolvedValue({ signature: 'sig', key: 'k' }),
    };

    const result = await deriveSecretFromWallet(wallet as unknown as IWallet);

    expect(result).toBe(1n);
    expect(wallet.signData).toHaveBeenCalledWith('PEACE_PROTOCOL_v1', 'addr_unused');
  });

  it('throws when no addresses available', async () => {
    mockGetPaymentKeyHex.mockReturnValue(null);

    const wallet: MockWallet = {
      getUsedAddresses: vi.fn().mockResolvedValue([]),
      getUnusedAddresses: vi.fn().mockResolvedValue([]),
      signData: vi.fn(),
    };

    await expect(deriveSecretFromWallet(wallet as unknown as IWallet)).rejects.toThrow('No addresses available');
  });

  it('throws "Signature rejected" when user rejects signing', async () => {
    mockGetPaymentKeyHex.mockReturnValue(null);

    const wallet: MockWallet = {
      getUsedAddresses: vi.fn().mockResolvedValue(['addr']),
      getUnusedAddresses: vi.fn(),
      signData: vi.fn().mockRejectedValue(new Error('User rejected the request')),
    };

    await expect(deriveSecretFromWallet(wallet as unknown as IWallet)).rejects.toThrow('Signature rejected');
  });

  it('wraps other signData errors', async () => {
    mockGetPaymentKeyHex.mockReturnValue(null);

    const wallet: MockWallet = {
      getUsedAddresses: vi.fn().mockResolvedValue(['addr']),
      getUnusedAddresses: vi.fn(),
      signData: vi.fn().mockRejectedValue(new Error('network timeout')),
    };

    await expect(deriveSecretFromWallet(wallet as unknown as IWallet)).rejects.toThrow('Failed to derive secret from wallet');
  });

  it('wraps non-Error exceptions', async () => {
    mockGetPaymentKeyHex.mockReturnValue(null);

    const wallet: MockWallet = {
      getUsedAddresses: vi.fn().mockResolvedValue(['addr']),
      getUnusedAddresses: vi.fn(),
      signData: vi.fn().mockRejectedValue('string error'),
    };

    await expect(deriveSecretFromWallet(wallet as unknown as IWallet)).rejects.toThrow('Failed to derive secret from wallet');
  });
});

describe('supportsSignData', () => {
  it('returns true when wallet has signData function', () => {
    const wallet = { signData: () => {} } as unknown as IWallet;
    expect(supportsSignData(wallet)).toBe(true);
  });

  it('returns false when signData is missing', () => {
    const wallet = {} as unknown as IWallet;
    expect(supportsSignData(wallet)).toBe(false);
  });
});

describe('getSigningExplanation', () => {
  it('returns a non-empty explanation string', () => {
    const explanation = getSigningExplanation();
    expect(explanation).toContain('sign a message');
    expect(explanation).toContain('never stored');
  });
});
