import { describe, it, expect } from 'vitest';
import { fiatShamirHeuristic, schnorrProof, schnorrToPlutusJson } from '../schnorr';
import { createRegister } from '../register';
import { g1Point, toInt, scale, combineG1 } from '../bls12381';

describe('schnorr', () => {
  describe('fiatShamirHeuristic', () => {
    it('is deterministic (same inputs produce same output)', () => {
      const g = g1Point(1n);
      const gr = g1Point(7n);
      const u = g1Point(42n);
      const result1 = fiatShamirHeuristic(g, gr, u);
      const result2 = fiatShamirHeuristic(g, gr, u);
      expect(result1).toBe(result2);
    });

    it('returns 56-char hex string', () => {
      const g = g1Point(1n);
      const gr = g1Point(7n);
      const u = g1Point(42n);
      const result = fiatShamirHeuristic(g, gr, u);
      expect(result).toHaveLength(56);
      expect(result).toMatch(/^[0-9a-f]+$/);
    });

    it('different inputs produce different output', () => {
      const g = g1Point(1n);
      const u = g1Point(42n);
      const result1 = fiatShamirHeuristic(g, g1Point(7n), u);
      const result2 = fiatShamirHeuristic(g, g1Point(8n), u);
      expect(result1).not.toBe(result2);
    });
  });

  describe('schnorrProof', () => {
    it('generates proof with valid format', () => {
      const register = createRegister(42n);
      const proof = schnorrProof(register);
      expect(proof.gr).toHaveLength(96);
      expect(proof.gr).toMatch(/^[0-9a-f]+$/);
      expect(proof.z.length).toBeGreaterThan(0);
      expect(proof.z).toMatch(/^[0-9a-f]+$/);
    });

    it('verification equation holds: [z]G === combineG1(gr, scale(u, c))', () => {
      const register = createRegister(42n);
      const proof = schnorrProof(register);

      const z = BigInt('0x' + proof.z);
      const c = toInt(fiatShamirHeuristic(register.g, proof.gr, register.u));

      const lhs = g1Point(z);
      const rhs = combineG1(proof.gr, scale(register.u, c));
      expect(lhs).toBe(rhs);
    });
  });

  describe('schnorrToPlutusJson', () => {
    it('returns correct Plutus JSON structure', () => {
      const register = createRegister(42n);
      const proof = schnorrProof(register);
      const json = schnorrToPlutusJson(proof) as {
        constructor: number;
        fields: { bytes: string }[];
      };
      expect(json.constructor).toBe(0);
      expect(json.fields).toHaveLength(2);
      expect(json.fields[0].bytes).toBe(proof.z);
      expect(json.fields[1].bytes).toBe(proof.gr);
    });
  });
});
