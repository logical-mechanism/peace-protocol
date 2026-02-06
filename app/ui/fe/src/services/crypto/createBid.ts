/**
 * Create Bid Crypto Operations
 *
 * Generates the cryptographic artifacts needed for placing a bid.
 * Based on Python implementation in src/commands.py create_bidding_tx().
 *
 * Bidder flow:
 * 1. Derive secret scalar b from wallet signature (same as seller's sk derivation)
 * 2. Compute B = [b]G1 (public key / register)
 * 3. Generate Schnorr proof of knowledge of b
 *
 * Note: The bidder's secret is derived from wallet signing (same as seller),
 * which means the same wallet always produces the same bidding identity.
 * This matches the Python implementation in create_bidding_tx().
 */

import type { IWallet } from '@meshsdk/core';
import { rng, g1Point } from './bls12381';
import { createRegister, registerToPlutusJson } from './register';
import { schnorrProof, schnorrToPlutusJson, type SchnorrProof } from './schnorr';
import { deriveSecretFromWallet } from './walletSecret';
import type { Register } from './register';

/**
 * Bid cryptographic artifacts needed for on-chain transaction.
 */
export interface BidArtifacts {
  // Secrets (stored in IndexedDB)
  b: bigint; // Bidder's secret scalar

  // Public values (for datum and redeemer)
  register: Register; // Bidder's public key register (g, u where u = [b]G1)
  schnorr: SchnorrProof; // Proof of knowledge of b

  // Plutus-formatted JSON for transaction building
  plutusJson: {
    register: object; // Register in Plutus format
    schnorr: object; // Schnorr proof in Plutus format
  };
}

/**
 * Create bid artifacts for placing a bid.
 *
 * Generates:
 * - Random secret scalar b
 * - Public register B = [b]G1
 * - Schnorr proof of knowledge of b
 *
 * The secret b must be stored in IndexedDB for later decryption.
 *
 * @returns BidArtifacts containing secret and public values
 */
export function createBidArtifacts(): BidArtifacts {
  // Step 1: Generate random secret scalar for bidder
  const b = rng();

  // Step 2: Create register (public key)
  // Register contains: g (generator), u = [b]G1 (public value)
  const register = createRegister(b);

  // Step 3: Generate Schnorr proof of knowledge of b
  const schnorr = schnorrProof(register);

  // Step 4: Format for Plutus/transaction
  const plutusJson = {
    register: registerToPlutusJson(register),
    schnorr: schnorrToPlutusJson(schnorr),
  };

  return {
    b,
    register,
    schnorr,
    plutusJson,
  };
}

/**
 * Create bid artifacts using wallet signing for deterministic key derivation.
 *
 * This derives the bidder's secret b from a wallet signature, matching
 * the Python implementation in create_bidding_tx(). The same wallet always
 * produces the same bidding identity (same b, same register).
 *
 * This is the CORRECT approach matching the protocol design:
 * - Bidder signs a message to derive their secret scalar b
 * - b is deterministic per wallet (recoverable)
 * - All bids from same wallet use same owner_g1 register
 *
 * @param wallet - MeshJS wallet instance
 * @returns BidArtifacts containing secret and public values
 */
export async function createBidArtifactsFromWallet(wallet: IWallet): Promise<BidArtifacts> {
  // Step 1: Derive secret scalar from wallet signature
  // This prompts user to sign in their wallet (same as seller flow)
  // Uses KEY_DOMAIN_TAG for domain separation, matching Python implementation
  const b = await deriveSecretFromWallet(wallet);

  // Step 2: Create register (public key)
  // Register contains: g (generator), u = [b]G1 (public value)
  const register = createRegister(b);

  // Step 3: Generate Schnorr proof of knowledge of b
  const schnorr = schnorrProof(register);

  // Step 4: Format for Plutus/transaction
  const plutusJson = {
    register: registerToPlutusJson(register),
    schnorr: schnorrToPlutusJson(schnorr),
  };

  return {
    b,
    register,
    schnorr,
    plutusJson,
  };
}

/**
 * Get a user-friendly description of what the bid crypto does.
 */
export function getBidCryptoExplanation(): string {
  return (
    'You will be asked to sign a message to derive your bidding key. ' +
    'This key is deterministic - the same wallet always produces the same bidding identity. ' +
    'The signature is used locally and never stored or transmitted.'
  );
}

/**
 * Verify bid artifacts are valid (for debugging).
 *
 * @param artifacts - BidArtifacts to verify
 * @returns true if valid
 */
export function verifyBidArtifacts(artifacts: BidArtifacts): boolean {
  // Verify register: u should equal [b]G1
  const expectedU = g1Point(artifacts.b);
  if (artifacts.register.u !== expectedU) {
    console.error('Register verification failed: u != [b]G1');
    return false;
  }

  // Schnorr proof verification would require implementing the verifier
  // For now, trust that the prover is correct

  return true;
}
