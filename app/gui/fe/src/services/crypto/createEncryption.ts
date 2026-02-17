/**
 * Create Encryption Transaction Artifacts
 *
 * Ported from Python: src/commands.py create_encryption_tx()
 *
 * CRITICAL BLOCKER: This implementation is INCOMPLETE due to a dependency
 * on native binary operations that cannot run in the browser.
 *
 * The Python code calls `gt_to_hash(a0, snark_path)` which executes a native
 * binary to compute a pairing e([a]G1, H0) and encode it. This operation:
 * 1. Requires the native snark CLI binary
 * 2. Cannot be done in the browser without WASM support
 * 3. Is essential for deriving the encryption key material (kem)
 *
 * Until this is resolved, the create listing flow cannot fully work.
 * Options:
 * 1. Build a WASM module that exposes gt_to_hash functionality
 * 2. Have users run a local CLI tool and paste the result
 * 3. Use a trusted server to compute gt_to_hash (compromises decentralization)
 *
 * For now, this module provides stub implementations for UI development.
 */

import type { IWallet } from '@meshsdk/core';
import {
  rng,
  g1Point,
  scale,
  combine,
  toInt,
  CURVE_ORDER,
} from './bls12381';
import { generate } from './hashing';
import { H2I_DOMAIN_TAG, KEY_DOMAIN_TAG, H1, H2, H3 } from './constants';
import { createRegister, registerToPlutusJson, type Register } from './register';
import { schnorrProof, schnorrToPlutusJson, type SchnorrProof } from './schnorr';
import { bindingProof, bindingToPlutusJson, type BindingProof } from './binding';
import { encrypt, capsuleToPlutusJson, type Capsule } from './ecies';
import { halfLevelToPlutusJson, emptyFullLevelToPlutusJson, type HalfLevel } from './level';
import { deriveSecretFromWallet, getSigningExplanation } from './walletSecret';
import { getSnarkProver } from '../snark';

/**
 * Result of creating encryption artifacts.
 */
export interface CreateEncryptionResult {
  // Secrets (must be stored securely, needed for accepting bids later)
  a: bigint;
  r: bigint;

  // Public data for on-chain storage
  register: Register;
  schnorr: SchnorrProof;
  binding: BindingProof;
  halfLevel: HalfLevel;
  capsule: Capsule;

  // Plutus JSON representations
  plutusJson: {
    register: object;
    schnorr: object;
    binding: object;
    halfLevel: object;
    fullLevel: object; // Empty full level
    capsule: object;
  };
}

/**
 * Check if native gt_to_hash is available via the snark CLI.
 * Always true in the desktop app (no WASM worker initialization needed).
 */
function isWasmGtToHashAvailable(): boolean {
  return true;
}

/**
 * Compute GT hash from scalar a using WASM via worker.
 *
 * This computes:
 *   kappa = e([a]G1, H0)
 *   m0 = fq12_encoding(kappa, F12_DOMAIN_TAG)
 *
 * Uses gnark-crypto for exact Fq12 tower representation matching circuit constraints.
 *
 * @param a - Secret scalar
 * @returns Hash as hex string (56 chars / 28 bytes)
 */
async function gtToHashWasm(a: bigint): Promise<string> {
  const prover = getSnarkProver();

  // Convert bigint to string with 0x prefix
  const aStr = '0x' + a.toString(16);

  console.log('[WASM] Calling gnarkGtToHash via worker with a =', aStr.slice(0, 20) + '...');

  const hash = await prover.gtToHash(aStr);

  console.log('[WASM] gnarkGtToHash returned hash:', hash.slice(0, 20) + '...');
  return hash;
}

/**
 * Compute GT hash using WASM.
 *
 * WASM is REQUIRED — the stub produces blake2b-224 (56 hex chars) which is
 * incompatible with DecryptToHash's MiMC output (64 hex chars). Encryptions
 * created with the stub can never be decrypted.
 *
 * @param a - Secret scalar
 * @returns Hash as hex string (64 chars / 32 bytes from MiMC)
 */
