/**
 * Wallet Secret Derivation
 *
 * Derives the user's BLS12-381 secret scalar (sk) from a wallet signature.
 *
 * CIP-30 wallets do not expose private keys directly. Instead, we derive
 * a deterministic secret by having the user sign a fixed message. The same
 * wallet + message always produces the same signature, giving us a stable sk.
 *
 * Security properties:
 * - Only the wallet holder can produce the signature
 * - Ed25519 signatures are not malleable
 * - User must explicitly approve in wallet UI
 * - Deterministic: same wallet = same sk
 */

import type { IWallet } from '@meshsdk/core';
import { toInt } from './bls12381';
import { generate } from './hashing';
import { KEY_DOMAIN_TAG } from './constants';

/**
 * Protocol version for key derivation.
 * Changing this will derive different keys (use for key rotation if needed).
 */
const KEY_DERIVATION_VERSION = 'v1';

/**
 * Fixed message for key derivation.
 * Using a simple, short message to avoid wallet parsing issues.
 * The address is included in the hash derivation, not the signed message.
 */
const KEY_DERIVATION_MESSAGE = `PEACE_PROTOCOL_${KEY_DERIVATION_VERSION}`;

/**
 * Build the message to sign for key derivation.
 * Note: We use a fixed message for signing, but include the address
 * in the final hash derivation for binding.
 *
 * @param _address - The user's payment address (used in derivation, not message)
 * @returns Message string to sign
 */
export function buildKeyDerivationMessage(_address: string): string {
  return KEY_DERIVATION_MESSAGE;
}

/**
 * Convert a string to hex encoding.
 */
function stringToHex(str: string): string {
  return Array.from(new TextEncoder().encode(str))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Derive the user's secret scalar (sk) from their wallet.
 *
 * This prompts the user to sign a deterministic message in their wallet.
 * The signature is then hashed to produce the BLS12-381 scalar.
 *
 * @param wallet - MeshJS wallet instance
 * @returns The derived secret scalar as bigint
 * @throws Error if signing fails or user rejects
 */
export async function deriveSecretFromWallet(wallet: IWallet): Promise<bigint> {
  // Get the user's address for the derivation
  const addresses = await wallet.getUsedAddresses();
  if (addresses.length === 0) {
    // Fall back to unused addresses if no used ones
    const unusedAddresses = await wallet.getUnusedAddresses();
    if (unusedAddresses.length === 0) {
      throw new Error('No addresses available from wallet');
    }
    addresses.push(unusedAddresses[0]);
  }

  // Always use the first address for consistency
  const address = addresses[0];

  try {
    // MeshJS BrowserWallet.signData(payload, address) - payload first, address second
    // MeshJS internally converts payload from UTF-8 to hex via fromUTF8()
    // So we pass the raw string message, not hex-encoded
    const signedData = await wallet.signData(KEY_DERIVATION_MESSAGE, address);

    // Derive sk from signature + address for binding
    // This ensures different addresses produce different keys
    const sk = toInt(generate(KEY_DOMAIN_TAG + signedData.signature + stringToHex(address)));

    return sk;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('User') || error.message.includes('reject')) {
        throw new Error('Signature rejected by user');
      }
    }
    throw new Error(`Failed to derive secret from wallet: ${error}`);
  }
}

/**
 * Check if the wallet supports signData (CIP-30).
 * Most modern Cardano wallets do, but good to verify.
 *
 * @param wallet - MeshJS wallet instance
 * @returns True if signData is available
 */
export function supportsSignData(wallet: IWallet): boolean {
  return typeof wallet.signData === 'function';
}

/**
 * Get a user-friendly description of what signing does.
 * Use this to explain to users why they're being asked to sign.
 */
export function getSigningExplanation(): string {
  return (
    'You will be asked to sign a message to derive your encryption key. ' +
    'This signature is used locally to generate a unique key for this protocol. ' +
    'The signature itself is never stored or sent anywhere.'
  );
}
