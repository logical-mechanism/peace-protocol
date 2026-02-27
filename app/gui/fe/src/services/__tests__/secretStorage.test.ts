import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  storeSecrets,
  getSecrets,
  hasSecrets,
  removeSecrets,
  listSecrets,
  clearAllSecrets,
  exportSecrets,
  importSecrets,
} from '../secretStorage';

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('storeSecrets', () => {
  it('converts bigints to hex and calls invoke', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await storeSecrets('token1', 255n, 4096n);
    expect(mockInvoke).toHaveBeenCalledWith('store_seller_secrets', {
      tokenName: 'token1',
      a: 'ff',
      r: '1000',
    });
  });
});

describe('getSecrets', () => {
  it('returns bigints converted from hex', async () => {
    mockInvoke.mockResolvedValueOnce({ a: 'ff', r: '1000' });
    const result = await getSecrets('token1');
    expect(result).toEqual({ a: 255n, r: 4096n });
    expect(mockInvoke).toHaveBeenCalledWith('get_seller_secrets', { tokenName: 'token1' });
  });

  it('returns null when not found', async () => {
    mockInvoke.mockResolvedValueOnce(null);
    const result = await getSecrets('missing');
    expect(result).toBeNull();
  });

  it('handles large bigint values', async () => {
    const bigHex = 'fffffffffffffffffffffffffffffffffffffffffffffffffff';
    mockInvoke.mockResolvedValueOnce({ a: bigHex, r: '1' });
    const result = await getSecrets('token1');
    expect(result!.a).toBe(BigInt('0x' + bigHex));
    expect(result!.r).toBe(1n);
  });
});

describe('hasSecrets', () => {
  it('returns true when secrets exist', async () => {
    mockInvoke.mockResolvedValueOnce({ a: 'ff', r: '1' });
    expect(await hasSecrets('token1')).toBe(true);
  });

  it('returns false when secrets do not exist', async () => {
    mockInvoke.mockResolvedValueOnce(null);
    expect(await hasSecrets('missing')).toBe(false);
  });
});

describe('removeSecrets', () => {
  it('calls invoke with correct command', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await removeSecrets('token1');
    expect(mockInvoke).toHaveBeenCalledWith('remove_seller_secrets', { tokenName: 'token1' });
  });
});

describe('listSecrets', () => {
  it('maps snake_case keys to camelCase', async () => {
    mockInvoke.mockResolvedValueOnce([
      { token_name: 'token1', created_at: '2025-01-01T00:00:00Z' },
      { token_name: 'token2', created_at: '2025-02-01T00:00:00Z' },
    ]);
    const result = await listSecrets();
    expect(result).toEqual([
      { tokenName: 'token1', createdAt: '2025-01-01T00:00:00Z' },
      { tokenName: 'token2', createdAt: '2025-02-01T00:00:00Z' },
    ]);
    expect(mockInvoke).toHaveBeenCalledWith('list_seller_secrets');
  });

  it('returns empty array when none exist', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    expect(await listSecrets()).toEqual([]);
  });
});

describe('clearAllSecrets', () => {
  it('lists and removes each secret', async () => {
    // First call: list
    mockInvoke.mockResolvedValueOnce([
      { token_name: 'token1', created_at: '' },
      { token_name: 'token2', created_at: '' },
    ]);
    // Next two calls: remove each
    mockInvoke.mockResolvedValueOnce(undefined);
    mockInvoke.mockResolvedValueOnce(undefined);

    await clearAllSecrets();
    expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect(mockInvoke).toHaveBeenCalledWith('remove_seller_secrets', { tokenName: 'token1' });
    expect(mockInvoke).toHaveBeenCalledWith('remove_seller_secrets', { tokenName: 'token2' });
  });
});

describe('exportSecrets', () => {
  it('lists secrets, reads each, and returns JSON', async () => {
    // list
    mockInvoke.mockResolvedValueOnce([
      { token_name: 'token1', created_at: '2025-01-01' },
    ]);
    // get secret for token1
    mockInvoke.mockResolvedValueOnce({ a: 'ff', r: '10' });

    const json = await exportSecrets();
    const parsed = JSON.parse(json);
    expect(parsed).toEqual([
      { tokenName: 'token1', a: 'ff', r: '10', createdAt: '2025-01-01' },
    ]);
  });

  it('skips secrets that return null on read', async () => {
    mockInvoke.mockResolvedValueOnce([
      { token_name: 'token1', created_at: '' },
    ]);
    mockInvoke.mockResolvedValueOnce(null);

    const json = await exportSecrets();
    expect(JSON.parse(json)).toEqual([]);
  });
});

describe('importSecrets', () => {
  it('parses JSON and stores each secret', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const json = JSON.stringify([
      { tokenName: 'token1', a: 'ff', r: '10', createdAt: '' },
      { tokenName: 'token2', a: 'ab', r: 'cd', createdAt: '' },
    ]);

    const count = await importSecrets(json);
    expect(count).toBe(2);
    expect(mockInvoke).toHaveBeenCalledWith('store_seller_secrets', {
      tokenName: 'token1',
      a: 'ff',
      r: '10',
    });
    expect(mockInvoke).toHaveBeenCalledWith('store_seller_secrets', {
      tokenName: 'token2',
      a: 'ab',
      r: 'cd',
    });
  });
});

describe('error handling', () => {
  it('propagates invoke rejection from storeSecrets', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Wallet locked'));
    await expect(storeSecrets('t', 1n, 2n)).rejects.toThrow('Wallet locked');
  });

  it('propagates invoke rejection from getSecrets', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Decryption failed'));
    await expect(getSecrets('t')).rejects.toThrow('Decryption failed');
  });
});
