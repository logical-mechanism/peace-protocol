/**
 * Ambient type declarations for @noble/curves and @noble/hashes
 *
 * These declarations allow TypeScript to accept imports from @noble packages
 * in bundler mode where the types might not be automatically resolved.
 */

// Allow any imports from @noble/curves
declare module '@noble/curves/bls12-381.js' {
  const bls12_381: any;
  export { bls12_381 };
}

// Allow any imports from @noble/hashes
declare module '@noble/hashes/blake2.js' {
  export function blake2b(message: Uint8Array, options?: { dkLen?: number; key?: Uint8Array }): Uint8Array;
}

declare module '@noble/hashes/sha3.js' {
  export const sha3_256: any;
}

declare module '@noble/hashes/hkdf.js' {
  export function hkdf(hash: any, ikm: Uint8Array, salt?: Uint8Array, info?: Uint8Array, length?: number): Uint8Array;
}
