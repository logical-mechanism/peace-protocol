import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  addressToHex,
  getStoredApiKey,
  isIagonConnected,
  disconnectIagon,
  connectIagon,
  getValidApiKey,
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
});
