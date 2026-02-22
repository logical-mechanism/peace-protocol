import { describe, it, expect } from 'vitest';
import { generate, hashString, hashBytes } from '../hashing';
import { hexToBytes } from '../bls12381';

describe('hashing utilities', () => {
  describe('generate', () => {
    it('produces 56-character hex output (224 bits)', () => {
      const input = 'deadbeef';
      const result = generate(input);
      expect(result).toHaveLength(56);
    });

    it('produces consistent output for same input', () => {
      const input = 'abc123';
      const result1 = generate(input);
      const result2 = generate(input);
      expect(result1).toBe(result2);
    });

    it('produces valid hex output', () => {
      const result = generate('test');
      expect(result).toMatch(/^[0-9a-f]+$/);
    });

    it('handles empty hex input', () => {
      const result = generate('');
      expect(result).toHaveLength(56);
    });

    it('handles large hex input', () => {
      const largeInput = 'ff'.repeat(1000);
      const result = generate(largeInput);
      expect(result).toHaveLength(56);
    });
  });

  describe('hashString', () => {
    it('produces 56-character hex output', () => {
      const result = hashString('Hello, World!');
      expect(result).toHaveLength(56);
    });

    it('produces consistent output for same string', () => {
      const str = 'test string';
      const result1 = hashString(str);
      const result2 = hashString(str);
      expect(result1).toBe(result2);
    });

    it('handles empty string', () => {
      const result = hashString('');
      expect(result).toHaveLength(56);
    });

    it('handles unicode characters', () => {
      const result = hashString('🔐 Secret Key');
      expect(result).toHaveLength(56);
    });

    it('handles special characters', () => {
      const result = hashString('<script>alert("xss")</script>');
      expect(result).toHaveLength(56);
    });
  });

  describe('hashBytes', () => {
    it('produces 56-character hex output', () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      const result = hashBytes(bytes);
      expect(result).toHaveLength(56);
    });

    it('produces consistent output for same bytes', () => {
      const bytes = new Uint8Array([10, 20, 30]);
      const result1 = hashBytes(bytes);
      const result2 = hashBytes(bytes);
      expect(result1).toBe(result2);
    });

    it('handles empty bytes array', () => {
      const result = hashBytes(new Uint8Array(0));
      expect(result).toHaveLength(56);
    });

    it('handles large bytes array', () => {
      const largeBytes = new Uint8Array(10000).fill(255);
      const result = hashBytes(largeBytes);
      expect(result).toHaveLength(56);
    });
  });

  describe('consistency between functions', () => {
    it('hashBytes and generate produce same output for equivalent input', () => {
      const hexInput = 'deadbeef';
      const bytes = hexToBytes(hexInput);

      const resultGenerate = generate(hexInput);
      const resultHashBytes = hashBytes(bytes);

      expect(resultGenerate).toBe(resultHashBytes);
    });
  });
});