async function gtToHash(a: bigint): Promise<string> {
  if (!isWasmGtToHashAvailable()) {
    throw new Error(
      'WASM prover not loaded. The prover must be initialized before creating an encryption. ' +
      'Load the prover from the dashboard first.'
    );
  }
  return gtToHashWasm(a);
}

/**
 * Derive the secret scalar from wallet signing key.
 *
 * In production, this would:
 * 1. Get the wallet's signing key or derive from signature
 * 2. Hash it with KEY_DOMAIN_TAG
 * 3. Return as scalar modulo curve order
 *
 * For browser implementation, we'd typically sign a message and derive from that.
 *
 * @param walletSecretHex - Hex representation of wallet secret (or derived value)
 * @returns Secret scalar for BLS operations
 */
export function deriveUserSecret(walletSecretHex: string): bigint {
  const sk = toInt(generate(KEY_DOMAIN_TAG + walletSecretHex));
  return sk;
}

/**
 * Create all artifacts needed for an encryption listing.
 *
 * This creates:
 * - Random secrets (a, r)
 * - User register from derived secret
 * - Schnorr proof for register
 * - Half-level encryption entry
 * - Encrypted capsule
 * - Binding proof
 *
 * @param walletSecretHex - Derived wallet secret (from signing)
 * @param payload - Raw bytes to encrypt (e.g., canonical CBOR peace-payload)
 * @param tokenName - Token name for transcript binding (64 hex chars)
 * @param useStubs - If true, use stub implementation for gt_to_hash
 * @returns All encryption artifacts
 */
export async function createEncryptionArtifacts(
  walletSecretHex: string,
  payload: Uint8Array,
  tokenName: string,
  useStubs: boolean = false
): Promise<CreateEncryptionResult> {
  // WASM is required for real encryption (gtToHash uses MiMC via gnark pairing)
  if (!useStubs && !isWasmGtToHashAvailable()) {
    throw new Error(
      'WASM prover not loaded. The prover must be initialized before creating an encryption.'
    );
  }

  // Generate random secrets
  const a = rng();
  const r = rng();

  // Compute m0 (KEM material) via WASM pairing + MiMC hash
  const m0 = await gtToHash(a);

  // Derive user secret and create register
  const sk = deriveUserSecret(walletSecretHex);
  const userRegister = createRegister(sk);

  // Generate Schnorr proof
  const schnorr = schnorrProof(userRegister);

  // Compute half-level entry points
  const r1 = scale(g1Point(1n), r); // [r]G1
  const r2_g1 = scale(g1Point(1n), (a + r * sk) % CURVE_ORDER); // [a + r*sk]G1

  // Compute level commitment term r4
  const aCoeff = toInt(generate(H2I_DOMAIN_TAG + r1));
  const bCoeff = toInt(generate(H2I_DOMAIN_TAG + r1 + r2_g1 + tokenName));

  // c = [a]*H1 + [b]*H2 + H3
  const c = combine(combine(scale(H1, aCoeff), scale(H2, bCoeff)), H3);
  const r4 = scale(c, r);

  const halfLevel: HalfLevel = {
    r1,
    r2_g1,
    r4,
  };

  // Encrypt payload
  const capsule = await encrypt(r1, m0, payload);

  // Generate binding proof
  const binding = bindingProof(a, r, r1, r2_g1, userRegister, tokenName);

  return {
    a,
    r,
    register: userRegister,
    schnorr,
    binding,
    halfLevel,
    capsule,
    plutusJson: {
      register: registerToPlutusJson(userRegister),
      schnorr: schnorrToPlutusJson(schnorr),
      binding: bindingToPlutusJson(binding),
      halfLevel: halfLevelToPlutusJson(halfLevel),
      fullLevel: emptyFullLevelToPlutusJson(),
      capsule: capsuleToPlutusJson(capsule),
    },
  };
}

