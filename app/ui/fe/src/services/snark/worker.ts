/**
 * SNARK Prover Web Worker
 *
 * This worker runs the Go WASM-based Groth16 prover in a separate thread
 * to keep the UI responsive during the long setup loading and proving.
 *
 * Communication protocol:
 * - Main thread sends: { type: 'init' | 'prove', ... }
 * - Worker responds: { type: 'ready' | 'progress' | 'proof' | 'error', ... }
 */

/// <reference lib="webworker" />

declare const self: DedicatedWorkerGlobalScope

// Declare the Go WASM runtime types
declare class Go {
  importObject: WebAssembly.Imports
  run(instance: WebAssembly.Instance): Promise<void>
}

// Declare the global functions exposed by the WASM module
// These are set by wasm_main.go via js.Global().Set(...)
declare function gnarkLoadSetup(ccsBytes: Uint8Array, pkBytes: Uint8Array): { success?: boolean; error?: string }
declare function gnarkProve(
  secretA: string,
  secretR: string,
  publicV: string,
  publicW0: string,
  publicW1: string
): string | { error: string }
declare function gnarkIsReady(): boolean
declare function gnarkGtToHash(aStr: string): { hash?: string; error?: string }
declare function gnarkDecryptToHash(g1b: string, r1: string, shared: string, g2b: string): { hash?: string; error?: string }

export interface InitMessage {
  type: 'init'
  wasmUrl: string
  pkData: ArrayBuffer
  ccsData: ArrayBuffer
  /** If true, skip loading proving keys (for stub mode - hash functions still work) */
  skipProvingKeySetup?: boolean
}

export interface ProveMessage {
  type: 'prove'
  secretA: string
  secretR: string
  publicV: string
  publicW0: string
  publicW1: string
}

export interface StubProveMessage {
  type: 'stubProve'
  delayMs?: number
}

export interface GtToHashMessage {
  type: 'gtToHash'
  id: string  // For correlating request/response
  secretA: string
}

export interface DecryptToHashMessage {
  type: 'decryptToHash'
  id: string  // For correlating request/response
  g1b: string
  r1: string
  shared: string
  g2b: string
}

export type WorkerMessage = InitMessage | ProveMessage | StubProveMessage | GtToHashMessage | DecryptToHashMessage

export interface ReadyResponse {
  type: 'ready'
}

export interface ProgressResponse {
  type: 'progress'
  stage: 'loading-wasm' | 'loading-keys' | 'proving'
  message: string
  percent?: number
}

export interface ProofResponse {
  type: 'proof'
  proofJson: string
  publicJson: string
}

export interface ErrorResponse {
  type: 'error'
  message: string
  stage?: string
}

export interface HashResponse {
  type: 'hash'
  id: string  // For correlating with request
  hash: string
}

export interface HashErrorResponse {
  type: 'hashError'
  id: string  // For correlating with request
  error: string
}

export type WorkerResponse = ReadyResponse | ProgressResponse | ProofResponse | ErrorResponse | HashResponse | HashErrorResponse

let go: Go | null = null
let wasmInstance: WebAssembly.Instance | null = null
let isInitialized = false
let isWasmLoaded = false  // WASM loaded but proving keys may not be ready yet

/**
 * Send progress update to main thread
 */
function sendProgress(stage: ProgressResponse['stage'], message: string, percent?: number) {
  console.log(`[Worker] Progress: ${stage} - ${message} (${percent ?? '?'}%)`)
  self.postMessage({ type: 'progress', stage, message, percent } as ProgressResponse)
}

/**
 * Send error to main thread
 */
function sendError(message: string, stage?: string) {
  console.error(`[Worker] Error in ${stage ?? 'unknown'}: ${message}`)
  self.postMessage({ type: 'error', message, stage } as ErrorResponse)
}

/**
 * Load wasm_exec.js in a module worker context.
 * Module workers don't support importScripts(), so we fetch and evaluate the script.
 */
