/**
 * Iagon Decentralized Storage API Client
 *
 * All HTTP calls are routed through Tauri Rust commands (using reqwest)
 * to bypass WebView CORS restrictions. The frontend never calls
 * gw.iagon.com directly — every request goes through invoke().
 */

import { invoke } from '@tauri-apps/api/core';

// ── Types ────────────────────────────────────────────────────────────────

export interface IagonFileInfo {
  _id: string;
  name: string;
  path: string;
  unique_id: string;
  file_size_byte_native: number;
  file_size_byte_encrypted: number;
}

// ── Auth Endpoints (public, no API key needed) ──────────────────────────

/**
 * Request a nonce for wallet-based authentication.
 * The nonce must be signed via CIP-8 and submitted to verifySignature.
 */
export async function getNonce(publicAddressHex: string): Promise<string> {
  return invoke<string>('iagon_get_nonce', { address: publicAddressHex });
}

/**
 * Submit a CIP-8 signature to verify wallet ownership and obtain a session JWT.
 *
 * @returns Object with `id` (user ID) and `session` (JWT bearer token)
 */
export async function verifySignature(
  publicAddressHex: string,
  signature: string,
  key: string
): Promise<{ id: string; session: string }> {
  return invoke<{ id: string; session: string }>('iagon_verify', {
    address: publicAddressHex,
    signature,
    key,
  });
}

/**
 * Generate a persistent API key using a session JWT.
 * The API key can be used in place of the Bearer token via x-api-key header.
 */
export async function generateApiKey(
  sessionToken: string,
  name: string
): Promise<string> {
  return invoke<string>('iagon_generate_api_key', { sessionToken, name });
}

/**
 * Verify that an API key is still valid.
 */
export async function verifyApiKey(apiKey: string): Promise<boolean> {
  try {
    return await invoke<boolean>('iagon_verify_api_key', { apiKey });
  } catch {
    return false;
  }
}

// ── Storage Endpoints ───────────────────────────────────────────────────

/**
 * Upload an encrypted file to Iagon.
 * Files are uploaded as public (content is already client-side encrypted).
 * File data is passed as a byte array through the Tauri command bridge.
 */
export async function uploadFile(
  apiKey: string,
  encryptedBytes: Uint8Array,
  filename: string,
): Promise<IagonFileInfo> {
  return invoke<IagonFileInfo>('iagon_upload', {
    apiKey,
    fileData: Array.from(encryptedBytes),
    filename,
  });
}

/**
 * Download a file from Iagon by ID.
 * Returns the raw file bytes.
 */
export async function downloadFile(
  apiKey: string,
  fileId: string
): Promise<Uint8Array> {
  const bytes = await invoke<number[]>('iagon_download', { apiKey, fileId });
  return new Uint8Array(bytes);
}

/**
 * Delete a file from Iagon.
 */
export async function deleteFile(
  apiKey: string,
  fileId: string
): Promise<void> {
  await invoke('iagon_delete_file', { apiKey, fileId });
}
