import { describe, it, expect } from 'vitest';
import { deriveUserSecret } from '../createEncryption';
import { CURVE_ORDER } from '../bls12381';

describe('deriveUserSecret', () => {
  it('is deterministic: same input produces same output', () => {
    const a = deriveUserSecret('aabbccdd');
    const b = deriveUserSecret('aabbccdd');
    expect(a).toBe(b);
  });

  it('different inputs produce different outputs', () => {
    const a = deriveUserSecret('aabbccdd');
    const b = deriveUserSecret('11223344');
    expect(a).not.toBe(b);
  });

  it('output is > 0 and < CURVE_ORDER', () => {
    const sk = deriveUserSecret('deadbeef');
    expect(sk).toBeGreaterThan(0n);
    expect(sk).toBeLessThan(CURVE_ORDER);
  });

  it('empty string input produces a valid scalar (snapshot)', () => {
    const sk = deriveUserSecret('');
    expect(sk).toBeGreaterThan(0n);
    expect(sk).toBeLessThan(CURVE_ORDER);
    // Snapshot: pin the exact value so domain tag changes are caught
    expect(sk).toMatchSnapshot();
  });
});
