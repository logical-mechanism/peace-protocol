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
import { getBidSecrets } from '../bidSecretStorage';
import { decrypt as eciesDecrypt } from './ecies';

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
  message?: string; // Decrypted message if successful
  error?: string; // Error message if failed
  isStub?: boolean; // True if using stub data
}

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
 * BLOCKED: This requires the `snark decrypt` CLI binary which performs:
 * 1. shared = [sk]H0 (initial shared point)
 * 2. For each level:
 *    - Compute pairing e(r1, shared)
 *    - Derive key from r2 / pairing_result
 *    - Update shared = [key]G2
 * 3. Return final KEM value
 *
 * The pairing computation and Fq12 hashing MUST match gnark's format exactly.
 * This cannot be done in browser JavaScript - requires native code or backend.
 *
 * @param sk - User's secret scalar
 * @param levels - Encryption levels from chain
 * @returns KEM value as hex string
 */
export async function computeKEM(
  _sk: bigint,
  _levels: EncryptionLevel[]
): Promise<string | null> {
  // BLOCKED: Pairing operations require native snark binary
  // In production:
  // 1. Call backend API with sk and levels
  // 2. Backend runs `snark decrypt -r1 ... -g1b ... -shared ...`
  // 3. Return computed KEM

  console.warn('computeKEM requires native snark binary - not available in browser');
  return null;
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
  encryption: EncryptionDisplay
): Promise<DecryptionResult> {
  // Simulate some processing time
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // Get the stub message for this encryption
  const message = STUB_DECRYPTED_MESSAGES[bid.encryptionToken];

  if (message) {
    return {
      success: true,
      message,
      isStub: true,
    };
  }

  // Fallback for unknown tokens
  return {
    success: true,
    message: `[Stub Mode]\n\nDecrypted content for:\nToken: ${bid.encryptionToken.slice(0, 16)}...\n\nDescription: ${encryption?.description || 'No description'}\n\nThis is placeholder content since we're in development mode without live contracts.`,
    isStub: true,
  };
}

/**
 * Attempt real decryption (blocked until production).
 *
 * Would perform:
 * 1. Fetch encryption history from Koios
 * 2. Derive user's sk from wallet
 * 3. Compute KEM via backend/CLI
 * 4. Decrypt capsule with ECIES
 */
async function decryptReal(
  _wallet: IWallet,
  bid: BidDisplay,
  _encryption: EncryptionDisplay
): Promise<DecryptionResult> {
  // Step 1: Check if we have the bid secrets
  const secrets = await getBidSecrets(bid.tokenName);
  if (!secrets) {
    return {
      success: false,
      error:
        'Bid secrets not found. This could happen if you cleared browser data or placed the bid on a different device.',
    };
  }

  // Step 2: Fetch encryption history (blocked - no contracts)
  const history = await fetchEncryptionHistory(bid.encryptionToken);
  if (!history) {
    return {
      success: false,
      error:
        'Could not fetch encryption history. This requires contracts to be deployed on preprod.',
    };
  }

  // Step 3: Compute KEM (blocked - requires native binary)
  // This would need: computeKEM(secrets.b, history.levels)
  // But we can't do pairing operations in browser

  return {
    success: false,
    error:
      'Real decryption requires backend integration for BLS12-381 pairing operations. ' +
      'This will be available after contract deployment.',
  };
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
  encryption: EncryptionDisplay
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
    return decryptWithStub(bid, encryption);
  }

  // Attempt real decryption
  return decryptReal(wallet, bid, encryption);
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

  // In real mode, check if we have secrets
  const secrets = await getBidSecrets(bid.tokenName);
  if (!secrets) {
    return {
      canDecrypt: false,
      reason:
        'Bid secrets not found locally. You may need to use the same browser/device where you placed the bid.',
    };
  }

  return { canDecrypt: true };
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

  return (
    'Decryption uses zero-knowledge cryptography to securely reveal the message. ' +
    'The process:\n' +
    '1. Your wallet signature derives a unique secret key\n' +
    '2. The blockchain history is queried for encryption data\n' +
    '3. Advanced pairing operations compute the decryption key\n' +
    '4. The message is decrypted locally in your browser'
  );
}
