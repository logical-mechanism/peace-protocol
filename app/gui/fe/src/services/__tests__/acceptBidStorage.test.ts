import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  storeAcceptBidSecrets,
  getAcceptBidSecrets,
  removeAcceptBidSecrets,
  hasAcceptBidSecrets,
} from '../acceptBidStorage';

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('storeAcceptBidSecrets', () => {
  it('converts bigints to hex and calls invoke', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await storeAcceptBidSecrets('enc1', 'bid1', 255n, 16n, 42n, ['1', '2'], 1000, 'txhash1');
    expect(mockInvoke).toHaveBeenCalledWith('store_accept_bid_secrets', {
      encryptionTokenName: 'enc1',
      bidTokenName: 'bid1',
      a0: 'ff',
      r0: '10',
      hk: '2a',
      grothPublic: ['1', '2'],
      ttl: 1000,
      snarkTxHash: 'txhash1',
    });
  });
});

describe('getAcceptBidSecrets', () => {
  it('returns bigints converted from hex', async () => {
    mockInvoke.mockResolvedValueOnce({
      a0: 'ff',
      r0: '10',
      hk: '2a',
      bidTokenName: 'bid1',
      grothPublic: ['1', '2', '3'],
      ttl: 5000,
      snarkTxHash: 'tx123',
    });
    const result = await getAcceptBidSecrets('enc1');
    expect(result).toEqual({
      a0: 255n,
      r0: 16n,
      hk: 42n,
      bidTokenName: 'bid1',
      grothPublic: ['1', '2', '3'],
      ttl: 5000,
      snarkTxHash: 'tx123',
    });
    expect(mockInvoke).toHaveBeenCalledWith('get_accept_bid_secrets', {
      encryptionTokenName: 'enc1',
    });
  });

  it('returns null when not found', async () => {
    mockInvoke.mockResolvedValueOnce(null);
    const result = await getAcceptBidSecrets('missing');
    expect(result).toBeNull();
  });

  it('handles empty hk as 0n', async () => {
    mockInvoke.mockResolvedValueOnce({
      a0: '1',
      r0: '2',
      hk: '',
      bidTokenName: 'bid1',
      grothPublic: [],
      ttl: 0,
      snarkTxHash: '',
    });
    const result = await getAcceptBidSecrets('enc1');
    expect(result!.hk).toBe(0n);
  });
});

describe('removeAcceptBidSecrets', () => {
  it('calls invoke with correct command', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await removeAcceptBidSecrets('enc1');
    expect(mockInvoke).toHaveBeenCalledWith('remove_accept_bid_secrets', {
      encryptionTokenName: 'enc1',
    });
  });
});

describe('hasAcceptBidSecrets', () => {
  it('returns true when secrets exist', async () => {
    mockInvoke.mockResolvedValueOnce(true);
    expect(await hasAcceptBidSecrets('enc1')).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('has_accept_bid_secrets', {
      encryptionTokenName: 'enc1',
    });
  });

  it('returns false when secrets do not exist', async () => {
    mockInvoke.mockResolvedValueOnce(false);
    expect(await hasAcceptBidSecrets('missing')).toBe(false);
  });
});

describe('error handling', () => {
  it('propagates invoke rejection from store', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Wallet locked'));
    await expect(
      storeAcceptBidSecrets('e', 'b', 1n, 2n, 3n, [], 0, ''),
    ).rejects.toThrow('Wallet locked');
  });
});
