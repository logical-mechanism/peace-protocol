/**
 * SNARK Prover Service (Native Desktop)
 *
 * Invokes the native snark CLI binary via Tauri for proof generation,
 * GT hashing, and decryption hashing. Replaces the WASM Web Worker
 * approach with sub-second hash operations and ~3 minute proof generation.
 *
 * Usage:
 *   const prover = new SnarkProver()
 *   await prover.initialize()
 *   const proof = await prover.generateProof({ a, r, v, w0, w1 })
 */

import { invoke } from '@tauri-apps/api/core'

export interface SnarkProofInputs {
  /** Secret scalar 'a' (hex string or decimal string) */
  secretA: string
  /** Secret scalar 'r' (hex string or decimal string) */
  secretR: string
  /** Public G1 point V (compressed hex, 96 chars) */
  publicV: string
  /** Public G1 point W0 (compressed hex, 96 chars) */
  publicW0: string
  /** Public G1 point W1 (compressed hex, 96 chars) */
  publicW1: string
}

export interface SnarkProof {
  proofJson: string
  publicJson: string
}

export interface ProvingProgress {
  stage: 'checking-setup' | 'proving' | 'complete'
  message: string
  percent: number
}

export interface ProverConfig {
  /** Use stub mode for development (no real proof generation) */
  useStubs?: boolean
  /** Stub proof delay in milliseconds */
  stubDelayMs?: number
}

export class SnarkProver {
  private setupChecked = false
  private config: Required<ProverConfig>

  constructor(config: ProverConfig = {}) {
    this.config = {
      useStubs: config.useStubs ?? import.meta.env.VITE_USE_STUBS === 'true',
      stubDelayMs: config.stubDelayMs ?? 3000,
    }
  }

  /**
   * Check if SNARK setup files exist on disk
   */
  async checkSetup(): Promise<boolean> {
    if (this.config.useStubs) return true
    return invoke<boolean>('snark_check_setup')
  }

  /**
   * Initialize the prover: verify setup files exist, decompress if needed.
   */
  async initialize(onProgress?: (progress: ProvingProgress) => void): Promise<void> {
    if (this.setupChecked) return
    if (this.config.useStubs) {
      this.setupChecked = true
      onProgress?.({ stage: 'complete', message: 'Prover ready (stub mode)', percent: 100 })
      return
    }

    onProgress?.({ stage: 'checking-setup', message: 'Checking setup files...', percent: 0 })

    const exists = await invoke<boolean>('snark_check_setup')
    if (!exists) {
      onProgress?.({ stage: 'checking-setup', message: 'Decompressing setup files...', percent: 10 })
      await invoke('snark_decompress_setup')
    }

    this.setupChecked = true
    onProgress?.({ stage: 'complete', message: 'Prover ready', percent: 100 })
  }

  /**
   * Generate a SNARK proof
   *
   * @param inputs - Proof inputs (secrets and public values)
   * @param onProgress - Progress callback for proving updates
   */
  async generateProof(
    inputs: SnarkProofInputs,
    onProgress?: (progress: ProvingProgress) => void
  ): Promise<SnarkProof> {
    await this.initialize(onProgress)

    if (this.config.useStubs) {
      return this._generateStubProof(onProgress)
    }

    onProgress?.({ stage: 'proving', message: 'Generating zero-knowledge proof (~3 min)...', percent: 10 })

    const result = await invoke<{ proofJson: string; publicJson: string }>('snark_prove', {
      a: inputs.secretA,
      r: inputs.secretR,
      v: inputs.publicV,
      w0: inputs.publicW0,
      w1: inputs.publicW1,
    })

    onProgress?.({ stage: 'complete', message: 'Proof generated', percent: 100 })
    return result
  }

  private async _generateStubProof(
    onProgress?: (progress: ProvingProgress) => void
  ): Promise<SnarkProof> {
    const steps = 10
    const delayPerStep = this.config.stubDelayMs / steps

    for (let i = 1; i <= steps; i++) {
      await new Promise((resolve) => setTimeout(resolve, delayPerStep))
      onProgress?.({
        stage: 'proving',
        message: 'Generating proof (stub mode)...',
        percent: (i / steps) * 100,
      })
    }

    const stubProof = {
      piA: 'a'.repeat(96),
      piB: 'b'.repeat(192),
      piC: 'c'.repeat(96),
      commitments: ['d'.repeat(96)],
      commitmentPok: 'e'.repeat(96),
    }

    const stubPublic = {
      inputs: Array(36).fill('0').map((_, i) => String(i + 1)),
      commitmentWire: '12345678901234567890',
    }

    return {
      proofJson: JSON.stringify(stubProof),
      publicJson: JSON.stringify(stubPublic),
    }
  }

  /**
   * Compute GT hash from scalar a.
   * Used for creating encryption listings.
   *
   * @param secretA - Secret scalar (hex string with 0x prefix or decimal)
   * @returns Hash as hex string (56 chars)
   */
  async gtToHash(secretA: string): Promise<string> {
    if (this.config.useStubs) {
      return 'stub_hash_' + secretA.slice(0, 20).padEnd(46, '0')
    }
    return invoke<string>('snark_gt_to_hash', { a: secretA })
  }

  /**
   * Compute decryption hash.
   * Used for decrypting encrypted data.
   *
   * @param g1b - G1 point (96 hex chars)
   * @param r1 - G1 point (96 hex chars)
   * @param shared - G2 point (192 hex chars)
   * @param g2b - G2 point (192 hex chars) or empty string for half-level
   * @returns Hash as hex string (56 chars)
   */
  async decryptToHash(g1b: string, r1: string, shared: string, g2b: string = ''): Promise<string> {
    if (this.config.useStubs) {
      return 'stub_decrypt_hash_' + g1b.slice(0, 20).padEnd(38, '0')
    }
    return invoke<string>('snark_decrypt_to_hash', { g1b, r1, shared, g2b })
  }

  /**
   * No-op in native mode (no worker to terminate)
   */
  dispose() {
    this.setupChecked = false
  }
}

// Singleton instance for convenience
let defaultProver: SnarkProver | null = null

export function getSnarkProver(config?: ProverConfig): SnarkProver {
  if (!defaultProver) {
    defaultProver = new SnarkProver(config)
  }
  return defaultProver
}
