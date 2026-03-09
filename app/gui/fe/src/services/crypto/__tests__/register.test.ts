import { describe, it, expect } from 'vitest';
import { createRegister, createPublicRegister, scaleRegister, registerToPlutusJson } from '../register';
import { g1Point, scale, G1_GENERATOR } from '../bls12381';

describe('register', () => {
  describe('createRegister', () => {
    it('creates a register with correct g, u, and x', () => {
      const reg = createRegister(42n);
      expect(reg.g).toBe(G1_GENERATOR);
      expect(reg.u).toBe(g1Point(42n));
      expect(reg.x).toBe(42n);
    });
  });

  describe('createPublicRegister', () => {
    it('creates a public register without x', () => {
      const g = 'aa'.repeat(48);
      const u = 'bb'.repeat(48);
      const reg = createPublicRegister(g, u);
      expect(reg.x).toBeUndefined();
      expect(reg.g).toBe(g);
      expect(reg.u).toBe(u);
    });
  });

  describe('scaleRegister', () => {
    it('scales the register public value by a scalar', () => {
      const reg = createRegister(5n);
      const result = scaleRegister(reg, 3n);
      const expected = scale(g1Point(5n), 3n);
      expect(result).toBe(expected);
    });
  });

  describe('registerToPlutusJson', () => {
    it('returns correct Plutus JSON structure', () => {
      const reg = createRegister(42n);
      const json = registerToPlutusJson(reg) as {
        constructor: number;
        fields: { bytes: string }[];
      };
      expect(json.constructor).toBe(0);
      expect(json.fields).toHaveLength(2);
      expect(json.fields[0].bytes).toBe(reg.g);
      expect(json.fields[1].bytes).toBe(reg.u);
    });
  });

  describe('determinism', () => {
    it('createRegister(42n) called twice returns identical g and u', () => {
      const reg1 = createRegister(42n);
      const reg2 = createRegister(42n);
      expect(reg1.g).toBe(reg2.g);
      expect(reg1.u).toBe(reg2.u);
    });
  });
});
