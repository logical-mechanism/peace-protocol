/**
 * BLS12-381 Elliptic Curve Operations
 *
 * Ported from Python: src/bls12381.py
 * Uses @noble/curves for cryptographic operations
 */

import { bls12_381 as bls } from '@noble/curves/bls12-381.js';

// Re-export curve order for use in other modules
export const CURVE_ORDER = bls.fields.Fr.ORDER;

/**
 * Generate a cryptographically secure random scalar below the curve order.
 * Equivalent to Python's rng() function.
 */
export function rng(): bigint {
  // Generate random bytes and reduce modulo curve order
  const randomBytes = new Uint8Array(48);
  crypto.getRandomValues(randomBytes);
  const randomBigInt = bytesToBigInt(randomBytes);
  // Ensure non-zero: (randomBigInt mod (order-1)) + 1
  return (randomBigInt % (CURVE_ORDER - 1n)) + 1n;
}

/**
 * Generate a compressed G1 point from scalar multiplication with the generator.
 * Returns 96 hex characters (48 bytes compressed).
 * Equivalent to Python's g1_point(scalar).
 */
export function g1Point(scalar: bigint): string {
  const point = bls.G1.Point.BASE.multiply(scalar);
  return point.toHex(true); // true = compressed
}

/**
 * Generate a compressed G2 point from scalar multiplication with the generator.
 * Returns 192 hex characters (96 bytes compressed).
 * Equivalent to Python's g2_point(scalar).
 */
export function g2Point(scalar: bigint): string {
  const point = bls.G2.Point.BASE.multiply(scalar);
  return point.toHex(true); // true = compressed
}

/**
 * Uncompress a G1 point from hex string.
 * Input: 96 hex chars (48 bytes compressed)
 */
export function uncompressG1(hex: string): typeof bls.G1.Point.BASE {
  return bls.G1.Point.fromHex(hex);
}

/**
 * Uncompress a G2 point from hex string.
 * Input: 192 hex chars (96 bytes compressed)
 */
export function uncompressG2(hex: string): typeof bls.G2.Point.BASE {
  return bls.G2.Point.fromHex(hex);
}

/**
 * Compress a G1 point to hex string.
 */
export function compressG1(point: typeof bls.G1.Point.BASE): string {
  return point.toHex(true);
}

/**
 * Compress a G2 point to hex string.
 */
export function compressG2(point: typeof bls.G2.Point.BASE): string {
  return point.toHex(true);
}

/**
 * Scale a G1 point by a scalar.
 * Equivalent to Python's scale() function for G1 points.
 */
export function scaleG1(elementHex: string, scalar: bigint): string {
  const point = uncompressG1(elementHex);
  const scaled = point.multiply(scalar);
  return compressG1(scaled);
}

/**
 * Scale a G2 point by a scalar.
 */
export function scaleG2(elementHex: string, scalar: bigint): string {
  const point = uncompressG2(elementHex);
  const scaled = point.multiply(scalar);
  return compressG2(scaled);
}

/**
 * Scale a point (auto-detect G1 or G2 based on hex length).
 * G1: 96 hex chars, G2: 192 hex chars
 */
export function scale(elementHex: string, scalar: bigint): string {
  if (elementHex.length === 96) {
    return scaleG1(elementHex, scalar);
  } else if (elementHex.length === 192) {
    return scaleG2(elementHex, scalar);
  } else {
    throw new Error(`Invalid element length: ${elementHex.length}. Expected 96 (G1) or 192 (G2).`);
  }
}

/**
 * Negate a G1 point.
 * Equivalent to Python's invert() function.
 */
export function invertG1(elementHex: string): string {
  const point = uncompressG1(elementHex);
  const negated = point.negate();
  return compressG1(negated);
}

/**
 * Negate a G2 point.
 */
export function invertG2(elementHex: string): string {
  const point = uncompressG2(elementHex);
  const negated = point.negate();
  return compressG2(negated);
}

/**
 * Combine two G1 points using addition.
 * Equivalent to Python's combine() function.
 */
export function combineG1(leftHex: string, rightHex: string): string {
  const left = uncompressG1(leftHex);
  const right = uncompressG1(rightHex);
  const combined = left.add(right);
  return compressG1(combined);
}

/**
 * Combine two G2 points using addition.
 */
export function combineG2(leftHex: string, rightHex: string): string {
  const left = uncompressG2(leftHex);
  const right = uncompressG2(rightHex);
  const combined = left.add(right);
  return compressG2(combined);
}

/**
 * Combine two points (auto-detect G1 or G2).
 */
export function combine(leftHex: string, rightHex: string): string {
  if (leftHex.length !== rightHex.length) {
    throw new Error('Cannot combine points of different types');
  }
  if (leftHex.length === 96) {
    return combineG1(leftHex, rightHex);
  } else if (leftHex.length === 192) {
    return combineG2(leftHex, rightHex);
  } else {
    throw new Error(`Invalid element length: ${leftHex.length}`);
  }
}

/**
 * Interpret a hex digest as a scalar reduced modulo the curve order.
 * Equivalent to Python's to_int() function.
 */
export function toInt(hashDigest: string): bigint {
  const bigInt = BigInt('0x' + hashDigest);
  return bigInt % CURVE_ORDER;
}

/**
 * Encode a non-negative integer as a minimal-length big-endian hex string.
 * Equivalent to Python's from_int() function.
 */
export function fromInt(integer: bigint): string {
  if (integer === 0n) {
    return '00';
  }
  let hex = integer.toString(16);
  // Ensure even length
  if (hex.length % 2 !== 0) {
    hex = '0' + hex;
  }
  return hex;
}

/**
 * Convert bytes (Uint8Array) to BigInt
 */
function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return BigInt('0x' + hex);
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    hex = '0' + hex;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * G1 identity element (point at infinity)
 */
export const G1_IDENTITY = compressG1(bls.G1.Point.ZERO);

/**
 * G2 identity element (point at infinity)
 */
export const G2_IDENTITY = compressG2(bls.G2.Point.ZERO);

/**
 * G1 generator point
 */
export const G1_GENERATOR = g1Point(1n);

/**
 * G2 generator point
 */
export const G2_GENERATOR = g2Point(1n);
