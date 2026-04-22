import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  addressToHex,
  getStoredApiKey,
  isIagonConnected,
  disconnectIagon,
  connectIagon,
  getValidApiKey,
  hasValidApiKey,
  parseIagonError,
  isIagonAuthError,
  onIagonAuthFailure,
  handleIagonError,
} from '../iagonAuth';

// ── Mocks ───────────────────────────────────────────────────────────

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

// Mock iagonApi functions
const mockGetNonce = vi.fn();
const mockVerifySignature = vi.fn();
const mockGenerateApiKey = vi.fn();
const mockVerifyApiKey = vi.fn();

vi.mock('../iagonApi', () => ({
  getNonce: (...args: unknown[]) => mockGetNonce(...args),
  verifySignature: (...args: unknown[]) => mockVerifySignature(...args),
  generateApiKey: (...args: unknown[]) => mockGenerateApiKey(...args),
  verifyApiKey: (...args: unknown[]) => mockVerifyApiKey(...args),
}));

// Mock @scure/base bech32
vi.mock('@scure/base', () => ({
  bech32: {
    decode: vi.fn().mockReturnValue({ words: [0, 1, 2, 3, 4, 5, 6, 7] }),
    fromWords: vi.fn().mockReturnValue(new Uint8Array([0x00, 0x61, 0x08, 0xf0])),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────

describe('iagonAuth', () => {
  describe('addressToHex', () => {
    it('converts a bech32 address to hex string', () => {
      const result = addressToHex('addr_test1abc123');
      // Mock bech32.fromWords returns [0x00, 0x61, 0x08, 0xf0]
      expect(result).toBe('006108f0');
    });
  });

  describe('getStoredApiKey', () => {
    it('returns stored API key', async () => {
      mockInvoke.mockResolvedValueOnce('my-api-key');
      const result = await getStoredApiKey();
      expect(mockInvoke).toHaveBeenCalledWith('get_iagon_api_key');
      expect(result).toBe('my-api-key');
    });

    it('returns null when no key stored', async () => {
      mockInvoke.mockResolvedValueOnce(null);
      const result = await getStoredApiKey();
      expect(result).toBeNull();
    });

    it('returns null on invoke error', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('wallet locked'));
      const result = await getStoredApiKey();
      expect(result).toBeNull();
    });
  });

  describe('isIagonConnected', () => {
    it('returns true when API key exists', async () => {
      mockInvoke.mockResolvedValueOnce(true);
      const result = await isIagonConnected();
      expect(mockInvoke).toHaveBeenCalledWith('has_iagon_api_key');
      expect(result).toBe(true);
    });

    it('returns false when no key', async () => {
      mockInvoke.mockResolvedValueOnce(false);
      const result = await isIagonConnected();
      expect(result).toBe(false);
    });

    it('returns false on error', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('fail'));
      const result = await isIagonConnected();
      expect(result).toBe(false);
    });
  });

  describe('disconnectIagon', () => {
    it('calls remove_iagon_api_key', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      await disconnectIagon();
      expect(mockInvoke).toHaveBeenCalledWith('remove_iagon_api_key');
    });
  });

  describe('connectIagon', () => {
    it('performs full auth flow and stores API key', async () => {
      const mockWallet = {
        signData: vi.fn().mockResolvedValue({
          signature: 'sig-hex',
          key: 'key-hex',
        }),
      };

      mockGetNonce.mockResolvedValue('nonce-uuid');
      mockVerifySignature.mockResolvedValue({ id: 'user-1', session: 'jwt-token' });
      mockGenerateApiKey.mockResolvedValue('new-api-key');
      mockInvoke.mockResolvedValueOnce(undefined); // store_iagon_api_key

      const result = await connectIagon(
        mockWallet as never,
        'addr_test1abc123',
      );

      // Verify nonce was requested with hex address
      expect(mockGetNonce).toHaveBeenCalledWith('006108f0');
      // Verify wallet signed the nonce
      expect(mockWallet.signData).toHaveBeenCalledWith('nonce-uuid', 'addr_test1abc123');
      // Verify signature was submitted
      expect(mockVerifySignature).toHaveBeenCalledWith('006108f0', 'sig-hex', 'key-hex');
      // Verify API key was generated
      expect(mockGenerateApiKey).toHaveBeenCalledWith('jwt-token', 'veiled-desktop');
      // Verify key was stored
      expect(mockInvoke).toHaveBeenCalledWith('store_iagon_api_key', { apiKey: 'new-api-key' });
      expect(result).toBe('new-api-key');
    });
  });

  describe('getValidApiKey', () => {
    it('returns API key when valid', async () => {
      mockInvoke.mockResolvedValueOnce('stored-key'); // get_iagon_api_key
      mockVerifyApiKey.mockResolvedValue(true);
      const result = await getValidApiKey();
      expect(result).toBe('stored-key');
    });

    it('returns null when no stored key', async () => {
      mockInvoke.mockResolvedValueOnce(null); // get_iagon_api_key
      const result = await getValidApiKey();
      expect(result).toBeNull();
      expect(mockVerifyApiKey).not.toHaveBeenCalled();
    });

    it('returns null and disconnects when key is invalid', async () => {
      mockInvoke.mockResolvedValueOnce('expired-key'); // get_iagon_api_key
      mockVerifyApiKey.mockResolvedValue(false);
      mockInvoke.mockResolvedValueOnce(undefined); // remove_iagon_api_key (disconnect)
      const result = await getValidApiKey();
      expect(result).toBeNull();
      expect(mockInvoke).toHaveBeenCalledWith('remove_iagon_api_key');
    });

    it('returns null even if disconnect cleanup fails', async () => {
      mockInvoke.mockResolvedValueOnce('expired-key'); // get_iagon_api_key
      mockVerifyApiKey.mockResolvedValue(false);
      mockInvoke.mockRejectedValueOnce(new Error('cleanup fail')); // remove_iagon_api_key
      const result = await getValidApiKey();
      expect(result).toBeNull();
    });
  });

  // ── Error path tests ─────────────────────────────────────────────

  describe('error handling', () => {
    it('disconnectIagon propagates invoke rejection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('wallet locked'));
      await expect(disconnectIagon()).rejects.toThrow('wallet locked');
    });

    it('connectIagon throws when getNonce fails', async () => {
      const mockWallet = { signData: vi.fn() };
      mockGetNonce.mockRejectedValue(new Error('network error'));

      await expect(
        connectIagon(mockWallet as never, 'addr_test1abc123'),
      ).rejects.toThrow('network error');

      expect(mockWallet.signData).not.toHaveBeenCalled();
    });

    it('connectIagon throws when wallet.signData fails', async () => {
      const mockWallet = {
        signData: vi.fn().mockRejectedValue(new Error('user rejected')),
      };
      mockGetNonce.mockResolvedValue('nonce-uuid');

      await expect(
        connectIagon(mockWallet as never, 'addr_test1abc123'),
      ).rejects.toThrow('user rejected');

      expect(mockVerifySignature).not.toHaveBeenCalled();
    });

    it('connectIagon throws when verifySignature fails', async () => {
      const mockWallet = {
        signData: vi.fn().mockResolvedValue({ signature: 'sig', key: 'key' }),
      };
      mockGetNonce.mockResolvedValue('nonce-uuid');
      mockVerifySignature.mockRejectedValue(new Error('invalid signature'));

      await expect(
        connectIagon(mockWallet as never, 'addr_test1abc123'),
      ).rejects.toThrow('invalid signature');

      expect(mockGenerateApiKey).not.toHaveBeenCalled();
    });

    it('connectIagon throws when generateApiKey fails', async () => {
      const mockWallet = {
        signData: vi.fn().mockResolvedValue({ signature: 'sig', key: 'key' }),
      };
      mockGetNonce.mockResolvedValue('nonce-uuid');
      mockVerifySignature.mockResolvedValue({ id: 'user-1', session: 'jwt' });
      mockGenerateApiKey.mockRejectedValue(new Error('rate limited'));

      await expect(
        connectIagon(mockWallet as never, 'addr_test1abc123'),
      ).rejects.toThrow('rate limited');

      expect(mockInvoke).not.toHaveBeenCalledWith('store_iagon_api_key', expect.anything());
    });

    it('connectIagon throws when store_iagon_api_key invoke fails', async () => {
      const mockWallet = {
        signData: vi.fn().mockResolvedValue({ signature: 'sig', key: 'key' }),
      };
      mockGetNonce.mockResolvedValue('nonce-uuid');
      mockVerifySignature.mockResolvedValue({ id: 'user-1', session: 'jwt' });
      mockGenerateApiKey.mockResolvedValue('new-api-key');
      mockInvoke.mockRejectedValueOnce(new Error('wallet locked'));

      await expect(
        connectIagon(mockWallet as never, 'addr_test1abc123'),
      ).rejects.toThrow('wallet locked');
    });
  });

  // ── Structured error helpers ─────────────────────────────────────

  describe('parseIagonError', () => {
    it('returns structured info for a JSON-shaped Error message', () => {
      const err = new Error('{"code":"AUTH_FAILED","message":"expired"}');
      expect(parseIagonError(err)).toEqual({ code: 'AUTH_FAILED', message: 'expired' });
    });

    it('returns structured info for a raw JSON string', () => {
      expect(parseIagonError('{"code":"NOT_FOUND","message":"missing"}')).toEqual({
        code: 'NOT_FOUND',
        message: 'missing',
      });
    });

    it('returns null for non-JSON error messages', () => {
      expect(parseIagonError(new Error('plain text boom'))).toBeNull();
    });

    it('returns null for JSON missing required fields', () => {
      expect(parseIagonError(new Error('{"code":"X"}'))).toBeNull();
      expect(parseIagonError(new Error('{"message":"m"}'))).toBeNull();
    });

    it('returns null for non-Error, non-string values', () => {
      expect(parseIagonError(42)).toBeNull();
      expect(parseIagonError(null)).toBeNull();
      expect(parseIagonError(undefined)).toBeNull();
    });
  });

  describe('isIagonAuthError', () => {
    it('is true for AUTH_FAILED payloads', () => {
      expect(isIagonAuthError(new Error('{"code":"AUTH_FAILED","message":"e"}'))).toBe(true);
    });

    it('is false for other structured codes', () => {
      expect(isIagonAuthError(new Error('{"code":"SERVER_ERROR","message":"b"}'))).toBe(false);
    });

    it('is false for unstructured errors', () => {
      expect(isIagonAuthError(new Error('plain boom'))).toBe(false);
    });
  });

  describe('handleIagonError / onIagonAuthFailure', () => {
    it('returns false and does nothing for non-auth errors', async () => {
      const listener = vi.fn();
      const unsub = onIagonAuthFailure(listener);
      const handled = await handleIagonError(new Error('plain boom'));
      expect(handled).toBe(false);
      expect(listener).not.toHaveBeenCalled();
      unsub();
    });

    it('removes the stored key and notifies listeners for AUTH_FAILED', async () => {
      const listener = vi.fn();
      const unsub = onIagonAuthFailure(listener);
      mockInvoke.mockResolvedValueOnce(undefined); // remove_iagon_api_key

      const handled = await handleIagonError(
        new Error('{"code":"AUTH_FAILED","message":"expired"}'),
      );

      expect(handled).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('remove_iagon_api_key');
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
    });

    it('still notifies listeners even if disconnect throws', async () => {
      const listener = vi.fn();
      const unsub = onIagonAuthFailure(listener);
      mockInvoke.mockRejectedValueOnce(new Error('fs denied'));

      await handleIagonError(new Error('{"code":"AUTH_FAILED","message":"x"}'));

      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
    });

    it('unsubscribe stops future notifications', async () => {
      const listener = vi.fn();
      const unsub = onIagonAuthFailure(listener);
      unsub();
      mockInvoke.mockResolvedValueOnce(undefined);
      await handleIagonError(new Error('{"code":"AUTH_FAILED","message":"x"}'));
      expect(listener).not.toHaveBeenCalled();
    });

    it('a listener that throws does not block others', async () => {
      const bad = vi.fn(() => { throw new Error('listener boom'); });
      const good = vi.fn();
      const unsub1 = onIagonAuthFailure(bad);
      const unsub2 = onIagonAuthFailure(good);
      mockInvoke.mockResolvedValueOnce(undefined);
      await handleIagonError(new Error('{"code":"AUTH_FAILED","message":"x"}'));
      expect(bad).toHaveBeenCalled();
      expect(good).toHaveBeenCalled();
      unsub1();
      unsub2();
    });
  });

  describe('hasValidApiKey', () => {
    it('returns false when no key is stored', async () => {
      mockInvoke.mockResolvedValueOnce(null); // get_iagon_api_key
      await expect(hasValidApiKey()).resolves.toBe(false);
      expect(mockVerifyApiKey).not.toHaveBeenCalled();
    });

    it('returns true when the stored key verifies', async () => {
      mockInvoke.mockResolvedValueOnce('abc123'); // get_iagon_api_key
      mockVerifyApiKey.mockResolvedValueOnce(true);
      await expect(hasValidApiKey()).resolves.toBe(true);
    });

    it('returns false AND removes the key when verification fails', async () => {
      mockInvoke.mockResolvedValueOnce('stale-key'); // get_iagon_api_key
      mockVerifyApiKey.mockResolvedValueOnce(false);
      mockInvoke.mockResolvedValueOnce(undefined); // remove_iagon_api_key
      await expect(hasValidApiKey()).resolves.toBe(false);
      expect(mockInvoke).toHaveBeenCalledWith('remove_iagon_api_key');
    });
  });

  describe('getValidApiKey auth-failure event', () => {
    it('fires onIagonAuthFailure listeners when the stored key is rejected', async () => {
      const listener = vi.fn();
      const unsub = onIagonAuthFailure(listener);
      mockInvoke.mockResolvedValueOnce('stale-key'); // get_iagon_api_key
      mockVerifyApiKey.mockResolvedValueOnce(false);
      mockInvoke.mockResolvedValueOnce(undefined); // remove_iagon_api_key

      await expect(getValidApiKey()).resolves.toBeNull();
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
    });
  });
});
