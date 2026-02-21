/**
 * Decryption Service
 *
 * Handles the decryption flow for accepted bids.
 *
 * IMPORTANT: Full decryption requires BLS12-381 pairing operations that
 * cannot be performed in the browser due to:
 * 1. The pairing computation must match gnark's Fq12 encoding exactly
 * 2. The `snark decrypt` CLI binary is required for these operations
 * 3. This requires either a backend service or native CLI integration
 *
 * For now, this module provides:
 * - Stub decryption for development/testing
 * - Interface definitions for real implementation
 * - Documentation of what's needed for production
 *
 * Production flow (when contracts are deployed):
 * 1. Query Koios for encryption token transaction history
 * 2. Extract encryption levels from each transaction's inline datum
 * 3. Derive user's secret scalar (sk) from wallet signature
 * 4. Call backend/CLI with sk and encryption levels to compute KEM
 * 5. Use KEM to decrypt capsule with ECIES
 */

import type { IWallet } from '@meshsdk/core';
import type { BidDisplay, EncryptionDisplay } from '../api';
import { encryptionsApi } from '../api';
import { decrypt as eciesDecrypt } from './ecies';
import { parsePayload } from './payload';
import { bytesToHex } from './bls12381';
import { decryptDownloadedFile, decodeFileSecret, verifyFileDigest } from './fileEncryption';
import { downloadFile as iagonDownload } from '../iagonApi';
import { getStoredApiKey } from '../iagonAuth';
import { g2Point, scale } from './bls12381';
import { H0 } from './constants';
import { getSnarkProver } from '../snark';
import { deriveSecretFromWallet } from './walletSecret';

/**
 * Resolve an Iagon-backed payload by downloading and decrypting the file.
 *
 * Extracts the Iagon file ID from field 0 (locator), the AES key+nonce
 * from field 1 (secret), downloads the encrypted file, decrypts it,
 * and optionally verifies integrity via field 2 (digest).
 */
async function resolveIagonPayload(
  payload: Map<number, Uint8Array>
): Promise<{ rawContent: Uint8Array; message: string }> {
  const locator = payload.get(0)!;
  const secret = payload.get(1)!;
  const digest = payload.get(2);

  const fileId = new TextDecoder().decode(locator);
  const { key, nonce } = decodeFileSecret(secret);

  // Get Iagon API key
  const apiKey = await getStoredApiKey();
  if (!apiKey) {
    throw new Error('Iagon is not connected. Go to Settings > Data Layer to connect.');
  }

  // Download encrypted file from Iagon
  const encryptedBlob = await iagonDownload(apiKey, fileId);

  // Decrypt with AES-256-GCM
  const rawContent = await decryptDownloadedFile(encryptedBlob, key, nonce);

  // Verify integrity if digest is available
  if (digest) {
    await verifyFileDigest(rawContent, digest);
  }

  return {
    rawContent,
    message: `File downloaded and decrypted (${rawContent.length} bytes)`,
  };
}

/**
 * Check if native decrypt_to_hash is available via the snark CLI.
 * Always true in the desktop app (no WASM worker initialization needed).
 */
export function isWasmDecryptAvailable(): boolean {
  return true;
}

/**
 * Compute decryption hash using WASM via worker.
 *
 * This performs the pairing operations needed for decryption:
 * - Computes e(r1, shared) pairing
 * - Combines with r2/g1b to derive key material
 * - Encodes result using gnark's Fq12 tower representation
 *
 * @param g1b - G1 point (bidder's derived point)
 * @param r1 - G1 point from encryption level
 * @param shared - G2 point (shared secret)
 * @param g2b - G2 point (empty string "" for half-level decryption)
 * @returns Hash as hex string (56 chars / 28 bytes)
 */
async function decryptToHashWasm(g1b: string, r1: string, shared: string, g2b: string = ''): Promise<string> {
  const prover = getSnarkProver();

  const hash = await prover.decryptToHash(g1b, r1, shared, g2b);
  return hash;
}

