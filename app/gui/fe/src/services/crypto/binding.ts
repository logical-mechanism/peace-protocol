/**
 * Binding Proof Generation
 *
 * Ported from Python: src/binding.py
 * Schnorr-style binding proof tying secrets (a, r) to a transcript.
 */

import { rng, scale, g1Point, toInt, fromInt, combineG1, CURVE_ORDER } from './bls12381';
import { generate } from './hashing';
import { BND_DOMAIN_TAG } from './constants';
import type { Register } from './register';

/**
 * Binding proof structure.
 */
export interface BindingProof {
  za: string; // Response for a (hex)
  zr: string; // Response for r (hex)
  t1: string; // Commitment point 1 (G1, 96 hex chars)
  t2: string; // Commitment point 2 (G1, 96 hex chars)
}

/**
 * Compute the Fiat-Shamir challenge for the binding proof.
 *
 * Transcript: BND_DOMAIN_TAG || g || u || t1 || t2 || r1 || r2 || tokenName
 *
 * @param register - Register with public (g, u)
 * @param t1 - Commitment term 1
 * @param t2 - Commitment term 2
 * @param r1 - Statement term 1
 * @param r2 - Statement term 2
 * @param tokenName - Token name for transcript binding
 * @returns Challenge hash as hex string
 */
export function fiatShamirHeuristic(
  register: Register,
  t1: string,
  t2: string,
  r1: string,
  r2: string,
  tokenName: string
): string {
  const g = register.g ?? '';
  const u = register.u ?? '';
  return generate(BND_DOMAIN_TAG + g + u + t1 + t2 + r1 + r2 + tokenName);
}

/**
 * Generate a Schnorr-style binding proof for secrets (a, r).
 *
 * Protocol:
 * - Sample random rho, alpha
 * - Compute t1 = [rho]G, t2 = [alpha]G + [rho]u
 * - Challenge c = H(transcript)
 * - Responses: zr = rho + c*r, za = alpha + c*a
 *
 * @param a - Secret scalar a
 * @param r - Secret scalar r
 * @param r1 - Public statement term
 * @param r2 - Public statement term
 * @param register - Register with public value u
 * @param tokenName - Token name for transcript binding
 * @returns BindingProof with za, zr, t1, t2
 */
export function bindingProof(
  a: bigint,
  r: bigint,
  r1: string,
  r2: string,
  register: Register,
  tokenName: string
): BindingProof {
  const rho = rng();
  const alpha = rng();

  const u = register.u ?? '';

  // Compute commitments
  const t1 = scale(g1Point(1n), rho);
  const t2 = combineG1(scale(g1Point(1n), alpha), scale(u, rho));

  // Compute challenge
  const c = toInt(fiatShamirHeuristic(register, t1, t2, r1, r2, tokenName));

  // Compute responses
  const zr = (rho + c * r) % CURVE_ORDER;
  const za = (alpha + c * a) % CURVE_ORDER;

  return {
    za: fromInt(za),
    zr: fromInt(zr),
    t1,
    t2,
  };
}

/**
 * Convert a binding proof to Plutus/Aiken JSON format.
 */
export function bindingToPlutusJson(proof: BindingProof): object {
  return {
    constructor: 0,
    fields: [
      { bytes: proof.za },
      { bytes: proof.zr },
      { bytes: proof.t1 },
      { bytes: proof.t2 },
    ],
  };
}
