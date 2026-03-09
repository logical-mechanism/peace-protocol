/**
 * Test Data Factories
 *
 * Centralized factory functions for creating consistent mock objects across all tests.
 * Each factory provides sensible defaults and accepts partial overrides.
 */

import type {
  Register,
  Capsule,
  HalfEncryptionLevel,
  FullEncryptionLevel,
  EncryptionDatum,
  EncryptionDisplay,
  BidDatum,
  BidDisplay,
  EncryptionStatus,
} from '../services/api';
import type {
  TransactionRecord,
  TransactionType,
  TransactionStatus,
} from '../services/transactionHistory';

// ─────────────────────────────────────────────────────────────
// Shared Constants
// ─────────────────────────────────────────────────────────────

export const DEFAULT_USER_PKH = 'abc123def456abc123def456abc123def456abc123def456abc123def456';
export const DEFAULT_SELLER_PKH = 'aa'.repeat(28);
export const DEFAULT_BIDDER_PKH = 'bb'.repeat(28);
export const DEFAULT_TX_HASH = 'aa'.repeat(32);

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

let counter = 0;

function uniqueTokenName(prefix: string): string {
  counter += 1;
  return prefix + counter.toString(16).padStart(8, '0');
}

// ─────────────────────────────────────────────────────────────
// On-Chain Datum Factories
// ─────────────────────────────────────────────────────────────

export function createRegister(overrides: Partial<Register> = {}): Register {
  return {
    generator: 'aa'.repeat(48),
    public_value: 'bb'.repeat(48),
    ...overrides,
  };
}

export function createCapsule(overrides: Partial<Capsule> = {}): Capsule {
  return {
    nonce: 'cc'.repeat(12),
    aad: 'dd'.repeat(32),
    ct: 'ee'.repeat(64),
    ...overrides,
  };
}

export function createHalfLevel(overrides: Partial<HalfEncryptionLevel> = {}): HalfEncryptionLevel {
  return {
    r1b: 'f1'.repeat(48),
    r2_g1b: 'f2'.repeat(48),
    r4b: 'f3'.repeat(96),
    ...overrides,
  };
}

export function createFullLevel(overrides: Partial<FullEncryptionLevel> = {}): FullEncryptionLevel {
  return {
    r1b: 'f1'.repeat(48),
    r2_g1b: 'f2'.repeat(48),
    r2_g2b: 'f3'.repeat(96),
    r4b: 'f4'.repeat(96),
    ...overrides,
  };
}

export function createEncryptionStatus(overrides: Partial<EncryptionStatus> = {}): EncryptionStatus {
  return { type: 'Open', ...overrides } as EncryptionStatus;
}

export function createEncryptionDatum(overrides: Partial<EncryptionDatum> = {}): EncryptionDatum {
  return {
    owner_vkh: DEFAULT_SELLER_PKH,
    owner_g1: createRegister(),
    token: uniqueTokenName('enc'),
    half_level: createHalfLevel(),
    full_level: null,
    capsule: createCapsule(),
    status: createEncryptionStatus(),
    ...overrides,
  };
}

export function createBidDatum(overrides: Partial<BidDatum> = {}): BidDatum {
  return {
    owner_vkh: DEFAULT_BIDDER_PKH,
    owner_g1: createRegister(),
    pointer: uniqueTokenName('bid'),
    token: uniqueTokenName('enc'),
    locked_until: Date.now() + 12 * 60 * 60 * 1000,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// API Display Model Factories
// ─────────────────────────────────────────────────────────────

export function createEncryption(overrides: Partial<EncryptionDisplay> = {}): EncryptionDisplay {
  const tokenName = overrides.tokenName ?? uniqueTokenName('enc');
  return {
    tokenName,
    seller: 'addr_test1qzselleraddr',
    sellerPkh: DEFAULT_SELLER_PKH,
    status: 'active',
    description: 'Test listing description',
    suggestedPrice: 100,
    storageLayer: 'iagon',
    imageLink: 'https://example.com/image.png',
    category: 'text',
    createdAt: '2025-01-15T10:00:00Z',
    utxo: { txHash: DEFAULT_TX_HASH, outputIndex: 0 },
    datum: createEncryptionDatum({ token: tokenName }),
    ...overrides,
  };
}

export function createBid(overrides: Partial<BidDisplay> = {}): BidDisplay {
  const tokenName = overrides.tokenName ?? uniqueTokenName('bid');
  const encryptionToken = overrides.encryptionToken ?? uniqueTokenName('enc');
  return {
    tokenName,
    bidder: 'addr_test1qzbidderaddr',
    bidderPkh: DEFAULT_BIDDER_PKH,
    encryptionToken,
    amount: 50_000_000,
    futurePrice: 120,
    status: 'pending',
    createdAt: '2025-01-16T12:00:00Z',
    utxo: { txHash: DEFAULT_TX_HASH, outputIndex: 1 },
    lockedUntil: Date.now() + 12 * 60 * 60 * 1000,
    datum: createBidDatum({ pointer: tokenName, token: encryptionToken }),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// Transaction History Factories
// ─────────────────────────────────────────────────────────────

export function createTransactionRecord(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    txHash: DEFAULT_TX_HASH,
    type: 'create-listing' as TransactionType,
    timestamp: Date.now(),
    status: 'pending' as TransactionStatus,
    description: 'Test transaction',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// HTTP Response Helpers
// ─────────────────────────────────────────────────────────────

export function okResponse<T>(data: T) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(data),
  };
}

export function errorResponse(status: number, code: string, message: string) {
  return {
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve({ error: { code, message } }),
  };
}
