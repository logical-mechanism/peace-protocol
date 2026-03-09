import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  storeBidSecrets,
  getBidSecrets,
  getBidSecretsForEncryption,
  hasBidSecrets,
  removeBidSecrets,
} from '../bidSecretStorage';

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('storeBidSecrets', () => {
  it('converts bigint b to hex and calls invoke', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await storeBidSecrets('bid1', 'enc1', 255n);
    expect(mockInvoke).toHaveBeenCalledWith('store_bid_secrets', {
      bidTokenName: 'bid1',
      encryptionTokenName: 'enc1',
      b: 'ff',
    });
  });
});

describe('getBidSecrets', () => {
  it('returns b as bigint and encryptionTokenName', async () => {
    mockInvoke.mockResolvedValueOnce({ b: 'ff', encryptionTokenName: 'enc1' });
    const result = await getBidSecrets('bid1');
    expect(result).toEqual({ b: 255n, encryptionTokenName: 'enc1' });
    expect(mockInvoke).toHaveBeenCalledWith('get_bid_secrets', { bidTokenName: 'bid1' });
  });

  it('returns null when not found', async () => {
    mockInvoke.mockResolvedValueOnce(null);
    const result = await getBidSecrets('missing');
    expect(result).toBeNull();
  });
});

describe('getBidSecretsForEncryption', () => {
  it('returns array with single entry when found', async () => {
    mockInvoke.mockResolvedValueOnce({ b: 'ab', encryptionTokenName: 'enc1' });
    const result = await getBidSecretsForEncryption('enc1');
    expect(result).toEqual([{ bidTokenName: '', b: 171n }]); // 0xab = 171
    expect(mockInvoke).toHaveBeenCalledWith('get_bid_secrets_for_encryption', {
      encryptionTokenName: 'enc1',
    });
  });

  it('returns empty array when not found', async () => {
    mockInvoke.mockResolvedValueOnce(null);
    const result = await getBidSecretsForEncryption('missing');
    expect(result).toEqual([]);
  });
});

describe('hasBidSecrets', () => {
  it('returns true when secrets exist', async () => {
    mockInvoke.mockResolvedValueOnce({ b: '1', encryptionTokenName: 'enc1' });
    expect(await hasBidSecrets('bid1')).toBe(true);
  });

  it('returns false when secrets do not exist', async () => {
    mockInvoke.mockResolvedValueOnce(null);
    expect(await hasBidSecrets('missing')).toBe(false);
  });
});

describe('removeBidSecrets', () => {
  it('calls invoke with correct command', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await removeBidSecrets('bid1');
    expect(mockInvoke).toHaveBeenCalledWith('remove_bid_secrets', { bidTokenName: 'bid1' });
  });
});

describe('error handling', () => {
  it('propagates invoke rejection', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Wallet locked'));
    await expect(storeBidSecrets('b', 'e', 1n)).rejects.toThrow('Wallet locked');
  });
});
