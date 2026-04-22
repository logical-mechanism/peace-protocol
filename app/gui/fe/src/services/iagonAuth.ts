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

// ── Structured error handling ───────────────────────────────────────────

/**
 * Structured error shape emitted by the Rust-side `map_iagon_error()` helper.
 * The Rust commands reject with a JSON string like:
 *   {"code":"AUTH_FAILED","message":"Authentication failed. Your API key may be expired or invalid."}
 * which arrives on the JS side as the `.message` of the Error thrown by invoke().
 */
export interface IagonErrorInfo {
  code: string;
  message: string;
}

/** Try to parse a thrown value as a structured Iagon error. Returns null when
 *  the thing thrown doesn't match the shape (e.g. a normal Error from JS). */
export function parseIagonError(err: unknown): IagonErrorInfo | null {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : null;
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { code?: unknown }).code === 'string' &&
      typeof (parsed as { message?: unknown }).message === 'string'
    ) {
      return parsed as IagonErrorInfo;
    }
  } catch {
    // Not JSON — e.g. a plain transport error string.
  }
  return null;
}

/** Convenience predicate for 401/403 responses. */
export function isIagonAuthError(err: unknown): boolean {
  return parseIagonError(err)?.code === 'AUTH_FAILED';
}

// ── Auth-failure broadcast ──────────────────────────────────────────────

type AuthFailureListener = () => void;
const authFailureListeners = new Set<AuthFailureListener>();

/** Subscribe to AUTH_FAILED events. Returns an unsubscribe function. */
export function onIagonAuthFailure(listener: AuthFailureListener): () => void {
  authFailureListeners.add(listener);
  return () => {
    authFailureListeners.delete(listener);
  };
}

/**
 * Inspect a thrown value; if it reports AUTH_FAILED, wipe the stored API key
 * and notify every subscriber so connection indicators can go red.
 *
 * Returns `true` when the error was an auth failure (caller can short-circuit
 * its normal error-display path), `false` otherwise.
 */
export async function handleIagonError(err: unknown): Promise<boolean> {
  if (!isIagonAuthError(err)) return false;
  try {
    await disconnectIagon();
  } catch {
    // ignore — the key may already be gone, or the FS write may have failed.
  }
  for (const fn of authFailureListeners) {
    try {
      fn();
    } catch {
      // listeners must not break the error pipeline
    }
  }
  return true;
}

// ── Address Conversion ──────────────────────────────────────────────────

/**
 * Convert a bech32 Cardano address to its raw hex representation.
 * The Iagon API expects the full address bytes in hex (e.g. 57 bytes for a base address).
 */
export function addressToHex(bech32Address: string): string {
  const decoded = bech32.decode(bech32Address as `${string}1${string}`, 120);
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

/** Remove the stored key and broadcast the auth-failure event to subscribers.
 *  Used by every code path that observes a rejected/expired key so connection
 *  indicators update from a single source of truth. */
async function invalidateStoredKey(): Promise<void> {
  try {
    await disconnectIagon();
  } catch {
    // Ignore cleanup errors
  }
  for (const fn of authFailureListeners) {
    try {
      fn();
    } catch {
      // listeners must not break auth
    }
  }
}

/**
 * Get a valid Iagon API key, verifying it still works.
 * Returns null if no key is stored or the key has expired/been revoked.
 * On expiry, removes the stored key AND fires the auth-failure event so
 * connection indicators can react without the caller needing to poll.
 */
export async function getValidApiKey(): Promise<string | null> {
  const apiKey = await getStoredApiKey();
  if (!apiKey) return null;

  const valid = await verifyApiKey(apiKey);
  if (!valid) {
    await invalidateStoredKey();
    return null;
  }

  return apiKey;
}

/**
 * Check whether the stored API key (if any) still authenticates against Iagon.
 * `isIagonConnected()` only reports whether a key is on disk — this function
 * additionally verifies the key is accepted, removes it if it isn't, AND
 * fires the auth-failure event so any subscribed indicators flip to offline.
 * Use this at app start / dashboard mount instead of `isIagonConnected()`
 * when you care whether uploads and downloads will actually work.
 */
export async function hasValidApiKey(): Promise<boolean> {
  const apiKey = await getStoredApiKey();
  if (!apiKey) return false;
  const valid = await verifyApiKey(apiKey);
  if (!valid) {
    await invalidateStoredKey();
  }
  return valid;
}