/**
 * Encryption level from on-chain datum (half-level or full-level entry).
 */
export interface EncryptionLevel {
  r1: string; // G1 point (96 hex chars)
  r2_g1: string; // G1 component (96 hex chars)
  r2_g2?: string; // G2 component for full-level (192 hex chars), undefined for half-level
}

/**
 * Capsule containing the encrypted data.
 */
export interface Capsule {
  nonce: string; // 12 bytes (24 hex chars)
  aad: string; // Associated authenticated data (56 hex chars)
  ct: string; // Ciphertext + GCM tag
}

/**
 * Result of decryption operation.
 */
export interface DecryptionResult {
  success: boolean;
  message?: string; // Field 0 (locator) decoded as UTF-8 for display
  payload?: Map<number, Uint8Array>; // Structured CBOR payload fields
  rawContent?: Uint8Array; // Raw bytes of field 0 for saving to disk
  error?: string; // Error message if failed
  isStub?: boolean; // True if using stub data
}

/**
 * Progress callback for decryption operations.
 * @param current - Number of levels processed so far
 * @param total - Total number of encryption levels to process
 */
export type OnDecryptProgress = (current: number, total: number) => void;

/**
 * Encryption history fetched from Koios.
 * Contains all the re-encryption hops for the token.
 */
export interface EncryptionHistory {
  tokenName: string;
  levels: EncryptionLevel[];
  capsule: Capsule;
}

/**
 * Check if we're in stub mode.
 */
export function isStubMode(): boolean {
  return import.meta.env.VITE_USE_STUBS === 'true';
}

/**
 * Stub messages for testing (maps encryption token to decrypted message).
 * In production, these would be actually encrypted on-chain.
 */
const STUB_DECRYPTED_MESSAGES: Record<string, string> = {
  '00abc123def456789012345678901234567890123456789012345678901234':
    'Premium API Keys:\n\nBinance: sk_live_abcd1234...\nCoinbase: api_key_xyz789...\nKraken: key_secret_456...\n\nRate limit bypasses included. Valid until 2026-03-01.',
  '01def456abc789012345678901234567890123456789012345678901234567':
    'Whale Wallet Signals Report\n\nWallet 1 (addr1...xyz): Accumulated 500K ADA on 2025-01-14\nWallet 2 (addr1...abc): Sold 200K ADA on 2025-01-15\n\nPattern: Large wallets accumulating before Catalyst votes.',
  '02ghi789jkl012345678901234567890123456789012345678901234567890':
    'CONFIDENTIAL: Zero-Day Vulnerability Report\n\nProtocol: [REDACTED] DeFi\nType: Integer overflow in withdraw()\nSeverity: Critical\nStatus: Patched in v2.3.1\n\nFull technical details available after 90-day disclosure period.',
  '03mno012pqr345678901234567890123456789012345678901234567890123':
    'MEV Historical Data (CSV Format)\n\ndate,type,profit_ada,tx_hash\n2025-01-01,sandwich,150,abc123...\n2025-01-01,arbitrage,75,def456...\n2025-01-02,liquidation,500,ghi789...\n...\n(30 days of data)',
  '04stu345vwx678901234567890123456789012345678901234567890123456':
    'Smart Contract Audit Report - Project XYZ\n\nAuditor: [Top Security Firm]\nDate: 2025-01-10\nScope: All V2 contracts\n\nFindings:\n- Critical: 0\n- High: 2 (fixed)\n- Medium: 5 (fixed)\n- Low: 12 (acknowledged)\n\nFull report attached.',
  '05edge999test12345678901234567890123456789012345678901234567890':
    'Edge case test message with unusual metadata.\n\nThis encryption had:\n- Very long description (500+ chars)\n- Missing suggested price\n- Unknown storage layer\n\nDecryption still works correctly!',
};

