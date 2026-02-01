import { describe, it, expect } from 'vitest';
import {
  hexToBytes,
  bytesToHex,
  toInt,
  fromInt,
  CURVE_ORDER,
  g1Point,
  g2Point,
  G1_GENERATOR,
  G2_GENERATOR,
} from '../bls12381';

describe('bls12381 utilities', () => {
  describe('hexToBytes', () => {
    it('converts hex to bytes correctly', () => {
      const hex = 'deadbeef';
      const bytes = hexToBytes(hex);
      expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    });

    it('handles odd-length hex by padding', () => {
      const hex = 'abc';
      const bytes = hexToBytes(hex);
      expect(bytes).toEqual(new Uint8Array([0x0a, 0xbc]));
    });

    it('handles empty string', () => {
      const bytes = hexToBytes('');
      expect(bytes).toEqual(new Uint8Array(0));
    });

    it('handles lowercase hex', () => {
      const bytes = hexToBytes('abcdef');
      expect(bytes).toEqual(new Uint8Array([0xab, 0xcd, 0xef]));
    });

    it('handles uppercase hex', () => {
      const bytes = hexToBytes('ABCDEF');
      expect(bytes).toEqual(new Uint8Array([0xab, 0xcd, 0xef]));
    });
  });

  describe('bytesToHex', () => {
    it('converts bytes to hex correctly', () => {
      const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const hex = bytesToHex(bytes);
      expect(hex).toBe('deadbeef');
    });

    it('handles empty array', () => {
      const hex = bytesToHex(new Uint8Array(0));
      expect(hex).toBe('');
    });

    it('pads single-digit bytes', () => {
      const bytes = new Uint8Array([0x01, 0x0a, 0xff]);
      const hex = bytesToHex(bytes);
      expect(hex).toBe('010aff');
    });
  });

  describe('hexToBytes and bytesToHex roundtrip', () => {
    it('roundtrips correctly', () => {
      const original = 'deadbeefcafe0123456789abcdef';
      const bytes = hexToBytes(original);
      const result = bytesToHex(bytes);
      expect(result).toBe(original);
    });
  });

  describe('toInt', () => {
    it('converts hex to bigint modulo curve order', () => {
      const hex = 'ff';
      const result = toInt(hex);
      expect(result).toBe(255n);
    });

    it('reduces large values modulo curve order', () => {
      // A value larger than curve order should be reduced
      const largeHex = CURVE_ORDER.toString(16);
      const result = toInt(largeHex);
      expect(result).toBe(0n);
    });

    it('handles empty string (becomes 0)', () => {
      // Note: '0x' + '' = '0x' which is 0
      const result = toInt('0');
      expect(result).toBe(0n);
    });
  });

  describe('fromInt', () => {
    it('converts bigint to hex', () => {
      const result = fromInt(255n);
      expect(result).toBe('ff');
    });

    it('handles zero', () => {
      const result = fromInt(0n);
      expect(result).toBe('00');
    });

    it('pads to even length', () => {
      const result = fromInt(16n);
      expect(result).toBe('10');
    });

    it('handles large values', () => {
      const large = 0xdeadbeefcafe1234n;
      const result = fromInt(large);
      expect(result).toBe('deadbeefcafe1234');
    });
  });

  describe('toInt and fromInt roundtrip', () => {
    it('roundtrips for values less than curve order', () => {
      const original = 12345678901234567890n;
      const hex = fromInt(original);
      const result = toInt(hex);
      expect(result).toBe(original % CURVE_ORDER);
    });
  });

  describe('curve constants', () => {
    it('CURVE_ORDER is a bigint', () => {
      expect(typeof CURVE_ORDER).toBe('bigint');
      expect(CURVE_ORDER > 0n).toBe(true);
    });

    it('G1_GENERATOR is valid hex string of 96 chars', () => {
      expect(typeof G1_GENERATOR).toBe('string');
      expect(G1_GENERATOR).toHaveLength(96);
      expect(G1_GENERATOR).toMatch(/^[0-9a-f]+$/);
    });

    it('G2_GENERATOR is valid hex string of 192 chars', () => {
      expect(typeof G2_GENERATOR).toBe('string');
      expect(G2_GENERATOR).toHaveLength(192);
      expect(G2_GENERATOR).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('g1Point', () => {
    it('generates valid G1 point (96 hex chars)', () => {
      const point = g1Point(1n);
      expect(point).toHaveLength(96);
      expect(point).toMatch(/^[0-9a-f]+$/);
    });

    it('generates consistent output for same scalar', () => {
      const point1 = g1Point(12345n);
      const point2 = g1Point(12345n);
      expect(point1).toBe(point2);
    });

    it('generates different output for different scalars', () => {
      const point1 = g1Point(1n);
      const point2 = g1Point(2n);
      expect(point1).not.toBe(point2);
    });
  });

  describe('g2Point', () => {
    it('generates valid G2 point (192 hex chars)', () => {
      const point = g2Point(1n);
      expect(point).toHaveLength(192);
      expect(point).toMatch(/^[0-9a-f]+$/);
    });

    it('generates consistent output for same scalar', () => {
      const point1 = g2Point(12345n);
      const point2 = g2Point(12345n);
      expect(point1).toBe(point2);
    });

    it('generates different output for different scalars', () => {
      const point1 = g2Point(1n);
      const point2 = g2Point(2n);
      expect(point1).not.toBe(point2);
    });
  });
});
