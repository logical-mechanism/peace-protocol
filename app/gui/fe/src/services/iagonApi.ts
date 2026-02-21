/**
 * Iagon Decentralized Storage API Client
 *
 * REST client for the Iagon storage gateway (gw.iagon.com).
 * Handles file upload, download, listing, search, and deletion.
 * Authentication is via x-api-key header (persistent API key).
 */

const IAGON_BASE = 'https://gw.iagon.com/api/v2';

// ── Types ────────────────────────────────────────────────────────────────

export interface IagonFileInfo {
  _id: string;
  client_id: string;
  parent_directory_id: string | null;
  availability: string;
  visibility: string;
  region: string | null;
  name: string;
  path: string;
  unique_id: string;
  file_size_byte_native: number;
  file_size_byte_encrypted: number;
  index_listing: boolean;
  created_at: string;
  updated_at: string;
}

export interface IagonDirectory {
  _id: string;
  client_id: string;
  visibility: string;
  path: string;
  directory_name: string;
  parent_directory_id: string | null;
  index_listing: boolean;
  created_at: string;
  updated_at: string;
}

export interface IagonListResponse {
  directories: IagonDirectory[];
  files: IagonFileInfo[];
}

export interface IagonUploadResponse {
  success: boolean;
  message: string;
  data: IagonFileInfo;
}

interface IagonApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

// ── Auth Endpoints (public, no API key needed) ──────────────────────────

/**
 * Request a nonce for wallet-based authentication.
 * The nonce must be signed via CIP-8 and submitted to verifySignature.
 */
export async function getNonce(publicAddressHex: string): Promise<string> {
  const res = await fetch(`${IAGON_BASE}/public/nonce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicAddress: publicAddressHex }),
  });
  if (!res.ok) {
    throw new Error(`Iagon getNonce failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.nonce;
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
  const res = await fetch(`${IAGON_BASE}/public/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicAddress: publicAddressHex,
      signature,
      key,
    }),
  });
  if (!res.ok) {
    throw new Error(`Iagon verifySignature failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Generate a persistent API key using a session JWT.
 * The API key can be used in place of the Bearer token via x-api-key header.
 */
export async function generateApiKey(
  sessionToken: string,
  name: string
): Promise<string> {
  const res = await fetch(`${IAGON_BASE}/key/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ api_key_name: name }),
  });
  if (!res.ok) {
    throw new Error(`Iagon generateApiKey failed: ${res.status} ${res.statusText}`);
  }
  const data: IagonApiResponse<string> = await res.json();
  if (!data.success) {
    throw new Error(`Iagon generateApiKey: ${data.message}`);
  }
  return data.data;
}

/**
 * Verify that an API key is still valid.
 */
export async function verifyApiKey(
  apiKey: string
): Promise<boolean> {
  const res = await fetch(`${IAGON_BASE}/key/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.success === true;
}

// ── Storage Endpoints ───────────────────────────────────────────────────

function apiKeyHeaders(apiKey: string): Record<string, string> {
  return { 'x-api-key': apiKey };
}

/**
 * Upload an encrypted file to Iagon.
 * Files are uploaded as public (content is already client-side encrypted).
 */
export async function uploadFile(
  apiKey: string,
  encryptedBlob: Blob,
  filename: string,
  directoryId?: string
): Promise<IagonFileInfo> {
  const formData = new FormData();
  formData.append('file', encryptedBlob, filename);
  formData.append('filename', filename);
  formData.append('visibility', 'public');
  if (directoryId) {
    formData.append('directoryId', directoryId);
  }

  const res = await fetch(`${IAGON_BASE}/storage/upload`, {
    method: 'POST',
    headers: apiKeyHeaders(apiKey),
    body: formData,
  });
  if (!res.ok) {
    throw new Error(`Iagon upload failed: ${res.status} ${res.statusText}`);
  }
  const data: IagonUploadResponse = await res.json();
  if (!data.success) {
    throw new Error(`Iagon upload: ${data.message}`);
  }
  return data.data;
}

/**
 * Download a file from Iagon by ID.
 * Returns the raw file bytes.
 */
export async function downloadFile(
  apiKey: string,
  fileId: string
): Promise<Uint8Array> {
  const formData = new FormData();
  formData.append('id', fileId);

  const res = await fetch(`${IAGON_BASE}/storage/download`, {
    method: 'POST',
    headers: apiKeyHeaders(apiKey),
    body: formData,
  });
  if (!res.ok) {
    throw new Error(`Iagon download failed: ${res.status} ${res.statusText}`);
  }
  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Delete a file from Iagon.
 */
export async function deleteFile(
  apiKey: string,
  fileId: string
): Promise<void> {
  const res = await fetch(`${IAGON_BASE}/storage/file/${fileId}`, {
    method: 'DELETE',
    headers: apiKeyHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`Iagon delete failed: ${res.status} ${res.statusText}`);
  }
}

/**
 * List files and directories in a given parent directory.
 */
export async function listFiles(
  apiKey: string,
  parentDirectoryId?: string,
  visibility: 'public' | 'private' = 'public'
): Promise<IagonListResponse> {
  const params = new URLSearchParams();
  if (parentDirectoryId) params.set('parent_directory_id', parentDirectoryId);
  params.set('visibility', visibility);
  params.set('listingType', 'index');

  const res = await fetch(`${IAGON_BASE}/storage/directory?${params}`, {
    method: 'GET',
    headers: apiKeyHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`Iagon listFiles failed: ${res.status} ${res.statusText}`);
  }
  const data: IagonApiResponse<IagonListResponse> = await res.json();
  return data.data;
}

/**
 * Search files and directories by query string.
 */
export async function searchFiles(
  apiKey: string,
  query: string,
  visibility: 'public' | 'private' = 'public'
): Promise<IagonListResponse> {
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('visibility', visibility);
  params.set('listingType', 'index');

  const res = await fetch(`${IAGON_BASE}/storage/filter?${params}`, {
    method: 'GET',
    headers: apiKeyHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`Iagon searchFiles failed: ${res.status} ${res.statusText}`);
  }
  const data: IagonApiResponse<IagonListResponse> = await res.json();
  return data.data;
}
