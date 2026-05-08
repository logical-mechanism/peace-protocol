/**
 * Transaction Builder Utilities
 *
 * Shared constants, types, and helper functions used across all transaction modules.
 */

import { invoke } from '@tauri-apps/api/core';
import { MeshTxBuilder, deserializeAddress } from '@meshsdk/core';
import { getChainingAdapter, getOgmiosProvider } from '../providers';
import { getStubWarning } from '../crypto';
import type { CreateListingFormData } from '../../components/CreateListingModal';

// Environment flag for stub mode
export const USE_STUBS = import.meta.env.VITE_USE_STUBS === 'true';

/**
 * Cardano protocol parameter: lovelace cost per UTxO byte (Babbage/Conway era).
 * Source: protocol parameters `coinsPerUTxOByte`. Consistent across preprod and mainnet.
 */
export const COINS_PER_UTXO_BYTE = 4310;

/**
 * Result of a transaction submission.
 */
export interface TransactionResult {
  success: boolean;
  txHash?: string;
  tokenName?: string;
  error?: string;
  /** Draft ID for file listings — used for retry/recovery. */
  draftId?: string;
  isStub?: boolean;
  /** For chained accept-bid: the SNARK tx hash (step 1/2), distinct from txHash (re-encryption, step 2/2). */
  snarkTxHash?: string;
}

/** Steps during listing creation, used for progress UI. */
export type ListingCreationStep =
  | 'encrypting'
  | 'uploading'
  | 'verifying'
  | 'building'
  | 'signing'
  | 'submitting';

/** Progress steps for the chained accept-bid + re-encryption flow. */
export type ChainedAcceptStep =
  | 'submitting-snark'
  | 'building-reencrypt'
  | 'submitting-reencrypt'
  | 'complete'
  | 'fallback';

/**
 * Filter out specific UTxOs from a list (e.g. collateral, explicit inputs).
 * Compares by txHash + outputIndex.
 */
export function excludeUtxos<T extends { input: { txHash: string; outputIndex: number } }>(
  utxos: T[],
  ...excluded: { input: { txHash: string; outputIndex: number } }[]
): T[] {
  return utxos.filter(u =>
    !excluded.some(e =>
      u.input.txHash === e.input.txHash && u.input.outputIndex === e.input.outputIndex
    )
  );
}

/** Race a promise against a timeout. Turns silent hangs into visible errors. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Estimate the minimum lovelace for a UTxO with an inline Plutus JSON datum.
 *
 * The bash scripts use `cardano-cli calculate-min-required-utxo` which is
 * unavailable in the browser. This approximates the CBOR-serialized output
 * size from the Plutus JSON datum and applies the coinsPerUTxOByte formula.
 *
 * @param datum - Plutus JSON datum object
 * @returns Lovelace amount as a string (with 20% safety margin, min 2 ADA)
 */
export function estimateMinLovelace(datum: object): string {
  const json = JSON.stringify(datum, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );

  // Count raw byte content from hex "bytes" fields (2 hex chars = 1 CBOR byte)
  let datumBytes = 0;
  const hexRe = /"bytes"\s*:\s*"([0-9a-fA-F]*)"/g;
  let m;
  while ((m = hexRe.exec(json)) !== null) {
    datumBytes += m[1].length / 2; // hex → bytes
    datumBytes += 3; // CBOR bytestring header
  }

  // Count constructors and integer fields (small CBOR overhead each)
  const constructors = (json.match(/"constructor"\s*:/g) || []).length;
  const ints = (json.match(/"int"\s*:/g) || []).length;
  const arrays = (json.match(/"fields"\s*:/g) || []).length;
  datumBytes += constructors * 4 + ints * 3 + arrays * 2;

  // UTxO envelope: base overhead (160) + address (~60) + one native asset (~56)
  const utxoBytes = datumBytes + 276;

  const minLovelace = utxoBytes * COINS_PER_UTXO_BYTE;
  // 20% safety margin, floor of 2 ADA
  return Math.max(2_000_000, Math.ceil(minLovelace * 1.2)).toString();
}

