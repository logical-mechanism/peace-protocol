/**
 * SNARK Integration Module (Native Desktop)
 *
 * Provides Groth16 proof generation via the native snark CLI binary.
 * Setup files (pk.bin, ccs.bin) are shipped with the installer and
 * decompressed on first launch.
 *
 * Usage:
 *   import { getSnarkProver } from '@/services/snark'
 *
 *   const prover = getSnarkProver()
 *   await prover.initialize()
 *
 *   const proof = await prover.generateProof({
 *     secretA: '0x123...',
 *     secretR: '0x456...',
 *     publicV: 'compressed_g1_hex',
 *     publicW0: 'compressed_g1_hex',
 *     publicW1: 'compressed_g1_hex',
 *   })
 */

export {
  SnarkProver,
  getSnarkProver,
} from './prover'

export type {
  SnarkProofInputs,
  SnarkProof,
  ProvingProgress,
  ProverConfig,
} from './prover'
