import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getCurrentNetwork,
  getCardanoScanBaseUrl,
  getTransactionUrl,
  getAddressUrl,
  getTokenUrl,
  isValidTxHash,
} from './network';

describe('network utilities', () => {
  const originalWindow = global.window;

  afterEach(() => {
    // Restore window
    global.window = originalWindow;
  });

  describe('getCurrentNetwork', () => {
    it('returns preprod for localhost', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'localhost' },
        writable: true,
      });
      expect(getCurrentNetwork()).toBe('preprod');
    });

    it('returns preprod for 127.0.0.1', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: '127.0.0.1' },
        writable: true,
      });
      expect(getCurrentNetwork()).toBe('preprod');
    });

    it('returns preprod for preprod subdomain', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'preprod.example.com' },
        writable: true,
      });
      expect(getCurrentNetwork()).toBe('preprod');
    });

    it('returns mainnet for www subdomain', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'www.example.com' },
        writable: true,
      });
      expect(getCurrentNetwork()).toBe('mainnet');
    });

    it('returns mainnet for no subdomain', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'example.com' },
        writable: true,
      });
      expect(getCurrentNetwork()).toBe('mainnet');
    });
  });

  describe('getCardanoScanBaseUrl', () => {
    it('returns preprod URL for preprod network', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'localhost' },
        writable: true,
      });
      expect(getCardanoScanBaseUrl()).toBe('https://preprod.cardanoscan.io');
    });

    it('returns mainnet URL for mainnet network', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'example.com' },
        writable: true,
      });
      expect(getCardanoScanBaseUrl()).toBe('https://cardanoscan.io');
    });
  });

  describe('getTransactionUrl', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'localhost' },
        writable: true,
      });
    });

    it('generates correct transaction URL', () => {
      const txHash = 'abc123def456789012345678901234567890123456789012345678901234';
      expect(getTransactionUrl(txHash)).toBe(
        `https://preprod.cardanoscan.io/transaction/${txHash}`
      );
    });
  });

  describe('getAddressUrl', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'localhost' },
        writable: true,
      });
    });

    it('generates correct address URL', () => {
      const address = 'addr_test1qz...';
      expect(getAddressUrl(address)).toBe(
        `https://preprod.cardanoscan.io/address/${address}`
      );
    });
  });

  describe('getTokenUrl', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'localhost' },
        writable: true,
      });
    });

    it('generates correct token URL with policy ID only', () => {
      const policyId = 'abc123';
      expect(getTokenUrl(policyId)).toBe(
        `https://preprod.cardanoscan.io/token/${policyId}`
      );
    });

    it('generates correct token URL with asset name', () => {
      const policyId = 'abc123';
      const assetName = 'def456';
      expect(getTokenUrl(policyId, assetName)).toBe(
        `https://preprod.cardanoscan.io/token/${policyId}${assetName}`
      );
    });
  });

  describe('isValidTxHash', () => {
    it('returns true for valid 64-char hex string', () => {
      const validHash = 'a'.repeat(64);
      expect(isValidTxHash(validHash)).toBe(true);
    });

    it('returns true for mixed case hex', () => {
      const validHash = 'aAbBcCdDeEfF0123456789abcdef0123456789abcdef0123456789abcdef0123';
      expect(isValidTxHash(validHash)).toBe(true);
    });

    it('returns false for too short string', () => {
      expect(isValidTxHash('abc123')).toBe(false);
    });

    it('returns false for too long string', () => {
      expect(isValidTxHash('a'.repeat(65))).toBe(false);
    });

    it('returns false for non-hex characters', () => {
      expect(isValidTxHash('g'.repeat(64))).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isValidTxHash('')).toBe(false);
    });
  });
});
