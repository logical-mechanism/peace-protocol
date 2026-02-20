/**
 * Secret Storage Service
 *
 * Stores seller secrets (a, r) via Tauri backend filesystem.
 * These secrets are CRITICAL - if lost, the seller cannot complete sales.
 *
 * Storage is backed by JSON files in the Tauri app data directory
 * (secrets/seller/{tokenName}.json), which persists across WebView resets
 * unlike IndexedDB in WebKitGTK.
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Seller secret structure.
 */
export interface SellerSecrets {
  tokenName: string; // Encryption token name (64 hex chars)
  a: string; // Secret scalar a (bigint as hex string)
  r: string; // Secret scalar r (bigint as hex string)
  createdAt: string; // ISO timestamp
}

/**
 * Store seller secrets for an encryption.
 *
 * @param tokenName - Encryption token name (64 hex chars)
 * @param a - Secret scalar a (bigint)
 * @param r - Secret scalar r (bigint)
 */
export async function storeSecrets(
  tokenName: string,
  a: bigint,
  r: bigint
): Promise<void> {
  await invoke('store_seller_secrets', {
    tokenName,
    a: a.toString(16),
    r: r.toString(16),
  });
}

/**
 * Retrieve seller secrets for an encryption.
 *
 * @param tokenName - Encryption token name
 * @returns Secrets with a and r as bigint, or null if not found
 */
export async function getSecrets(
  tokenName: string
): Promise<{ a: bigint; r: bigint } | null> {
  const result = await invoke<{ a: string; r: string } | null>(
    'get_seller_secrets',
    { tokenName }
  );
  if (!result) return null;
  return {
    a: BigInt('0x' + result.a),
    r: BigInt('0x' + result.r),
  };
}

/**
 * Check if secrets exist for a token.
 *
 * @param tokenName - Encryption token name
 * @returns True if secrets exist
 */
export async function hasSecrets(tokenName: string): Promise<boolean> {
  const secrets = await getSecrets(tokenName);
  return secrets !== null;
}

/**
 * Remove secrets for an encryption (after successful sale or cancellation).
 *
 * @param tokenName - Encryption token name
 */
export async function removeSecrets(tokenName: string): Promise<void> {
  await invoke('remove_seller_secrets', { tokenName });
}

/**
 * List all stored secrets (for debugging/management).
 *
 * @returns Array of token names with creation dates
 */
export async function listSecrets(): Promise<
  Array<{ tokenName: string; createdAt: string }>
> {
  const entries = await invoke<
    Array<{ token_name: string; created_at: string }>
  >('list_seller_secrets');
  return entries.map((e) => ({
    tokenName: e.token_name,
    createdAt: e.created_at,
  }));
}

/**
 * Clear all stored secrets (use with caution!).
 */
export async function clearAllSecrets(): Promise<void> {
  const entries = await listSecrets();
  for (const entry of entries) {
    await removeSecrets(entry.tokenName);
  }
}

/**
 * Export secrets as JSON for backup (include warning in UI).
 */
export async function exportSecrets(): Promise<string> {
  // List all secrets and read each one for full export
  const entries = await listSecrets();
  const secrets: SellerSecrets[] = [];
  for (const entry of entries) {
    const result = await invoke<{ a: string; r: string } | null>(
      'get_seller_secrets',
      { tokenName: entry.tokenName }
    );
    if (result) {
      secrets.push({
        tokenName: entry.tokenName,
        a: result.a,
        r: result.r,
        createdAt: entry.createdAt,
      });
    }
  }
  return JSON.stringify(secrets, null, 2);
}

/**
 * Import secrets from JSON backup.
 */
export async function importSecrets(json: string): Promise<number> {
  const secrets: SellerSecrets[] = JSON.parse(json);
  let count = 0;
  for (const secret of secrets) {
    await invoke('store_seller_secrets', {
      tokenName: secret.tokenName,
      a: secret.a,
      r: secret.r,
    });
    count++;
  }
  return count;
}
