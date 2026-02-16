/**
 * SNARK Integration Module
 *
 * This module provides browser-based Groth16 proof generation for the Peace Protocol.
 *
 * Architecture:
 * - Large proving files (pk.bin ~613MB, ccs.bin ~85MB) are cached in IndexedDB
 * - Proving runs in a Web Worker to keep the UI responsive
 * - Go WASM prover generates proofs in 10-30 seconds on desktop
 *
 * Usage:
 *   import { getSnarkProver } from '@/services/snark'
 *
 *   const prover = getSnarkProver()
 *
 *   // Check if files need to be downloaded
 *   const { cached, sizes } = await prover.checkCache()
 *
 *   // Download files if needed (shows progress)
 *   await prover.ensureFilesDownloaded((progress) => {
 *     console.log(`${progress.stage}: ${progress.percent}%`)
 *   })
 *
 *   // Generate a proof
 *   const proof = await prover.generateProof({
 *     secretA: '0x123...',
 *     secretR: '0x456...',
 *     publicV: 'compressed_g1_hex',
 *     publicW0: 'compressed_g1_hex',
 *     publicW1: 'compressed_g1_hex',
 *   }, (progress) => {
 *     console.log(`Proving: ${progress.percent}%`)
 *   })
 */

export {
  SnarkProver,
  getSnarkProver,
  formatBytes,
  EXPECTED_FILE_SIZES,
} from './prover'

export type {
  SnarkProofInputs,
  SnarkProof,
  ProvingProgress,
  ProverConfig,
} from './prover'

export { snarkStorage } from './storage'

export type {
  SnarkFile,
  DownloadProgress,
} from './storage'
