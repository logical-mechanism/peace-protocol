/**
 * Register (Public Key) Management
 *
 * Ported from Python: src/register.py
 * Represents a BLS12-381 G1 public key pair (generator, public value).
 */

import { g1Point, scale } from './bls12381';

/**
 * Register represents a discrete-log style public key pair over BLS12-381 G1.
 *
 * g : generator (G1 element, 96 hex chars)
 * u : public value (G1 element), typically u = [x]g
 * x : secret scalar (optional, only known to creator)
 */
export interface Register {
  x?: bigint; // Secret scalar (optional)
  g: string; // Generator encoding (G1, 96 hex chars)
  u: string; // Public value encoding (G1, 96 hex chars)
}

/**
 * Create a new Register from a secret scalar.
 * The generator is always the canonical G1 generator.
 * Public value u = [x]G1
 *
 * @param x - Secret scalar
 * @returns Register with g, u, and x
 */
export function createRegister(x: bigint): Register {
  const g = g1Point(1n); // Canonical G1 generator
  const u = g1Point(x); // u = [x]G1
  return { x, g, u };
}

/**
 * Create a public-only Register from explicit (g, u) values.
 * Used when we only have public information (no secret).
 *
 * @param g - Generator (G1 hex, 96 chars)
 * @param u - Public value (G1 hex, 96 chars)
 * @returns Register without x
 */
export function createPublicRegister(g: string, u: string): Register {
  return { g, u };
}

/**
 * Scale the register's public value u by a scalar.
 * Returns [k]u as a G1 point.
 *
 * @param register - The register
 * @param k - Scalar to multiply by
 * @returns Scaled G1 point (96 hex chars)
 */
export function scaleRegister(register: Register, k: bigint): string {
  return scale(register.u, k);
}

/**
 * Convert a Register to Plutus/Aiken JSON format for on-chain storage.
 */
export function registerToPlutusJson(register: Register): object {
  return {
    constructor: 0,
    fields: [{ bytes: register.g }, { bytes: register.u }],
  };
}
