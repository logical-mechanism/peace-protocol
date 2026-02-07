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
  HashResponse,
  HashErrorResponse,
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
  private hashRequestId = 0
  private pendingHashRequests = new Map<string, { resolve: (hash: string) => void; reject: (error: Error) => void }>()

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
    console.log('[SnarkProver] checkCache: cached =', cached, 'sizes =', sizes)
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
    console.log('[SnarkProver] ensureFilesDownloaded: checking cache...')
    const { cached, sizes } = await this.checkCache()
    console.log('[SnarkProver] ensureFilesDownloaded: cached =', cached, 'sizes =', sizes)

    if (cached) {
      console.log('[SnarkProver] ensureFilesDownloaded: files already cached, skipping download')
      onProgress?.({
        stage: 'checking-cache',
        message: 'SNARK files already cached',
        percent: 100,
      })
      return false
    }

    console.log('[SnarkProver] ensureFilesDownloaded: files not cached, starting download...')
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
      console.log(`[SnarkProver] ensureFilesDownloaded: ${file.name} downloaded and cached`)
    }

    console.log('[SnarkProver] ensureFilesDownloaded: all files downloaded')
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
      // Step 1: Ensure files are downloaded (even in stub mode, for the WASM module)
      console.log('[SnarkProver] _doInitialize: starting, calling ensureFilesDownloaded...')
      const downloaded = await this.ensureFilesDownloaded(onProgress)
      console.log('[SnarkProver] _doInitialize: ensureFilesDownloaded returned', downloaded)

      // Step 2: Create and initialize the worker
      // Even in stub mode, we create the worker for hash functions (gtToHash, decryptToHash)
      onProgress?.({
        stage: 'loading-wasm',
        message: 'Loading WASM prover...',
        percent: 0,
      })

      // Load files from IndexedDB
      console.log('[SnarkProver] _doInitialize: loading files from IndexedDB...')
      const pkFile = await snarkStorage.getFile('pk.bin')
      const ccsFile = await snarkStorage.getFile('ccs.bin')
      console.log('[SnarkProver] _doInitialize: pkFile =', pkFile ? `${pkFile.size} bytes` : 'null')
      console.log('[SnarkProver] _doInitialize: ccsFile =', ccsFile ? `${ccsFile.size} bytes` : 'null')

      if (!pkFile || !ccsFile) {
        console.error('[SnarkProver] _doInitialize: files missing after ensureFilesDownloaded!')
        throw new Error('Proving keys not found in cache')
      }

      // Create worker
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

      // Set up permanent message handler for hash responses
      this.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data
        if (msg.type === 'hash' || msg.type === 'hashError') {
          this.handleHashResponse(msg as HashResponse | HashErrorResponse)
        }
      })

      // Wait for worker to initialize
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Worker initialization timeout'))
        }, 3 * 60 * 60 * 1000) // 3 hour timeout (proving key deserialization can take 100+ minutes)

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
        // In stub mode, skip proving key setup but still load WASM for hash functions
        this.worker!.postMessage({
          type: 'init',
          wasmUrl: `${this.config.baseUrl}/prover.wasm`,
          pkData: pkFile.data,
          ccsData: ccsFile.data,
          skipProvingKeySetup: this.config.useStubs,
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

  /**
   * Check if the worker is available for hash operations.
   * Hash operations are available once the WASM loads, before the full proving key setup.
   */
  isWorkerReady(): boolean {
    return this.worker !== null
  }

  /**
   * Compute GT hash from scalar a.
   * This is a lightweight operation available once WASM loads.
   * Used for creating encryption listings.
   *
   * @param secretA - Secret scalar (hex string with 0x prefix or decimal)
   * @returns Hash as hex string (56 chars)
   */
  async gtToHash(secretA: string): Promise<string> {
    if (!this.worker) {
      throw new Error('Worker not initialized. Call initialize() first.')
    }

    const id = `gtToHash-${++this.hashRequestId}`

    return new Promise((resolve, reject) => {
      this.pendingHashRequests.set(id, { resolve, reject })

      const timeout = setTimeout(() => {
        this.pendingHashRequests.delete(id)
        reject(new Error('gtToHash timeout'))
      }, 30000) // 30 second timeout

      const cleanup = () => {
        clearTimeout(timeout)
        this.pendingHashRequests.delete(id)
      }

      // Wrap resolve/reject to include cleanup
      const wrappedResolve = (hash: string) => {
        cleanup()
        resolve(hash)
      }
      const wrappedReject = (error: Error) => {
        cleanup()
        reject(error)
      }

      this.pendingHashRequests.set(id, { resolve: wrappedResolve, reject: wrappedReject })

      this.worker!.postMessage({
        type: 'gtToHash',
        id,
        secretA,
      } as WorkerMessage)
    })
  }

  /**
   * Compute decryption hash.
   * This is a lightweight operation available once WASM loads.
   * Used for decrypting encrypted data.
   *
   * @param g1b - G1 point (96 hex chars)
   * @param r1 - G1 point (96 hex chars)
   * @param shared - G2 point (192 hex chars)
   * @param g2b - G2 point (192 hex chars) or empty string for half-level
   * @returns Hash as hex string (56 chars)
   */
  async decryptToHash(g1b: string, r1: string, shared: string, g2b: string = ''): Promise<string> {
    if (!this.worker) {
      throw new Error('Worker not initialized. Call initialize() first.')
    }

    const id = `decryptToHash-${++this.hashRequestId}`

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingHashRequests.delete(id)
        reject(new Error('decryptToHash timeout'))
      }, 30000) // 30 second timeout

      const cleanup = () => {
        clearTimeout(timeout)
        this.pendingHashRequests.delete(id)
      }

      // Wrap resolve/reject to include cleanup
      const wrappedResolve = (hash: string) => {
        cleanup()
        resolve(hash)
      }
      const wrappedReject = (error: Error) => {
        cleanup()
        reject(error)
      }

      this.pendingHashRequests.set(id, { resolve: wrappedResolve, reject: wrappedReject })

      this.worker!.postMessage({
        type: 'decryptToHash',
        id,
        g1b,
        r1,
        shared,
        g2b,
      } as WorkerMessage)
    })
  }

  /**
   * Handle hash responses from worker.
   * Called internally when worker sends hash or hashError messages.
   */
  private handleHashResponse(msg: HashResponse | HashErrorResponse) {
    const pending = this.pendingHashRequests.get(msg.id)
    if (!pending) {
      console.warn(`[SnarkProver] Received hash response for unknown request: ${msg.id}`)
      return
    }

    if (msg.type === 'hash') {
      pending.resolve(msg.hash)
    } else {
      pending.reject(new Error(msg.error))
    }
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