async function loadWasmExec(): Promise<void> {
  const wasmExecUrl = new URL('/snark/wasm_exec.js', self.location.origin).href
  console.log(`[Worker] Loading wasm_exec.js from: ${wasmExecUrl}`)

  const response = await fetch(wasmExecUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch wasm_exec.js: HTTP ${response.status}`)
  }

  const scriptText = await response.text()
  console.log(`[Worker] wasm_exec.js fetched (${scriptText.length} bytes)`)

  // Evaluate the script in the global scope
  // wasm_exec.js sets up the global Go class
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const evalScript = new Function(scriptText)
  evalScript()

  // Verify Go class is available
  if (typeof (globalThis as unknown as { Go: typeof Go }).Go !== 'function') {
    throw new Error('wasm_exec.js did not define the Go class')
  }
  console.log('[Worker] wasm_exec.js loaded successfully')
}

/**
 * Initialize the WASM module and proving keys
 */
async function initialize(msg: InitMessage) {
  try {
    console.log('[Worker] Starting initialization...')
    sendProgress('loading-wasm', 'Loading Go WASM runtime...', 0)

    // Load wasm_exec.js which defines the Go class
    await loadWasmExec()

    // Access Go from globalThis since wasm_exec.js sets it there
    const GoClass = (globalThis as unknown as { Go: typeof Go }).Go
    go = new GoClass()
    console.log('[Worker] Go runtime object created')

    sendProgress('loading-wasm', 'Fetching SNARK prover WASM...', 10)

    // Fetch and instantiate the WASM module
    console.log(`[Worker] Fetching WASM from: ${msg.wasmUrl}`)
    const wasmResponse = await fetch(msg.wasmUrl)
    if (!wasmResponse.ok) {
      throw new Error(`Failed to fetch WASM: HTTP ${wasmResponse.status}`)
    }
    const wasmBytes = await wasmResponse.arrayBuffer()
    console.log(`[Worker] WASM fetched: ${(wasmBytes.byteLength / 1024 / 1024).toFixed(2)} MB`)

    sendProgress('loading-wasm', 'Instantiating WASM module...', 20)

    const result = await WebAssembly.instantiate(wasmBytes, go!.importObject)
    wasmInstance = result.instance
    console.log('[Worker] WASM instantiated')

    sendProgress('loading-wasm', 'Starting Go runtime...', 25)

    // Start the Go runtime (runs in background)
    // This returns a promise that resolves when the Go program exits
    go!.run(wasmInstance).catch((err) => {
      console.error('[Worker] Go runtime exited with error:', err)
    })

    // Wait a moment for Go runtime to initialize and register functions
    await new Promise(resolve => setTimeout(resolve, 100))
    console.log('[Worker] Go runtime started')

    // Verify gnarkLoadSetup is available
    if (typeof gnarkLoadSetup !== 'function') {
      throw new Error('gnarkLoadSetup function not found - WASM may not have initialized correctly')
    }
    console.log('[Worker] gnarkLoadSetup function is available')

    // Mark WASM as loaded - hash functions are now available even before proving keys load
    isWasmLoaded = true
    console.log('[Worker] WASM loaded - hash functions (gnarkGtToHash, gnarkDecryptToHash) are now available')

    // In stub mode, skip the slow proving key setup but hash functions are available
    if (msg.skipProvingKeySetup) {
      console.log('[Worker] Skipping proving key setup (stub mode) - hash functions available')
      sendProgress('loading-keys', 'Proving key setup skipped (stub mode)', 100)
      isInitialized = true
      self.postMessage({ type: 'ready' } as ReadyResponse)
      return
    }

    sendProgress('loading-keys', 'Loading proving keys into WASM (this takes ~99 minutes)...', 30)
    console.log('[Worker] Calling gnarkLoadSetup with CCS and PK data...')
    console.log(`[Worker] CCS size: ${(msg.ccsData.byteLength / 1024 / 1024).toFixed(2)} MB`)
    console.log(`[Worker] PK size: ${(msg.pkData.byteLength / 1024 / 1024).toFixed(2)} MB`)

    // Convert ArrayBuffer to Uint8Array for the WASM function
    const ccsBytes = new Uint8Array(msg.ccsData)
    const pkBytes = new Uint8Array(msg.pkData)

    // This is the long-running operation
    // In a Web Worker, it won't freeze the UI
    const loadStart = Date.now()
    const loadResult = gnarkLoadSetup(ccsBytes, pkBytes)
    const loadElapsed = ((Date.now() - loadStart) / 1000).toFixed(1)

    if (loadResult.error) {
      throw new Error(`gnarkLoadSetup failed: ${loadResult.error}`)
    }

    console.log(`[Worker] gnarkLoadSetup completed in ${loadElapsed}s`)
    sendProgress('loading-keys', 'Proving keys loaded successfully', 100)

    // Verify prover is ready
    if (typeof gnarkIsReady === 'function' && !gnarkIsReady()) {
      throw new Error('gnarkLoadSetup returned success but gnarkIsReady() is false')
    }

    isInitialized = true
    console.log('[Worker] Initialization complete! Ready to generate proofs.')
    self.postMessage({ type: 'ready' } as ReadyResponse)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown initialization error'
    sendError(message, 'init')
  }
}

/**
 * Generate a SNARK proof
 */
async function prove(msg: ProveMessage) {
  if (!isInitialized) {
    sendError('Worker not initialized. Call init first.', 'prove')
    return
  }

  try {
    sendProgress('proving', 'Starting proof generation...', 0)
    console.log('[Worker] Starting proof generation...')

    // Check if gnarkProve is available
    if (typeof gnarkProve !== 'function') {
      sendError(
        'gnarkProve function not found. Make sure prover.wasm was compiled with WASM entry point.',
        'prove'
      )
      return
    }

    sendProgress('proving', 'Generating zero-knowledge proof (this may take a few minutes)...', 10)

    // Call the WASM prover
    const proveStart = Date.now()
    const result = gnarkProve(
      msg.secretA,
      msg.secretR,
      msg.publicV,
      msg.publicW0,
      msg.publicW1
    )
    const proveElapsed = ((Date.now() - proveStart) / 1000).toFixed(1)

    console.log(`[Worker] gnarkProve completed in ${proveElapsed}s`)

    // Check for error response
    if (typeof result === 'object' && result.error) {
      throw new Error(`gnarkProve failed: ${result.error}`)
    }

    // Result should be a JSON string
    if (typeof result !== 'string') {
      throw new Error(`Unexpected result type from gnarkProve: ${typeof result}`)
    }

    sendProgress('proving', 'Proof generation complete', 100)

    // Parse the result (expected format: { proof: {...}, public: {...} })
    const parsed = JSON.parse(result)

    self.postMessage({
      type: 'proof',
      proofJson: JSON.stringify(parsed.proof),
      publicJson: JSON.stringify(parsed.public),
    } as ProofResponse)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown proving error'
    sendError(message, 'prove')
  }
}

/**
 * Generate a stub proof for development/testing
 * Simulates the proving process with a delay
 */
async function stubProve(msg: StubProveMessage) {
  const delayMs = msg.delayMs ?? 3000 // Default 3 seconds for demo

  try {
    sendProgress('proving', 'Starting stub proof generation...', 0)

    // Simulate progress updates
    const steps = 10
    for (let i = 1; i <= steps; i++) {
      await new Promise((resolve) => setTimeout(resolve, delayMs / steps))
      sendProgress('proving', `Generating proof (stub mode)...`, (i / steps) * 100)
    }

    // Return a stub proof that matches the expected format
    // This is NOT a valid proof - just for UI development
    const stubProof = {
      piA: 'a'.repeat(96),
      piB: 'b'.repeat(192),
      piC: 'c'.repeat(96),
      commitments: ['d'.repeat(96)],
      commitmentPok: 'e'.repeat(96),
    }

    const stubPublic = {
      inputs: ['1', '2', '3'],
      commitmentWire: '12345',
    }

    self.postMessage({
      type: 'proof',
      proofJson: JSON.stringify(stubProof),
      publicJson: JSON.stringify(stubPublic),
    } as ProofResponse)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    sendError(message, 'stubProve')
  }
}

/**
 * Compute GT hash from scalar a
 * This is a lightweight operation available once WASM loads (doesn't need proving keys)
 */
function handleGtToHash(msg: GtToHashMessage) {
  if (!isWasmLoaded) {
    self.postMessage({
      type: 'hashError',
      id: msg.id,
      error: 'WASM not loaded yet. Call init first.',
    } as HashErrorResponse)
    return
  }

  try {
    if (typeof gnarkGtToHash !== 'function') {
      throw new Error('gnarkGtToHash function not available')
    }

    console.log(`[Worker] gtToHash called with a = ${msg.secretA.slice(0, 20)}...`)
    const result = gnarkGtToHash(msg.secretA)

    if (result.error) {
      throw new Error(result.error)
    }

    console.log(`[Worker] gtToHash result: ${result.hash?.slice(0, 20)}...`)
    self.postMessage({
      type: 'hash',
      id: msg.id,
      hash: result.hash!,
    } as HashResponse)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Worker] gtToHash error: ${message}`)
    self.postMessage({
      type: 'hashError',
      id: msg.id,
      error: message,
    } as HashErrorResponse)
  }
}