/**
 * Query Koios for encryption history (stub implementation).
 *
 * In production, this would:
 * 1. Query asset transactions: GET /asset_txs?_asset_policy={pid}&_asset_name={tkn}&_history=true
 * 2. Query transaction info: POST /tx_info with tx hashes
 * 3. Extract encryption levels from inline datum at contract address
 * 4. Return the full history for recursive decryption
 *
 * @param encryptionToken - Token name of the encryption
 * @returns Encryption history with levels and capsule
 */
export async function fetchEncryptionHistory(
  encryptionToken: string
): Promise<EncryptionHistory | null> {
  if (!isStubMode()) {
    // In real mode, we would query Koios
    // This is blocked until contracts are deployed on preprod
    console.warn('Real encryption history query not available - contracts not deployed');
    return null;
  }

  // Stub: Return mock history data
  // This simulates what we'd get from Koios after re-encryption
  return {
    tokenName: encryptionToken,
    levels: [
      {
        // Half-level from initial encryption
        r1: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
        r2_g1:
          'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1',
      },
    ],
    capsule: {
      nonce: 'aabbccddeeff001122334455',
      aad: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ct: 'stub_ciphertext_not_real',
    },
  };
}

/**
 * Compute the KEM value for decryption using pairing operations.
 *
 * This requires the gnark WASM module which performs:
 * 1. shared = [b]H0 (initial shared point from bidder secret)
 * 2. For each level:
 *    - g1b = [b]r2_g1 (scale r2_g1 by bidder secret)
 *    - Compute pairing hash via gnarkDecryptToHash
 *    - Update shared for next level
 * 3. Return final KEM value
 *
 * The pairing computation and Fq12 hashing MUST match gnark's format exactly.
 *
 * @param b - Bidder's secret scalar
 * @param levels - Encryption levels from chain
 * @returns KEM value as hex string, or null if WASM not available
 */
export async function computeKEM(
  b: bigint,
  levels: EncryptionLevel[],
  onProgress?: OnDecryptProgress
): Promise<string | null> {
  // Check if WASM is available
  if (!isWasmDecryptAvailable()) {
    console.warn('[computeKEM] WASM gnarkDecryptToHash not available');
    return null;
  }

  if (levels.length === 0) {
    console.error('[computeKEM] No encryption levels provided');
    return null;
  }

  // Initial shared secret: [b]H0
  let shared = scale(H0, b); // H0 is G2 point, scale returns G2 point

  let kemHash: string | null = null;

  onProgress?.(0, levels.length);

  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];

    // Pass raw datum values to WASM DecryptToHash.
    // The Go function computes: k = e(g1b, H0) / e(r1, shared)
    // where shared = [b]*H0 already incorporates the buyer's secret.
    // Do NOT pre-scale r2_g1/r2_g2 by b — that would double-count the secret.
    const g1b = level.r2_g1;
    const g2b = level.r2_g2 || '';

    try {
      kemHash = await decryptToHashWasm(g1b, level.r1, shared, g2b);
      onProgress?.(i + 1, levels.length);

      // For multi-level decryption, update shared for next level
      // shared = [hash]G2
      if (i < levels.length - 1) {
        const hashScalar = BigInt('0x' + kemHash);
        shared = g2Point(hashScalar);
      }
    } catch (err) {
      console.error(`[computeKEM] Failed at level ${i + 1}:`, err);
      return null;
    }
  }

  return kemHash;
}

/**
 * Decrypt an encryption using stub data.
 *
 * @param bid - The accepted bid
 * @param encryption - The encryption data
 * @returns Decryption result with stub message
 */
