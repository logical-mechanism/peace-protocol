/**
 * Hashing Operations
 *
 * Ported from Python: src/hashing.py
 * Uses @noble/hashes for cryptographic hash functions.
 */

import { blake2b } from '@noble/hashes/blake2.js';
import { bytesToHex, hexToBytes } from './bls12381';

/**
 * Calculate the blake2b-224 hash digest of a hex input string.
 * Equivalent to Python's generate() function.
 *
 * @param inputHex - Hex string to hash (will be converted to bytes first)
 * @returns 56-character hex string (28 bytes = 224 bits)
 */
export function generate(inputHex: string): string {
  const inputBytes = hexToBytes(inputHex);
  const hash = blake2b(inputBytes, { dkLen: 28 }); // 28 bytes = 224 bits
  return bytesToHex(hash);
}

/**
 * Hash a string directly (encodes to UTF-8 first).
 * Convenience function for hashing text.
 *
 * @param input - String to hash
 * @returns 56-character hex string
 */
export function hashString(input: string): string {
  const encoder = new TextEncoder();
  const inputBytes = encoder.encode(input);
  const hash = blake2b(inputBytes, { dkLen: 28 });
  return bytesToHex(hash);
}

/**
 * Hash bytes directly.
 *
 * @param input - Uint8Array to hash
 * @returns 56-character hex string
 */
export function hashBytes(input: Uint8Array): string {
  const hash = blake2b(input, { dkLen: 28 });
  return bytesToHex(hash);
}
