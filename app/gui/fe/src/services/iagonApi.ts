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
 * @deprecated Use encryptAndUpload() instead — this function causes ~15-20x
 * memory amplification for large files due to Tauri IPC JSON serialization.
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
 * @deprecated Use downloadAndSave() instead — this function causes ~15-20x
 * memory amplification for large files due to Tauri IPC JSON serialization.
 */
export async function downloadFile(
  apiKey: string,
  fileId: string
): Promise<Uint8Array> {
  const bytes = await invoke<number[]>('iagon_download', { apiKey, fileId });
  return new Uint8Array(bytes);
}

// ── File-based endpoints (no large byte arrays cross IPC) ───────────────

export interface IagonEncryptUploadResult {
  file_info: IagonFileInfo;
  key_hex: string;
  nonce_hex: string;
  digest_hex: string;
}

export interface IagonDownloadSaveResult {
  path: string;
  size: number;
}

/**
 * Encrypt a file on disk with AES-256-GCM and upload to Iagon.
 *
 * All heavy byte operations (read, encrypt, upload) happen in Rust.
 * Only small strings cross the IPC bridge — no memory amplification.
 *
 * @param apiKey - Iagon API key
 * @param filePath - Absolute path to the file on disk
 * @param filename - Name for the uploaded file on Iagon
 * @returns File info + hex-encoded encryption key, nonce, and digest
 */
export async function encryptAndUpload(
  apiKey: string,
  filePath: string,
  filename: string,
): Promise<IagonEncryptUploadResult> {
  return invoke<IagonEncryptUploadResult>('iagon_encrypt_and_upload', {
    apiKey,
    filePath,
    filename,
  });
}

/**
 * Download a file from Iagon, decrypt, verify digest, and save to content dir.
 *
 * All heavy byte operations (download, decrypt, save) happen in Rust.
 * Only small strings cross the IPC bridge — no memory amplification.
 *
 * @param apiKey - Iagon API key
 * @param fileId - Iagon file ID to download
 * @param keyHex - AES-256 key as hex string (64 chars)
 * @param nonceHex - GCM nonce as hex string (24 chars)
 * @param digestHex - Expected SHA-256 digest as hex (null to skip verification)
 * @param tokenName - Encryption token name (used as directory name)
 * @param category - Content category (text, document, audio, etc.)
 * @param fileName - Name for the saved file
 * @returns Saved file path and size
 */
export async function downloadAndSave(
  apiKey: string,
  fileId: string,
  keyHex: string,
  nonceHex: string,
  digestHex: string | null,
  tokenName: string,
  category: string,
  fileName: string,
): Promise<IagonDownloadSaveResult> {
  return invoke<IagonDownloadSaveResult>('iagon_download_and_save', {
    apiKey,
    fileId,
    keyHex,
    nonceHex,
    digestHex,
    tokenName,
    category,
    fileName,
  });
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

/**
 * Search for files on Iagon by query string.
 * Uses the /storage/filter endpoint to check if a file exists without downloading it.
 */
export async function searchFiles(
  apiKey: string,
  query: string
): Promise<IagonFileInfo[]> {
  const result = await invoke<{ files: IagonFileInfo[] }>('iagon_search_files', {
    apiKey,
    query,
  });
  return result.files;
}

/**
 * List all files in the user's Iagon root directory.
 * Uses the /storage/directory endpoint — more reliable than search for verification.
 */
export async function listFiles(apiKey: string): Promise<IagonFileInfo[]> {
  const result = await invoke<{ files: IagonFileInfo[] }>('iagon_list_files', {
    apiKey,
  });
  return result.files;
}

/**
 * Aggregate total storage consumed on Iagon across all files in the user's root directory.
 */
export async function getStorageUsage(
  apiKey: string
): Promise<{ totalBytes: number; fileCount: number }> {
  const files = await listFiles(apiKey);
  const totalBytes = files.reduce(
    (sum, f) => sum + (f.file_size_byte_encrypted || 0),
    0
  );
  return { totalBytes, fileCount: files.length };
}