async function decryptWithStub(
  bid: BidDisplay,
  encryption: EncryptionDisplay,
  onProgress?: OnDecryptProgress
): Promise<DecryptionResult> {
  // Simulate progress with 5 fake levels over ~1.5s total
  const fakeLevels = 5;
  onProgress?.(0, fakeLevels);
  for (let i = 0; i < fakeLevels; i++) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    onProgress?.(i + 1, fakeLevels);
  }

  // Get the stub message for this encryption
  const message = STUB_DECRYPTED_MESSAGES[bid.encryptionToken];

  if (message) {
    return {
      success: true,
      message,
      rawContent: new TextEncoder().encode(message),
      isStub: true,
    };
  }

  // Fallback for unknown tokens
  const fallback = `[Stub Mode]\n\nDecrypted content for:\nToken: ${bid.encryptionToken.slice(0, 16)}...\n\nDescription: ${encryption?.description || 'No description'}\n\nThis is placeholder content since we're in development mode without live contracts.`;
  return {
    success: true,
    message: fallback,
    rawContent: new TextEncoder().encode(fallback),
    isStub: true,
  };
}

/**
 * Attempt real decryption using WASM.
 *
 * Performs:
 * 1. Fetch encryption history from Koios
 * 2. Load bid secrets from storage
 * 3. Compute KEM via WASM gnarkDecryptToHash
 * 4. Decrypt capsule with ECIES
 */
