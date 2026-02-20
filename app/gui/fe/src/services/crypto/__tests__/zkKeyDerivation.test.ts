import { describe, it, expect, beforeEach } from 'vitest';
import { setPaymentKeyHex, getPaymentKeyHex, deriveZkSecret } from '../zkKeyDerivation';
import { CURVE_ORDER } from '../bls12381';

describe('zkKeyDerivation', () => {
  beforeEach(() => {
    setPaymentKeyHex(null);
  });

  describe('set/get roundtrip', () => {
    it('stores and retrieves the payment key hex', () => {
      setPaymentKeyHex('aabbcc');
      expect(getPaymentKeyHex()).toBe('aabbcc');
    });
  });

  describe('set null', () => {
    it('clears the payment key hex', () => {
      setPaymentKeyHex('aabbcc');
      setPaymentKeyHex(null);
      expect(getPaymentKeyHex()).toBeNull();
    });
  });

  describe('deriveZkSecret', () => {
    it('is deterministic (same input produces same result)', () => {
      const result1 = deriveZkSecret('aabb');
      const result2 = deriveZkSecret('aabb');
      expect(result1).toBe(result2);
    });

    it('different inputs produce different results', () => {
      const result1 = deriveZkSecret('aabb');
      const result2 = deriveZkSecret('ccdd');
      expect(result1).not.toBe(result2);
    });

    it('result > 0n', () => {
      const result = deriveZkSecret('aabb');
      expect(result > 0n).toBe(true);
    });

    it('result < CURVE_ORDER', () => {
      const result = deriveZkSecret('aabb');
      expect(result < CURVE_ORDER).toBe(true);
    });
  });

  describe('state isolation', () => {
    it('setting to null after setting a value clears state', () => {
      setPaymentKeyHex('abc');
      setPaymentKeyHex(null);
      expect(getPaymentKeyHex()).toBeNull();
    });
  });
});
