/**
 * SNARK Prover Service
 *
 * High-level API for generating Groth16 proofs in the browser.
 * Manages the Web Worker, file caching, and proof generation.
 *
 * Usage:
 *   const prover = new SnarkProver()
 *   await prover.initialize()
 *   const proof = await prover.generateProof({ a, r, v, w0, w1 })
 */

import { snarkStorage, formatBytes, EXPECTED_FILE_SIZES } from './storage'
import type {
  WorkerMessage,
  WorkerResponse,
} from './worker'

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
  stage: 'checking-cache' | 'downloading' | 'loading-wasm' | 'loading-keys' | 'proving' | 'complete'
  message: string
  percent: number
  downloadProgress?: {
    fileName: string
    loaded: number
    total: number
  }
}

export interface ProverConfig {
  /** Use stub mode for development (no real proof generation) */
  useStubs?: boolean
  /** Stub proof delay in milliseconds */
  stubDelayMs?: number
  /** Base URL for SNARK files (default: '/snark') */
  baseUrl?: string
  /** URLs for circuit files (for loading from external locations like file://) */
  circuitFilesUrl?: string
}

export class SnarkProver {
  private worker: Worker | null = null
  private isInitialized = false
  private initPromise: Promise<void> | null = null
  private config: Required<ProverConfig>

  constructor(config: ProverConfig = {}) {
    this.config = {
      useStubs: config.useStubs ?? import.meta.env.VITE_USE_STUBS === 'true',
      stubDelayMs: config.stubDelayMs ?? 3000,
      baseUrl: config.baseUrl ?? '/snark',
      circuitFilesUrl: config.circuitFilesUrl ?? '',
    }
  }

  /**
   * Check if SNARK files are cached in IndexedDB
   */
  async checkCache(): Promise<{ cached: boolean; sizes: { pk: number | null; ccs: number | null } }> {
    const cached = await snarkStorage.hasAllFiles()
    const sizes = await snarkStorage.getCachedFileSizes()
    return { cached, sizes }
  }

  /**
   * Download SNARK files if not cached
   *
   * @param onProgress - Progress callback for download updates
   * @returns true if files were downloaded, false if already cached
   */
  async ensureFilesDownloaded(
    onProgress?: (progress: ProvingProgress) => void
  ): Promise<boolean> {
    const { cached } = await this.checkCache()

    if (cached) {
      onProgress?.({
        stage: 'checking-cache',
        message: 'SNARK files already cached',
        percent: 100,
      })
      return false
    }

    // Download files
    const filesToDownload = [
      { name: 'pk.bin', size: EXPECTED_FILE_SIZES['pk.bin'] },
      { name: 'ccs.bin', size: EXPECTED_FILE_SIZES['ccs.bin'] },
    ]

    const totalSize = filesToDownload.reduce((sum, f) => sum + f.size, 0)
    let downloadedSize = 0

    for (const file of filesToDownload) {
      const url = this.config.circuitFilesUrl
        ? `${this.config.circuitFilesUrl}/${file.name}`
        : `${this.config.baseUrl}/${file.name}`

      await snarkStorage.downloadAndCache(url, file.name, (progress) => {
        const overallPercent = Math.round(
          ((downloadedSize + progress.loaded) / totalSize) * 100
        )
        onProgress?.({
          stage: 'downloading',
          message: `Downloading ${file.name}...`,
          percent: overallPercent,
          downloadProgress: {
            fileName: file.name,
            loaded: progress.loaded,
            total: progress.total,
          },
        })
      })

      downloadedSize += file.size
    }

    return true
  }

  /**
   * Get total size of files to download (for UI display)
   */
  getTotalDownloadSize(): number {
    return EXPECTED_FILE_SIZES['pk.bin'] + EXPECTED_FILE_SIZES['ccs.bin']
  }

  /**
   * Initialize the prover (loads WASM and proving keys)
   *
   * @param onProgress - Progress callback for initialization updates
   */
  async initialize(onProgress?: (progress: ProvingProgress) => void): Promise<void> {
    if (this.isInitialized) return

    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = this._doInitialize(onProgress)
    return this.initPromise
  }