async function decryptReal(
  wallet: IWallet,
  bid: BidDisplay,
  encryption: EncryptionDisplay,
  onProgress?: OnDecryptProgress
): Promise<DecryptionResult> {
  // Step 1: Check if WASM is available
  if (!isWasmDecryptAvailable()) {
    console.warn('[decryptReal] WASM decryption not available');
    return {
      success: false,
      error:
        'WASM prover not loaded. Please load the prover from the dashboard to enable decryption.',
    };
  }

  // Step 2: Derive bid secret from wallet signature (deterministic)
  let b: bigint;
  try {
    b = await deriveSecretFromWallet(wallet);
  } catch (err) {
    console.warn('[decryptReal] Failed to derive secret from wallet:', err);
    return {
      success: false,
      error: 'Failed to derive secret from wallet. Please approve the signing request.',
    };
  }
  // Step 3: Fetch encryption history
  const history = await fetchEncryptionHistory(bid.encryptionToken);
  if (!history) {
    console.warn('[decryptReal] Could not fetch encryption history');
    return {
      success: false,
      error:
        'Could not fetch encryption history. This requires contracts to be deployed on preprod.',
    };
  }
  // Step 4: Compute KEM using WASM
  try {
    const kem = await computeKEM(b, history.levels, onProgress);
    if (!kem) {
      return {
        success: false,
        error: 'Failed to compute decryption key (KEM).',
      };
    }
    if (kem.length !== 64) {
      return {
        success: false,
        error: `KEM length mismatch (got ${kem.length} hex chars, expected 64). ` +
          'This encryption may have been created without the WASM prover and cannot be decrypted.',
      };
    }

    // Step 5: Decrypt capsule with ECIES
    // The context (r1) must match what was used during original encryption.
    // After re-encryption, the full_level.r1b = original half_level.r1b,
    // so we use the LAST level's r1 (matching Python recursive_decrypt).
    const r1 = history.levels[history.levels.length - 1].r1;

    const rawBytes = await eciesDecrypt(
      r1,
      kem,
      history.capsule.nonce,
      history.capsule.ct,
      history.capsule.aad
    );

    // Parse the CBOR peace-payload
    let payload: Map<number, Uint8Array> | undefined;
    let rawContent: Uint8Array;
    let message: string;
    try {
      payload = parsePayload(rawBytes);
      rawContent = payload.get(0)!;

      if (encryption.storageLayer === 'iagon' && payload.has(1)) {
        // Off-chain file: locator = Iagon file ID, secret = AES key+nonce
        const result = await resolveIagonPayload(payload);
        rawContent = result.rawContent;
        message = result.message;
      } else {
        // On-chain text: locator = text content
        message = new TextDecoder().decode(rawContent);
        if (payload.size > 1) {
          const parts = [`Locator: ${message}`];
          if (payload.has(1)) parts.push(`Secret: ${bytesToHex(payload.get(1)!)}`);
          if (payload.has(2)) parts.push(`Digest: ${bytesToHex(payload.get(2)!)}`);
          message = parts.join('\n');
        }
      }
    } catch {
      // Fallback: treat raw bytes as UTF-8 text (backward compatibility)
      rawContent = rawBytes;
      message = new TextDecoder().decode(rawBytes);
    }

    return {
      success: true,
      message,
      payload,
      rawContent,
      isStub: false,
    };
  } catch (err) {
    console.error('[decryptReal] Decryption failed:', err);
    return {
      success: false,
      error: `Decryption failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}

/**
 * Decrypt a won bid.
 *
 * This is the main entry point for the decryption flow.
 * In stub mode, returns mock data. In real mode, attempts full decryption.
 *
 * @param wallet - MeshJS wallet instance (for deriving sk)
 * @param bid - The accepted bid to decrypt
 * @param encryption - The encryption data
 * @returns Decryption result
 */
export async function decryptBid(
  wallet: IWallet,
  bid: BidDisplay,
  encryption: EncryptionDisplay,
  onProgress?: OnDecryptProgress
): Promise<DecryptionResult> {
  // Validate bid status
  if (bid.status !== 'accepted') {
    return {
      success: false,
      error: 'Only accepted bids can be decrypted.',
    };
  }

  // Check stub mode
  if (isStubMode()) {
    return decryptWithStub(bid, encryption, onProgress);
  }

  // Attempt real decryption
  return decryptReal(wallet, bid, encryption, onProgress);
}

/**
 * Validate that we can attempt decryption for a bid.
 *
 * @param bid - The bid to check
 * @returns Object with canDecrypt flag and reason if false
 */
export async function canDecrypt(
  bid: BidDisplay
): Promise<{ canDecrypt: boolean; reason?: string }> {
  if (bid.status !== 'accepted') {
    return {
      canDecrypt: false,
      reason: 'Only accepted bids can be decrypted.',
    };
  }

  // In stub mode, always can decrypt
  if (isStubMode()) {
    return { canDecrypt: true };
  }

  // In real mode, check WASM availability
  if (!isWasmDecryptAvailable()) {
    return {
      canDecrypt: false,
      reason:
        'WASM prover not loaded. Load the prover from the dashboard to enable decryption.',
    };
  }


  return { canDecrypt: true };
}

/**
 * Decrypt a purchased encryption directly (no bid object needed).
 *
 * After a sale completes, the bid token is burned but the buyer's secret `b`
 * remains in IndexedDB (keyed by encryption token name). This function looks
 * up the secret and decrypts using the on-chain datum's encryption levels.
 *
 * @param wallet - MeshJS wallet instance
 * @param encryption - The encryption to decrypt
 * @returns Decryption result
 */
export async function decryptEncryption(
  wallet: IWallet,
  encryption: EncryptionDisplay,
  onProgress?: OnDecryptProgress
): Promise<DecryptionResult> {
  // Step 1: Check if WASM is available
  if (!isWasmDecryptAvailable()) {
    return {
      success: false,
      error: 'WASM prover not loaded. Please load the prover from the dashboard to enable decryption.',
    };
  }

  // Step 2: Derive bid secret from wallet signature (deterministic)
  let b: bigint;
  try {
    b = await deriveSecretFromWallet(wallet);
  } catch (err) {
    console.warn('[decryptEncryption] Failed to derive secret from wallet:', err);
    return {
      success: false,
      error: 'Failed to derive secret from wallet. Please approve the signing request.',
    };
  }
  // Step 3: Fetch full encryption history from backend
  // The decryption protocol requires ALL levels from the token's tx history:
  //   1. Current half-level (no r2_g2) with shared = [b]H0
  //   2. Current full-level if exists (has r2_g2)
  //   3. All historical full-levels from previous re-encryption hops
  // This matches commands/08_decryptMessage.sh and src/commands.py:recursive_decrypt
  let levels: EncryptionLevel[];
  try {
    const apiLevels = await encryptionsApi.getLevels(encryption.tokenName);
    levels = apiLevels.map(l => ({
      r1: l.r1,
      r2_g1: l.r2_g1,
      r2_g2: l.r2_g2,
    }));
  } catch (err) {
    console.error('[decryptEncryption] Failed to fetch encryption levels:', err);
    return {
      success: false,
      error: 'Failed to fetch encryption history from backend. Please try again.',
    };
  }

  if (levels.length === 0) {
    return {
      success: false,
      error: 'No encryption levels found in transaction history.',
    };
  }

  // Step 4: Compute KEM using WASM
  try {
    const kem = await computeKEM(b, levels, onProgress);
    if (!kem) {
      return {
        success: false,
        error: 'Failed to compute decryption key (KEM).',
      };
    }
    // Validate KEM length: WASM MiMC produces 64 hex chars (32 bytes).
    // If the encryption was created with the old stub (blake2b-224 = 56 hex chars),
    // the AES key derivation will never match and decryption will fail.
    if (kem.length !== 64) {
      return {
        success: false,
        error: `KEM length mismatch (got ${kem.length} hex chars, expected 64). ` +
          'This encryption may have been created without the WASM prover and cannot be decrypted.',
      };
    }

    // Step 5: Decrypt capsule with ECIES
    // The context (r1) must match what was used during original encryption.
    // After re-encryption, the full_level.r1b = original half_level.r1b,
    // so we use the LAST level's r1 (matching Python recursive_decrypt).
    const capsule = encryption.datum.capsule;
    const contextR1 = levels[levels.length - 1].r1;

    const rawBytes = await eciesDecrypt(
      contextR1,
      kem,
      capsule.nonce,
      capsule.ct,
      capsule.aad
    );

    // Parse the CBOR peace-payload
    let payload: Map<number, Uint8Array> | undefined;
    let rawContent: Uint8Array;
    let message: string;
    try {
      payload = parsePayload(rawBytes);
      rawContent = payload.get(0)!;

      if (encryption.storageLayer === 'iagon' && payload.has(1)) {
        // Off-chain file: locator = Iagon file ID, secret = AES key+nonce
        const result = await resolveIagonPayload(payload);
        rawContent = result.rawContent;
        message = result.message;
      } else {
        // On-chain text: locator = text content
        message = new TextDecoder().decode(rawContent);
        if (payload.size > 1) {
          const parts = [`Locator: ${message}`];
          if (payload.has(1)) parts.push(`Secret: ${bytesToHex(payload.get(1)!)}`);
          if (payload.has(2)) parts.push(`Digest: ${bytesToHex(payload.get(2)!)}`);
          message = parts.join('\n');
        }
      }
    } catch {
      // Fallback: treat raw bytes as UTF-8 text (backward compatibility)
      rawContent = rawBytes;
      message = new TextDecoder().decode(rawBytes);
    }

    return {
      success: true,
      message,
      payload,
      rawContent,
      isStub: false,
    };
  } catch (err) {
    console.error('[decryptEncryption] Decryption failed:', err);
    return {
      success: false,
      error: `Decryption failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}

/**
 * Get a user-friendly explanation of the decryption process.
 */
export function getDecryptionExplanation(): string {
  if (isStubMode()) {
    return (
      'In development mode, decryption uses simulated data. ' +
      'When contracts are deployed, this will use your wallet signature to derive ' +
      'the decryption key and reveal the encrypted message.'
    );
  }

  const wasmStatus = isWasmDecryptAvailable()
    ? 'WASM cryptography loaded and ready.'
    : 'WASM prover not loaded - load it from the dashboard to enable decryption.';

  return (
    'Decryption uses zero-knowledge cryptography to securely reveal the message. ' +
    'The process:\n' +
    '1. Your wallet signature derives a unique secret key\n' +
    '2. The blockchain history is queried for encryption data\n' +
    '3. BLS12-381 pairing operations compute the decryption key (via WASM)\n' +
    '4. The message is decrypted locally in your browser\n\n' +
    wasmStatus
  );
}
