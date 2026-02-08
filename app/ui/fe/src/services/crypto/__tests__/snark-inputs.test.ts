/**
 * Tests that verify TypeScript BLS12-381 operations match Python test values.
 *
 * These values come from app/tests/test_snark.py which uses py_ecc.
 * The SNARK circuit (vw0w1Circuit) expects:
 *   w0 == [hk]G  where hk = mimc(e([a]G, H0))
 *   w1 == [a]G + [r]*v
 *
 * We verify that g1Point, scale, combine, and toInt produce identical output
 * to the Python reference implementation.
 */

import { describe, it, expect } from 'vitest';
import {
  g1Point,
  scale,
  combine,
  toInt,
} from '../bls12381';

// Test values from app/tests/test_snark.py
const a0 = 44203n;
const r0 = 12345n;
const x0 = 54321n; // bidder's secret

// Expected hk from Python: gt_to_hash(a0) = "072b7c71..."
// This is computed by WASM (pairing + MiMC), not by noble-curves.
// We use the known output here to test the downstream g1Point/scale/combine.
const hkHex = '072b7c71e92483a846022edb38d97952301671d276307b6d53b092ee3b88610b';

// Expected points from Python test_snark.py / test-worker.html
const expectedQA = 'b4a9640fa75aef0c3f3939ec56574c640862cda95030f92269d8ead5c82e83229c0d1ad2b59dbacb86e97e0117a27cca';
const expectedV  = '821285b97f9c0420a2d37951edbda3d7c3ebac40c6f194faa0256f6e569eba49829cd69c27f1dd9df2dd83bac1f5aa49';
const expectedW0 = 'a1430f9e40e13f50164c1b0f6248289e09a281d2c80ce2ccea81800c62bc4afa4f9235c727f9837368b207b6948a2aad';
const expectedW1 = '8ac69bdd182386def9f70b444794fa6d588182ddaccdffc26163fe415424ec374c672dfde52d875863118e6ef892bbac';

describe('SNARK input computation matches Python', () => {
  it('g1Point(a0) matches Python g1_point(44203)', () => {
    const qa = g1Point(a0);
    expect(qa).toBe(expectedQA);
  });

  it('g1Point(x0) matches Python g1_point(54321) - bidder V', () => {
    const v = g1Point(x0);
    expect(v).toBe(expectedV);
  });

  it('g1Point(toInt(hk)) matches Python w0 = g1_point(to_int(gt_to_hash(a0)))', () => {
    const hk = toInt(hkHex);
    const w0 = g1Point(hk);
    expect(w0).toBe(expectedW0);
  });

  it('combine(g1Point(a0), scale(v, r0)) matches Python w1', () => {
    const v = expectedV;
    const qa = g1Point(a0);
    const vr = scale(v, r0);
    const w1 = combine(qa, vr);
    expect(w1).toBe(expectedW1);
  });

  it('toInt produces correct scalar from hk hex', () => {
    const hk = toInt(hkHex);
    // Verify it's a valid non-zero scalar
    expect(hk).toBeGreaterThan(0n);
    // Verify the hex conversion is consistent
    expect(hk).toBe(BigInt('0x' + hkHex));
  });

  it('all SNARK public inputs are valid compressed G1 points (96 hex chars)', () => {
    const hk = toInt(hkHex);
    const v = g1Point(x0);
    const w0 = g1Point(hk);
    const w1 = combine(g1Point(a0), scale(v, r0));

    for (const [name, point] of [['V', v], ['W0', w0], ['W1', w1]]) {
      expect(point, `${name} should be 96 hex chars`).toHaveLength(96);
      expect(point, `${name} should be valid hex`).toMatch(/^[0-9a-f]+$/);
    }
  });
});