/**
 * Compute the token name a forthcoming entry mint will produce, mirroring
 * `lib/util.construct_token_name` on-chain byte-for-byte:
 *
 *   token_name = bytearray.push(idx, tx_id) |> bytearray.slice(0, 31)
 *
 * That is: a SINGLE byte for `outputIndex` (range [0, 255]) prepended to
 * `txHash`, then truncated to 32 bytes (64 hex chars). This must match
 * the on-chain semantic exactly — the encryption / bidding / genesis
 * mint validators all assert `assets.has_nft_strict(mint, policy_id,
 * util.generate_token_name(inputs))`, so any divergence makes the mint
 * fail.
 *
 * Earlier versions of this function CBOR-encoded `outputIndex`, which
 * matched on-chain only for `outputIndex <= 23`. CBOR major-type-0
 * emits 2 bytes for [24, 255] and the resulting off-chain prediction
 * desyncs from on-chain. See audit finding I-08.
 *
 * @param txHash - Transaction hash (64 hex chars)
 * @param outputIndex - Output index of the UTxO whose token is being minted (must be 0..255)
 * @returns Token name (up to 64 hex chars)
 * @throws if outputIndex is out of [0, 255] — `bytearray.push` rejects it on-chain
 */
export function computeTokenName(txHash: string, outputIndex: number): string {
  if (
    !Number.isInteger(outputIndex) ||
    outputIndex < 0 ||
    outputIndex > 255
  ) {
    throw new Error(
      `computeTokenName: outputIndex must be an integer in [0, 255], got ${outputIndex}. ` +
        `On-chain bytearray.push fails outside this range.`,
    );
  }
  const indexByte = outputIndex.toString(16).padStart(2, '0');
  const combined = indexByte + txHash;
  return combined.slice(0, 64);
}

/**
 * Get storage layer URI from form data.
 * Text category uses on-chain storage; other categories use Iagon.
 */
export function getStorageLayerUri(formData: CreateListingFormData): string {
  if (formData.category === 'text') {
    return 'on-chain';
  }
  return 'iagon';
}

/**
 * Extract payment key hash from a wallet address.
 */
export function extractPaymentKeyHash(address: string): string {
  const deserialized = deserializeAddress(address);
  const pkh = deserialized.pubKeyHash;
  if (!pkh) {
    throw new Error('Could not extract payment key hash from wallet address');
  }
  return pkh;
}

/** Create a MeshTxBuilder wired to local Kupo + Ogmios. */
export function createTxBuilder(): MeshTxBuilder {
  const txBuilder = new MeshTxBuilder({
    fetcher: getChainingAdapter(),
    evaluator: getOgmiosProvider(),
  });
  txBuilder.txEvaluationMultiplier = 1.0;
  return txBuilder;
}

/**
 * Fetch the current slot number from local Ogmios health endpoint.
 * Ogmios /health returns JSON with lastKnownTip.slot.
 */
export async function fetchCurrentSlot(): Promise<number> {
  // Routed through Tauri IPC to bypass WebKitGTK CORS enforcement.
  const body = await invoke<string>('ogmios_fetch', {
    url: 'http://127.0.0.1:1337/health',
  });
  const data = JSON.parse(body);
  return data.lastKnownTip?.slot || 0;
}

export function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Check if real transactions are available.
 */
export function isRealTransactionsAvailable(): boolean {
  return !USE_STUBS;
}

/**
 * Get warning message about stub mode.
 */
export function getTransactionStubWarning(): string {
  if (USE_STUBS) {
    return (
      'Transaction submission is in STUB mode. No real transactions will be submitted. ' +
      'Set VITE_USE_STUBS=false to enable real transactions.'
    );
  }
  return '';
}

// Re-export getStubWarning for internal use by sibling modules
export { getStubWarning };