  private async _doInitialize(onProgress?: (progress: ProvingProgress) => void): Promise<void> {
    try {
      // Step 1: Ensure files are downloaded
      await this.ensureFilesDownloaded(onProgress)

      if (this.config.useStubs) {
        // In stub mode, we don't need to actually load the WASM
        onProgress?.({
          stage: 'complete',
          message: 'Prover ready (stub mode)',
          percent: 100,
        })
        this.isInitialized = true
        return
      }

      // Step 2: Create and initialize the worker
      onProgress?.({
        stage: 'loading-wasm',
        message: 'Loading WASM prover...',
        percent: 0,
      })

      // Load files from IndexedDB
      const pkFile = await snarkStorage.getFile('pk.bin')
      const ccsFile = await snarkStorage.getFile('ccs.bin')

      if (!pkFile || !ccsFile) {
        throw new Error('Proving keys not found in cache')
      }

      // Create worker
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

      // Wait for worker to initialize
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Worker initialization timeout'))
        }, 60000) // 60 second timeout

        const handleMessage = (event: MessageEvent<WorkerResponse>) => {
          const msg = event.data

          if (msg.type === 'progress') {
            onProgress?.({
              stage: msg.stage as ProvingProgress['stage'],
              message: msg.message,
              percent: msg.percent ?? 0,
            })
          } else if (msg.type === 'ready') {
            clearTimeout(timeout)
            this.worker?.removeEventListener('message', handleMessage)
            resolve()
          } else if (msg.type === 'error') {
            clearTimeout(timeout)
            this.worker?.removeEventListener('message', handleMessage)
            reject(new Error(msg.message))
          }
        }

        this.worker!.addEventListener('message', handleMessage)

        // Send init message
        this.worker!.postMessage({
          type: 'init',
          wasmUrl: `${this.config.baseUrl}/prover.wasm`,
          pkData: pkFile.data,
          ccsData: ccsFile.data,
        } as WorkerMessage)
      })

      onProgress?.({
        stage: 'complete',
        message: 'Prover ready',
        percent: 100,
      })

      this.isInitialized = true
    } catch (error) {
      this.initPromise = null
      throw error
    }
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
    // Ensure initialized
    await this.initialize(onProgress)

    if (this.config.useStubs) {
      return this._generateStubProof(onProgress)
    }

    if (!this.worker) {
      throw new Error('Worker not initialized')
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Proof generation timeout (exceeded 5 minutes)'))
      }, 5 * 60 * 1000) // 5 minute timeout

      const handleMessage = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data

        if (msg.type === 'progress') {
          onProgress?.({
            stage: 'proving',
            message: msg.message,
            percent: msg.percent ?? 0,
          })
        } else if (msg.type === 'proof') {
          clearTimeout(timeout)
          this.worker?.removeEventListener('message', handleMessage)
          resolve({
            proofJson: msg.proofJson,
            publicJson: msg.publicJson,
          })
        } else if (msg.type === 'error') {
          clearTimeout(timeout)
          this.worker?.removeEventListener('message', handleMessage)
          reject(new Error(msg.message))
        }
      }

      this.worker!.addEventListener('message', handleMessage)

      // Send prove message
      this.worker!.postMessage({
        type: 'prove',
        secretA: inputs.secretA,
        secretR: inputs.secretR,
        publicV: inputs.publicV,
        publicW0: inputs.publicW0,
        publicW1: inputs.publicW1,
      } as WorkerMessage)
    })
  }

  private async _generateStubProof(
    onProgress?: (progress: ProvingProgress) => void
  ): Promise<SnarkProof> {
    // Simulate proving with delays
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

    // Return stub proof
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
   * Terminate the worker and clean up resources
   */
  dispose() {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    this.isInitialized = false
    this.initPromise = null
  }

  /**
   * Clear cached SNARK files
   */
  async clearCache(): Promise<void> {
    await snarkStorage.clearCache()
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

// Re-export utilities
export { formatBytes, EXPECTED_FILE_SIZES }
