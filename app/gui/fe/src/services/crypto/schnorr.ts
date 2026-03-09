/**
 * Schnorr Proof Generation
 *
 * Ported from Python: src/schnorr.py
 * Non-interactive Schnorr proof of knowledge using Fiat-Shamir transform.
 */

import { rng, scale, g1Point, toInt, fromInt, CURVE_ORDER } from './bls12381';
import { generate } from './hashing';
import { SCH_DOMAIN_TAG } from './constants';
import type { Register } from './register';

/**
 * Schnorr proof structure.
 */
export interface SchnorrProof {
  z: string; // Response scalar (hex)
  gr: string; // Commitment point [r]G (G1, 96 hex chars)
}

/**
 * Compute the Fiat-Shamir challenge for the Schnorr proof.
 *
 * Transcript: SCH_DOMAIN_TAG || g || gr || u
 *
 * @param g - Generator point (G1 hex)
 * @param gr - Commitment point (G1 hex)
 * @param u - Public value (G1 hex)
 * @returns Challenge hash as hex string
 */
export function fiatShamirHeuristic(g: string, gr: string, u: string): string {
  return generate(SCH_DOMAIN_TAG + g + gr + u);
}

/**
 * Generate a non-interactive Schnorr proof of knowledge of x for u = [x]g.
 *
 * Protocol:
 * - Commit: r <- random, gr = [r]G
 * - Challenge: c = H(SCH_DOMAIN_TAG || g || gr || u) mod order
 * - Response: z = r + c*x mod order
 *
 * Verifier checks: [z]G == gr + [c]u
 *
 * @param register - Register containing secret x and public (g, u)
 * @returns SchnorrProof with z and gr
 */
export function schnorrProof(register: Register): SchnorrProof {
  // Get values with defaults
  const g = register.g ?? '';
  const u = register.u ?? '';
  const x = register.x ?? 1n;

  // Generate random commitment
  const r = rng();
  const gr = scale(g1Point(1n), r);

  // Compute challenge
  const c = toInt(fiatShamirHeuristic(g, gr, u));

  // Compute response: z = r + c*x mod order
  const z = (r + c * x) % CURVE_ORDER;

  return {
    z: fromInt(z),
    gr,
  };
}

/**
 * Convert a Schnorr proof to Plutus/Aiken JSON format.
 */
export function schnorrToPlutusJson(proof: SchnorrProof): object {
  return {
    constructor: 0,
    fields: [{ bytes: proof.z }, { bytes: proof.gr }],
  };
}
