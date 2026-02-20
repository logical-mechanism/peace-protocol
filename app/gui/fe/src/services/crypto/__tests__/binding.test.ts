import { describe, it, expect } from 'vitest';
import { fiatShamirHeuristic, bindingProof, bindingToPlutusJson } from '../binding';
import { createRegister } from '../register';
import { g1Point, scale, combineG1, toInt } from '../bls12381';

describe('binding', () => {
  describe('fiatShamirHeuristic', () => {
    it('is deterministic', () => {
      const register = createRegister(42n);
      const t1 = g1Point(10n);
      const t2 = g1Point(20n);
      const r1 = g1Point(30n);
      const r2 = g1Point(40n);
      const tokenName = 'deadbeef';
      const result1 = fiatShamirHeuristic(register, t1, t2, r1, r2, tokenName);
      const result2 = fiatShamirHeuristic(register, t1, t2, r1, r2, tokenName);
      expect(result1).toBe(result2);
    });

    it('returns 56-char hex string', () => {
      const register = createRegister(42n);
      const t1 = g1Point(10n);
      const t2 = g1Point(20n);
      const r1 = g1Point(30n);
      const r2 = g1Point(40n);
      const tokenName = 'deadbeef';
      const result = fiatShamirHeuristic(register, t1, t2, r1, r2, tokenName);
      expect(result).toHaveLength(56);
      expect(result).toMatch(/^[0-9a-f]+$/);
    });

    it('different tokenName produces different hash', () => {
      const register = createRegister(42n);
      const t1 = g1Point(10n);
      const t2 = g1Point(20n);
      const r1 = g1Point(30n);
      const r2 = g1Point(40n);
      const result1 = fiatShamirHeuristic(register, t1, t2, r1, r2, 'deadbeef');
      const result2 = fiatShamirHeuristic(register, t1, t2, r1, r2, 'cafebabe');
      expect(result1).not.toBe(result2);
    });
  });

  describe('bindingProof', () => {
    it('generates proof with valid field formats', () => {
      const a = 100n;
      const r = 200n;
      const register = createRegister(42n);
      const r1 = g1Point(200n);
      const r2 = combineG1(g1Point(100n), scale(register.u, 200n));
      const tokenName = 'deadbeef';

      const proof = bindingProof(a, r, r1, r2, register, tokenName);

      expect(proof.za.length).toBeGreaterThan(0);
      expect(proof.za).toMatch(/^[0-9a-f]+$/);
      expect(proof.zr.length).toBeGreaterThan(0);
      expect(proof.zr).toMatch(/^[0-9a-f]+$/);
      expect(proof.t1).toHaveLength(96);
      expect(proof.t1).toMatch(/^[0-9a-f]+$/);
      expect(proof.t2).toHaveLength(96);
      expect(proof.t2).toMatch(/^[0-9a-f]+$/);
    });

    it('verification equation 1: [zr]G = t1 + [c]*r1', () => {
      const a = 100n;
      const r = 200n;
      const register = createRegister(42n);
      const r1 = g1Point(200n);
      const r2 = combineG1(g1Point(100n), scale(register.u, 200n));
      const tokenName = 'deadbeef';

      const proof = bindingProof(a, r, r1, r2, register, tokenName);
      const c = toInt(fiatShamirHeuristic(register, proof.t1, proof.t2, r1, r2, tokenName));

      const lhs = g1Point(BigInt('0x' + proof.zr));
      const rhs = combineG1(proof.t1, scale(r1, c));
      expect(lhs).toBe(rhs);
    });

    it('verification equation 2: [za]G + [zr]u = t2 + [c]*r2', () => {
      const a = 100n;
      const r = 200n;
      const register = createRegister(42n);
      const r1 = g1Point(200n);
      const r2 = combineG1(g1Point(100n), scale(register.u, 200n));
      const tokenName = 'deadbeef';

      const proof = bindingProof(a, r, r1, r2, register, tokenName);
      const c = toInt(fiatShamirHeuristic(register, proof.t1, proof.t2, r1, r2, tokenName));

      const lhs = combineG1(g1Point(BigInt('0x' + proof.za)), scale(register.u, BigInt('0x' + proof.zr)));
      const rhs = combineG1(proof.t2, scale(r2, c));
      expect(lhs).toBe(rhs);
    });
  });

  describe('bindingToPlutusJson', () => {
    it('returns correct Plutus JSON structure with 4 fields', () => {
      const a = 100n;
      const r = 200n;
      const register = createRegister(42n);
      const r1 = g1Point(200n);
      const r2 = combineG1(g1Point(100n), scale(register.u, 200n));
      const tokenName = 'deadbeef';

      const proof = bindingProof(a, r, r1, r2, register, tokenName);
      const json = bindingToPlutusJson(proof) as {
        constructor: number;
        fields: { bytes: string }[];
      };
      expect(json.constructor).toBe(0);
      expect(json.fields).toHaveLength(4);
      expect(json.fields[0].bytes).toBe(proof.za);
      expect(json.fields[1].bytes).toBe(proof.zr);
      expect(json.fields[2].bytes).toBe(proof.t1);
      expect(json.fields[3].bytes).toBe(proof.t2);
    });
  });
});
