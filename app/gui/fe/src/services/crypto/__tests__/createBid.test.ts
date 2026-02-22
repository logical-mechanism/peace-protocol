import { describe, it, expect } from 'vitest';
import { createBidArtifacts, verifyBidArtifacts } from '../createBid';
import { G1_GENERATOR } from '../bls12381';

describe('createBidArtifacts', () => {
  it('returns all expected fields', () => {
    const artifacts = createBidArtifacts();
    expect(artifacts.b).toBeDefined();
    expect(typeof artifacts.b).toBe('bigint');
    expect(artifacts.register).toBeDefined();
    expect(artifacts.schnorr).toBeDefined();
    expect(artifacts.plutusJson).toBeDefined();
    expect(artifacts.plutusJson.register).toBeDefined();
    expect(artifacts.plutusJson.schnorr).toBeDefined();
  });

  it('two calls produce different secrets', () => {
    const a = createBidArtifacts();
    const b = createBidArtifacts();
    expect(a.b).not.toBe(b.b);
  });

  it('register uses the canonical G1 generator', () => {
    const artifacts = createBidArtifacts();
    expect(artifacts.register.g).toBe(G1_GENERATOR);
    expect(artifacts.register.g).toHaveLength(96);
  });

  it('plutusJson structures are constructor 0', () => {
    const artifacts = createBidArtifacts();
    const reg = artifacts.plutusJson.register as { constructor: number; fields: unknown[] };
    const sch = artifacts.plutusJson.schnorr as { constructor: number; fields: unknown[] };
    expect(reg.constructor).toBe(0);
    expect(sch.constructor).toBe(0);
  });
});

describe('verifyBidArtifacts', () => {
  it('returns true for valid artifacts', () => {
    const artifacts = createBidArtifacts();
    expect(verifyBidArtifacts(artifacts)).toBe(true);
  });

  it('returns false when register.u is tampered', () => {
    const artifacts = createBidArtifacts();
    // Mutate u to a different point — verifier should detect mismatch
    const other = createBidArtifacts();
    artifacts.register = { ...artifacts.register, u: other.register.u };
    expect(verifyBidArtifacts(artifacts)).toBe(false);
  });
});
