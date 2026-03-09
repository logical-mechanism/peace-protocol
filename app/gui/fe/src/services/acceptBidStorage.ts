/**
 * Accept Bid Storage Service
 *
 * Stores hop secrets (a0, r0, hk) between Phase 12e (SNARK tx) and Phase 12f (re-encryption tx).
 * These secrets are generated fresh for the SNARK proof and needed for the re-encryption step.
 *
 * Storage is backed by JSON files in the Tauri app data directory
 * (secrets/accept-bid/{encryptionTokenName}.json), which persists across WebView resets
 * unlike IndexedDB in WebKitGTK.
 *
 * The flow:
 * 1. Phase 12e: Seller generates SNARK proof with fresh (a0, r0), stores them here
 * 2. Phase 12e tx confirms on-chain (encryption status → Pending)
 * 3. Phase 12f: Seller retrieves (a0, r0) to compute re-encryption artifacts
 * 4. Phase 12f tx confirms on-chain (encryption status → Open, new owner)
 * 5. Secrets are cleaned up
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Accept bid secret structure.
 */
export interface AcceptBidSecrets {
  encryptionTokenName: string; // Encryption token being sold (64 hex chars)
  bidTokenName: string; // Bid being accepted (64 hex chars)
  a0: string; // Fresh secret scalar a0 (bigint as hex string)
  r0: string; // Fresh secret scalar r0 (bigint as hex string)
  hk: string; // Hop key hk = mimc(e([a0]G1, H0)) (bigint as hex string)
  grothPublic: string[]; // The 36 public inputs from the SNARK proof (decimal strings)
  ttl: number; // TTL in POSIX milliseconds
  snarkTxHash: string; // Phase 12e tx hash (for tracking)
  createdAt: string; // ISO timestamp
}

/**
 * Store accept-bid secrets after Phase 12e SNARK tx.
 */
export async function storeAcceptBidSecrets(
  encryptionTokenName: string,
  bidTokenName: string,
  a0: bigint,
  r0: bigint,
  hk: bigint,
  grothPublic: string[],
  ttl: number,
  snarkTxHash: string
): Promise<void> {
  await invoke('store_accept_bid_secrets', {
    encryptionTokenName,
    bidTokenName,
    a0: a0.toString(16),
    r0: r0.toString(16),
    hk: hk.toString(16),
    grothPublic,
    ttl,
    snarkTxHash,
  });
}

/**
 * Retrieve accept-bid secrets for an encryption.
 */
export async function getAcceptBidSecrets(
  encryptionTokenName: string
): Promise<{
  a0: bigint;
  r0: bigint;
  hk: bigint;
  bidTokenName: string;
  grothPublic: string[];
  ttl: number;
  snarkTxHash: string;
} | null> {
  const result = await invoke<{
    a0: string;
    r0: string;
    hk: string;
    bidTokenName: string;
    grothPublic: string[];
    ttl: number;
    snarkTxHash: string;
  } | null>('get_accept_bid_secrets', { encryptionTokenName });

  if (!result) return null;
  return {
    a0: BigInt('0x' + result.a0),
    r0: BigInt('0x' + result.r0),
    hk: result.hk ? BigInt('0x' + result.hk) : 0n,
    bidTokenName: result.bidTokenName,
    grothPublic: result.grothPublic,
    ttl: result.ttl,
    snarkTxHash: result.snarkTxHash,
  };
}

/**
 * Remove accept-bid secrets (after Phase 12f completes or on cancel).
 */
export async function removeAcceptBidSecrets(
  encryptionTokenName: string
): Promise<void> {
  await invoke('remove_accept_bid_secrets', { encryptionTokenName });
}

/**
 * Check if accept-bid secrets exist for an encryption.
 */
export async function hasAcceptBidSecrets(
  encryptionTokenName: string
): Promise<boolean> {
  return await invoke<boolean>('has_accept_bid_secrets', {
    encryptionTokenName,
  });
}
