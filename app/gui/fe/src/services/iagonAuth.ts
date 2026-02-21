/**
 * Iagon Authentication Service
 *
 * Handles CIP-8 wallet-based authentication with Iagon and
 * persistent API key management via Tauri encrypted storage.
 *
 * Auth flow:
 * 1. Convert bech32 wallet address → hex
 * 2. POST /public/nonce with hex address → get nonce UUID
 * 3. wallet.signData(nonce, address) → get CIP-8 { signature, key }
 * 4. POST /public/verify → get session JWT
 * 5. POST /key/generate → get persistent API key
 * 6. Store API key in Tauri encrypted secrets
 */

import type { IWallet } from '@meshsdk/core';
import { bech32 } from '@scure/base';
import { invoke } from '@tauri-apps/api/core';
import { getNonce, verifySignature, generateApiKey, verifyApiKey } from './iagonApi';

// ── Address Conversion ──────────────────────────────────────────────────

/**
 * Convert a bech32 Cardano address to its raw hex representation.
 * The Iagon API expects the full address bytes in hex (e.g. 57 bytes for a base address).
 */
export function addressToHex(bech32Address: string): string {
  const decoded = bech32.decode(bech32Address, 120);
  const bytes = bech32.fromWords(decoded.words);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Tauri API Key Storage ───────────────────────────────────────────────

/**
 * Retrieve the stored Iagon API key from Tauri encrypted secrets.
 * Returns null if no key is stored or wallet is locked.
 */
export async function getStoredApiKey(): Promise<string | null> {
  try {
    return await invoke<string | null>('get_iagon_api_key');
  } catch {
    return null;
  }
}

/**
 * Check if an Iagon API key is stored (without decrypting it).
 */
export async function isIagonConnected(): Promise<boolean> {
  try {
    return await invoke<boolean>('has_iagon_api_key');
  } catch {
    return false;
  }
}

/**
 * Remove the stored Iagon API key.
 */
export async function disconnectIagon(): Promise<void> {
  await invoke('remove_iagon_api_key');
}

// ── Full Auth Flow ──────────────────────────────────────────────────────

/**
 * Connect to Iagon using wallet-based CIP-8 authentication.
 *
 * Performs the full nonce → sign → verify → generate API key flow,
 * then stores the API key in Tauri encrypted secrets.
 *
 * @param wallet - MeshJS wallet instance (must support signData)
 * @param bech32Address - The wallet's bech32 address (addr1... or addr_test1...)
 * @returns The generated API key
 */
export async function connectIagon(
  wallet: IWallet,
  bech32Address: string
): Promise<string> {
  // 1. Convert address to hex for Iagon API
  const hexAddress = addressToHex(bech32Address);

  // 2. Request nonce from Iagon
  const nonce = await getNonce(hexAddress);

  // 3. Sign the nonce with wallet (CIP-8 / CIP-30 signData)
  // MeshSDK's signData takes (message, address) and handles UTF-8 → hex conversion
  const signedData = await wallet.signData(nonce, bech32Address);

  // 4. Verify signature with Iagon → get session JWT
  const { session } = await verifySignature(
    hexAddress,
    signedData.signature,
    signedData.key
  );

  // 5. Generate persistent API key
  const apiKey = await generateApiKey(session, 'veiled-desktop');

  // 6. Store encrypted in Tauri
  await invoke('store_iagon_api_key', { apiKey });

  return apiKey;
}

/**
 * Get a valid Iagon API key, verifying it still works.
 * Returns null if no key is stored or the key has expired/been revoked.
 */
export async function getValidApiKey(): Promise<string | null> {
  const apiKey = await getStoredApiKey();
  if (!apiKey) return null;

  // Verify the key is still valid
  const valid = await verifyApiKey(apiKey);
  if (!valid) {
    // Key expired or revoked — clean up
    try {
      await disconnectIagon();
    } catch {
      // Ignore cleanup errors
    }
    return null;
  }

  return apiKey;
}