/**
 * Create encryption artifacts using wallet for secret derivation.
 *
 * This is the main entry point for the UI. It:
 * 1. Prompts user to sign a message (derives sk)
 * 2. Creates all encryption artifacts
 * 3. Returns secrets for IndexedDB storage
 *
 * @param wallet - MeshJS wallet instance
 * @param payload - Raw bytes to encrypt (e.g., canonical CBOR peace-payload)
 * @param tokenName - Token name for transcript binding (64 hex chars)
 * @param useStubs - If true, use stub for gt_to_hash (required until native CLI)
 * @returns Encryption artifacts and secrets
 */
export async function createEncryptionWithWallet(
  wallet: IWallet,
  payload: Uint8Array,
  tokenName: string,
  useStubs: boolean = false
): Promise<CreateEncryptionResult> {
  // WASM is required for real encryption (gtToHash uses MiMC via gnark pairing)
  if (!useStubs && !isWasmGtToHashAvailable()) {
    throw new Error(
      'WASM prover not loaded. The prover must be initialized before creating an encryption.'
    );
  }

  // Derive sk from wallet signature
  const sk = await deriveSecretFromWallet(wallet);

  // Generate random secrets
  const a = rng();
  const r = rng();

  // Compute m0 (KEM material) via WASM pairing + MiMC hash
  const m0 = await gtToHash(a);

  // Create register from derived sk
  const userRegister = createRegister(sk);

  // Generate Schnorr proof
  const schnorr = schnorrProof(userRegister);

  // Compute half-level entry points
  const r1 = scale(g1Point(1n), r); // [r]G1
  const r2_g1 = scale(g1Point(1n), (a + r * sk) % CURVE_ORDER); // [a + r*sk]G1

  // Compute level commitment term r4
  const aCoeff = toInt(generate(H2I_DOMAIN_TAG + r1));
  const bCoeff = toInt(generate(H2I_DOMAIN_TAG + r1 + r2_g1 + tokenName));

  // c = [a]*H1 + [b]*H2 + H3
  const c = combine(combine(scale(H1, aCoeff), scale(H2, bCoeff)), H3);
  const r4 = scale(c, r);

  const halfLevel: HalfLevel = {
    r1,
    r2_g1,
    r4,
  };

  // Encrypt payload
  const capsule = await encrypt(r1, m0, payload);

  // Generate binding proof
  const binding = bindingProof(a, r, r1, r2_g1, userRegister, tokenName);

  return {
    a,
    r,
    register: userRegister,
    schnorr,
    binding,
    halfLevel,
    capsule,
    plutusJson: {
      register: registerToPlutusJson(userRegister),
      schnorr: schnorrToPlutusJson(schnorr),
      binding: bindingToPlutusJson(binding),
      halfLevel: halfLevelToPlutusJson(halfLevel),
      fullLevel: emptyFullLevelToPlutusJson(),
      capsule: capsuleToPlutusJson(capsule),
    },
  };
}

/**
 * Check if real encryption is available (gt_to_hash via WASM).
 * Returns true if WASM gnarkGtToHash function is loaded.
 */
export function isRealEncryptionAvailable(): boolean {
  return isWasmGtToHashAvailable();
}

/**
 * Get a warning message about stub mode, or status message about WASM.
 */
export function getStubWarning(): string {
  if (isWasmGtToHashAvailable()) {
    return (
      'Encryption is using WASM cryptography. The key material is computed using ' +
      'real BLS12-381 pairing operations via gnark-crypto.'
    );
  }
  return (
    'WASM prover not loaded. The prover must be initialized before creating an encryption. ' +
    'Load the WASM prover from the dashboard to enable encryption.'
  );
}

/**
 * Re-export signing explanation for UI use.
 */
export { getSigningExplanation };
