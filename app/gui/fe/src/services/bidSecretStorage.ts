/**
 * Bid Secret Storage Service
 *
 * Stores bidder secrets (b) via Tauri backend filesystem.
 * These secrets are CRITICAL - if lost, the bidder cannot decrypt purchased data.
 *
 * Storage is backed by JSON files in the Tauri app data directory
 * (secrets/bid/{bidTokenName}.json), which persists across WebView resets
 * unlike IndexedDB in WebKitGTK.
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Bidder secret structure.
 */
export interface BidderSecrets {
  bidTokenName: string; // Bid token name (64 hex chars)
  encryptionTokenName: string; // Encryption token being bid on (64 hex chars)
  b: string; // Secret scalar b (bigint as hex string)
  createdAt: string; // ISO timestamp
}

/**
 * Store bidder secrets for a bid.
 *
 * @param bidTokenName - Bid token name (64 hex chars)
 * @param encryptionTokenName - Encryption token being bid on (64 hex chars)
 * @param b - Secret scalar b (bigint)
 */
export async function storeBidSecrets(
  bidTokenName: string,
  encryptionTokenName: string,
  b: bigint
): Promise<void> {
  await invoke('store_bid_secrets', {
    bidTokenName,
    encryptionTokenName,
    b: b.toString(16),
  });
}

/**
 * Retrieve bidder secrets for a bid.
 *
 * @param bidTokenName - Bid token name
 * @returns Secrets with b as bigint and encryption token, or null if not found
 */
export async function getBidSecrets(
  bidTokenName: string
): Promise<{ b: bigint; encryptionTokenName: string } | null> {
  const result = await invoke<{ b: string; encryptionTokenName: string } | null>(
    'get_bid_secrets',
    { bidTokenName }
  );
  if (!result) return null;
  return {
    b: BigInt('0x' + result.b),
    encryptionTokenName: result.encryptionTokenName,
  };
}

/**
 * Get bid secrets for a specific encryption.
 * Useful for finding the bidder's secret when they win a bid.
 *
 * @param encryptionTokenName - Encryption token name
 * @returns Bid secret for that encryption, or null
 */
export async function getBidSecretsForEncryption(
  encryptionTokenName: string
): Promise<Array<{ bidTokenName: string; b: bigint }>> {
  const result = await invoke<{ b: string; encryptionTokenName: string } | null>(
    'get_bid_secrets_for_encryption',
    { encryptionTokenName }
  );
  if (!result) return [];
  // The Rust command returns a single match; wrap in array for compatibility
  return [{
    bidTokenName: '', // not available from this endpoint
    b: BigInt('0x' + result.b),
  }];
}

/**
 * Check if secrets exist for a bid.
 *
 * @param bidTokenName - Bid token name
 * @returns True if secrets exist
 */
export async function hasBidSecrets(bidTokenName: string): Promise<boolean> {
  const secrets = await getBidSecrets(bidTokenName);
  return secrets !== null;
}

/**
 * Remove secrets for a bid (after successful decryption or cancellation).
 *
 * @param bidTokenName - Bid token name
 */
export async function removeBidSecrets(bidTokenName: string): Promise<void> {
  await invoke('remove_bid_secrets', { bidTokenName });
}
