/**
 * ECIES Encryption (AES-256-GCM with HKDF-SHA3-256)
 *
 * Ported from Python: src/ecies.py
 * Uses WebCrypto API for AES-GCM and @noble/hashes for SHA3.
 */

import { sha3_256 } from '@noble/hashes/sha3.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hexToBytes, bytesToHex } from './bls12381';
import { generate } from './hashing';
import { SLT_DOMAIN_TAG, KEM_DOMAIN_TAG, AAD_DOMAIN_TAG, MSG_DOMAIN_TAG } from './constants';

/**
 * Capsule structure containing encrypted data.
 */
export interface Capsule {
  nonce: string; // 12 bytes (24 hex chars)
  aad: string; // Associated data (56 hex chars - blake2b-224)
  ct: string; // Ciphertext + GCM tag (variable length)
}

/**
 * Encrypt a UTF-8 message using AES-256-GCM with HKDF-derived key.
 *
 * Key derivation:
 *   salt = generate(SLT_DOMAIN_TAG + context + KEM_DOMAIN_TAG)
 *   aes_key = HKDF-SHA3-256(salt, kem, KEM_DOMAIN_TAG, 32 bytes)
 *
 * Associated data:
 *   aad = generate(AAD_DOMAIN_TAG + context + MSG_DOMAIN_TAG)
 *
 * @param context - Domain-separated context (typically r1 point)
 * @param kem - Key encapsulation material (hex)
 * @param msg - Plaintext message (UTF-8 string)
 * @returns Capsule with nonce, aad, ciphertext
 */
export async function encrypt(context: string, kem: string, msg: string): Promise<Capsule> {
  // Derive salt
  const salt = generate(SLT_DOMAIN_TAG + context + KEM_DOMAIN_TAG);
  const saltBytes = new TextEncoder().encode(salt);

  // Derive AES key using HKDF with SHA3-256
  const kemBytes = hexToBytes(kem);
  const infoBytes = new TextEncoder().encode(
    hexToHumanReadable(KEM_DOMAIN_TAG)
  );

  // HKDF using @noble/hashes
  const aesKeyBytes = hkdf(sha3_256, kemBytes, saltBytes, infoBytes, 32);

  // Compute AAD
  const aad = generate(AAD_DOMAIN_TAG + context + MSG_DOMAIN_TAG);
  const aadBytes = hexToBytes(aad);

  // Generate random nonce (12 bytes for GCM)
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);

  // Import AES key (ensure proper ArrayBuffer)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(aesKeyBytes).buffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  // Encrypt (use slice().buffer to get proper ArrayBuffer)
  const msgBytes = new TextEncoder().encode(msg);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(nonce).buffer,
      additionalData: new Uint8Array(aadBytes).buffer,
    },
    cryptoKey,
    new Uint8Array(msgBytes).buffer
  );

  return {
    nonce: bytesToHex(nonce),
    aad,
    ct: bytesToHex(new Uint8Array(ciphertext)),
  };
}

/**
 * Decrypt an AES-256-GCM ciphertext.
 *
 * @param context - Same context used during encryption
 * @param kem - Key encapsulation material (hex)
 * @param nonce - Nonce from capsule (hex)
 * @param ct - Ciphertext from capsule (hex)
 * @param aad - Associated data from capsule (hex)
 * @returns Decrypted plaintext as string
 */
export async function decrypt(
  context: string,
  kem: string,
  nonce: string,
  ct: string,
  aad: string
): Promise<string> {
  // Derive salt (same as encryption)
  const salt = generate(SLT_DOMAIN_TAG + context + KEM_DOMAIN_TAG);
  const saltBytes = new TextEncoder().encode(salt);

  // Derive AES key
  const kemBytes = hexToBytes(kem);
  const infoBytes = new TextEncoder().encode(
    hexToHumanReadable(KEM_DOMAIN_TAG)
  );
  const aesKeyBytes = hkdf(sha3_256, kemBytes, saltBytes, infoBytes, 32);

  // Import AES key (ensure proper ArrayBuffer)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(aesKeyBytes).buffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // Decrypt (use slice().buffer to get proper ArrayBuffer)
  const nonceBytes = hexToBytes(nonce);
  const ctBytes = hexToBytes(ct);
  const aadBytes = hexToBytes(aad);

  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(nonceBytes).buffer,
      additionalData: new Uint8Array(aadBytes).buffer,
    },
    cryptoKey,
    new Uint8Array(ctBytes).buffer
  );

  return new TextDecoder().decode(plaintext);
}

/**
 * Convert a Capsule to Plutus/Aiken JSON format.
 */
export function capsuleToPlutusJson(capsule: Capsule): object {
  return {
    constructor: 0,
    fields: [{ bytes: capsule.nonce }, { bytes: capsule.aad }, { bytes: capsule.ct }],
  };
}

/**
 * Convert hex-encoded domain tag back to human-readable string.
 * Used for HKDF info parameter which expects the original string.
 */
function hexToHumanReadable(hexString: string): string {
  const bytes = hexToBytes(hexString);
  return new TextDecoder().decode(bytes);
}
