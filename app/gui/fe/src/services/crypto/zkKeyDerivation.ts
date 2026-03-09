/**
 * ZK Key Derivation for Desktop Wallet
 *
 * Derives the user's BLS12-381 secret scalar (sk) directly from the
 * wallet's payment signing key material, without requiring signData().
 *
 * Unlike the browser wallet approach (walletSecret.ts) which uses CIP-30
 * signData() -- producing wallet-implementation-specific signatures --
 * this derivation is deterministic from the mnemonic's HD key path.
 *
 * Security properties:
 * - Deterministic: same mnemonic always produces same sk
 * - Bound to payment key: different mnemonics produce different sk values
 * - Domain-separated: KEY_DOMAIN_TAG prevents cross-protocol collisions
 *
 * Note: Desktop-derived ZK identities differ from browser wallet identities.
 * This is by design -- the desktop app has its own ZK identity space.
 */

import { toInt } from './bls12381'
import { generate } from './hashing'
import { KEY_DOMAIN_TAG } from './constants'

// Module-level storage for the payment key hex.
// Set by WalletContext on unlock, cleared on lock.
let _paymentKeyHex: string | null = null

/**
 * Store the payment key hex for ZK derivation.
 * Called by WalletContext when the wallet is unlocked or locked.
 */
export function setPaymentKeyHex(hex: string | null): void {
  _paymentKeyHex = hex
}

/**
 * Get the current payment key hex, or null if wallet is locked.
 */
export function getPaymentKeyHex(): string | null {
  return _paymentKeyHex
}

/**
 * Derive the ZK secret scalar from the payment key hex.
 *
 * Computation: toInt(blake2b_224(KEY_DOMAIN_TAG || paymentKeyHex))
 *
 * @param paymentKeyHex - The raw Ed25519 payment signing key hex from MeshWallet
 * @returns The derived secret scalar as bigint (mod CURVE_ORDER)
 */
export function deriveZkSecret(paymentKeyHex: string): bigint {
  const hash = generate(KEY_DOMAIN_TAG + paymentKeyHex)
  return toInt(hash)
}
