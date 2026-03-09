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
  scale,
  combine,
  combineG1,
  combineG2,
  invertG1,
  invertG2,
  rng,
  G1_IDENTITY,
  G2_IDENTITY,
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

  });

  describe('g2Point', () => {
    it('generates valid G2 point (192 hex chars)', () => {
      const point = g2Point(1n);
      expect(point).toHaveLength(192);
      expect(point).toMatch(/^[0-9a-f]+$/);
    });

    it('generates different output for different scalars', () => {
      const point1 = g2Point(1n);
      const point2 = g2Point(2n);
      expect(point1).not.toBe(point2);
    });
  });

  describe('scale', () => {
    it('throws on invalid length hex', () => {
      const invalidHex = 'aa'.repeat(25); // 50 chars, neither 96 nor 192
      expect(() => scale(invalidHex, 3n)).toThrow('Invalid element length');
    });

    it('scales a G1 point correctly (96 hex chars result)', () => {
      const g1 = g1Point(5n);
      const result = scale(g1, 3n);
      expect(result).toHaveLength(96);
      expect(result).toMatch(/^[0-9a-f]+$/);
      // [3]*[5]G1 should equal [15]G1
      expect(result).toBe(g1Point(15n));
    });

    it('scales a G2 point correctly (192 hex chars result)', () => {
      const g2 = g2Point(5n);
      const result = scale(g2, 3n);
      expect(result).toHaveLength(192);
      expect(result).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('combine', () => {
    it('throws on mismatched lengths', () => {
      const g1 = g1Point(2n); // 96 chars
      const g2 = g2Point(2n); // 192 chars
      expect(() => combine(g1, g2)).toThrow('Cannot combine points of different types');
    });

    it('throws on invalid length (both 50 chars)', () => {
      const a = 'aa'.repeat(25); // 50 chars
      const b = 'bb'.repeat(25); // 50 chars
      expect(() => combine(a, b)).toThrow('Invalid element length');
    });
  });

  describe('combine G2 dispatch', () => {
    it('combine() dispatches to combineG2 for 192-char inputs', () => {
      const A = g2Point(2n);
      const B = g2Point(3n);
      const viaDispatch = combine(A, B);
      const viaDirect = combineG2(A, B);
      expect(viaDispatch).toBe(viaDirect);
    });
  });

  describe('combineG1', () => {
    it('is associative: combine(A, combine(B, C)) === combine(combine(A, B), C)', () => {
      const A = g1Point(2n);
      const B = g1Point(3n);
      const C = g1Point(5n);
      const lhs = combineG1(A, combineG1(B, C));
      const rhs = combineG1(combineG1(A, B), C);
      expect(lhs).toBe(rhs);
    });
  });

  describe('invertG1', () => {
    it('combine(P, invertG1(P)) === G1_IDENTITY', () => {
      const P = g1Point(42n);
      const result = combineG1(P, invertG1(P));
      expect(result).toBe(G1_IDENTITY);
    });
  });

  describe('invertG2', () => {
    it('combine(Q, invertG2(Q)) === G2_IDENTITY', () => {
      const Q = g2Point(42n);
      const result = combineG2(Q, invertG2(Q));
      expect(result).toBe(G2_IDENTITY);
    });
  });

  describe('rng', () => {
    it('returns different values on two calls', () => {
      const a = rng();
      const b = rng();
      expect(a).not.toBe(b);
    });

    it('result > 0n', () => {
      const value = rng();
      expect(value > 0n).toBe(true);
    });

    it('result < CURVE_ORDER', () => {
      const value = rng();
      expect(value < CURVE_ORDER).toBe(true);
    });
  });

  describe('identity elements', () => {
    it('G1_IDENTITY has length 96 and is valid hex', () => {
      expect(G1_IDENTITY).toHaveLength(96);
      expect(G1_IDENTITY).toMatch(/^[0-9a-f]+$/);
    });

    it('G2_IDENTITY has length 192 and is valid hex', () => {
      expect(G2_IDENTITY).toHaveLength(192);
      expect(G2_IDENTITY).toMatch(/^[0-9a-f]+$/);
    });
  });
});
