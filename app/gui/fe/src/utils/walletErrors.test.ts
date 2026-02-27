import { describe, it, expect } from 'vitest';
import { parseUnlockError } from './walletErrors';
import type { UnlockErrorInfo } from './walletErrors';

describe('parseUnlockError', () => {
  describe('incorrect password', () => {
    it('matches exact "Incorrect password" string', () => {
      const result = parseUnlockError('Incorrect password');
      expect(result.title).toBe('Incorrect password');
      expect(result.suggestion).toContain('check your password');
      expect(result.raw).toBe('Incorrect password');
    });
  });

  describe('corrupted wallet file', () => {
    it('matches "Invalid wallet file"', () => {
      const result = parseUnlockError('Invalid wallet file: unexpected format');
      expect(result.title).toBe('Wallet file corrupted');
      expect(result.suggestion).toContain('recovery phrase');
    });

    it('matches "bad nonce"', () => {
      const result = parseUnlockError('Decryption failed: bad nonce size');
      expect(result.title).toBe('Wallet file corrupted');
    });

    it('matches "not valid UTF-8"', () => {
      const result = parseUnlockError('Output is not valid UTF-8');
      expect(result.title).toBe('Wallet file corrupted');
    });
  });

  describe('file read failure', () => {
    it('matches "Failed to read wallet file"', () => {
      const result = parseUnlockError('Failed to read wallet file: permission denied');
      expect(result.title).toBe('Cannot read wallet file');
      expect(result.suggestion).toContain('permission');
    });
  });

  describe('key derivation failure', () => {
    it('matches "Key derivation failed"', () => {
      const result = parseUnlockError('Key derivation failed: out of memory');
      expect(result.title).toBe('Key derivation failed');
      expect(result.suggestion).toContain('restarting');
    });
  });

  describe('generic fallback', () => {
    it('returns generic title for unknown error string', () => {
      const result = parseUnlockError('Something completely unexpected');
      expect(result.title).toBe('Unlock failed');
      expect(result.suggestion).toBe('Something completely unexpected');
      expect(result.raw).toBe('Something completely unexpected');
    });
  });

  describe('input type handling', () => {
    it('handles Error objects', () => {
      const result = parseUnlockError(new Error('Incorrect password'));
      expect(result.title).toBe('Incorrect password');
    });

    it('handles non-string/non-Error values', () => {
      const result = parseUnlockError(42);
      expect(result.title).toBe('Unlock failed');
      expect(result.raw).toBe('42');
    });

    it('handles null', () => {
      const result = parseUnlockError(null);
      expect(result.title).toBe('Unlock failed');
      expect(result.raw).toBe('null');
    });

    it('handles undefined', () => {
      const result = parseUnlockError(undefined);
      expect(result.title).toBe('Unlock failed');
      expect(result.raw).toBe('undefined');
    });
  });

  it('always returns a complete UnlockErrorInfo shape', () => {
    const result: UnlockErrorInfo = parseUnlockError('anything');
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('suggestion');
    expect(result).toHaveProperty('raw');
  });
});