/**
 * Compute decryption hash
 * This is a lightweight operation available once WASM loads (doesn't need proving keys)
 */
function handleDecryptToHash(msg: DecryptToHashMessage) {
  if (!isWasmLoaded) {
    self.postMessage({
      type: 'hashError',
      id: msg.id,
      error: 'WASM not loaded yet. Call init first.',
    } as HashErrorResponse)
    return
  }

  try {
    if (typeof gnarkDecryptToHash !== 'function') {
      throw new Error('gnarkDecryptToHash function not available')
    }

    console.log(`[Worker] decryptToHash called`)
    const result = gnarkDecryptToHash(msg.g1b, msg.r1, msg.shared, msg.g2b)

    if (result.error) {
      throw new Error(result.error)
    }

    console.log(`[Worker] decryptToHash result: ${result.hash?.slice(0, 20)}...`)
    self.postMessage({
      type: 'hash',
      id: msg.id,
      hash: result.hash!,
    } as HashResponse)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Worker] decryptToHash error: ${message}`)
    self.postMessage({
      type: 'hashError',
      id: msg.id,
      error: message,
    } as HashErrorResponse)
  }
}

/**
 * Handle messages from main thread
 */
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data
  console.log(`[Worker] Received message: ${msg.type}`)

  switch (msg.type) {
    case 'init':
      await initialize(msg)
      break
    case 'prove':
      await prove(msg)
      break
    case 'stubProve':
      await stubProve(msg)
      break
    case 'gtToHash':
      handleGtToHash(msg)
      break
    case 'decryptToHash':
      handleDecryptToHash(msg)
      break
    default:
      sendError(`Unknown message type: ${(msg as { type: string }).type}`)
  }
}

// Signal that the worker script is loaded
console.log('[Worker] Worker script loaded')
self.postMessage({ type: 'progress', stage: 'loading-wasm', message: 'Worker script loaded', percent: 0 })

export {}
