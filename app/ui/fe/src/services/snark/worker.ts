/**
 * SNARK Prover Web Worker
 *
 * This worker runs the Go WASM-based Groth16 prover in a separate thread
 * to keep the UI responsive during the 10-30 second proving time.
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

// Declare the global gnarkProve function exposed by the WASM module
declare function gnarkProve(
  secretA: string,
  secretR: string,
  publicV: string,
  publicW0: string,
  publicW1: string,
  pkData: ArrayBuffer,
  ccsData: ArrayBuffer
): string

export interface InitMessage {
  type: 'init'
  wasmUrl: string
  pkData: ArrayBuffer
  ccsData: ArrayBuffer
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

export type WorkerMessage = InitMessage | ProveMessage | StubProveMessage

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

export type WorkerResponse = ReadyResponse | ProgressResponse | ProofResponse | ErrorResponse

let go: Go | null = null
let wasmInstance: WebAssembly.Instance | null = null
let pkData: ArrayBuffer | null = null
let ccsData: ArrayBuffer | null = null
let isInitialized = false

/**
 * Send progress update to main thread
 */
function sendProgress(stage: ProgressResponse['stage'], message: string, percent?: number) {
  self.postMessage({ type: 'progress', stage, message, percent } as ProgressResponse)
}

/**
 * Send error to main thread
 */
function sendError(message: string, stage?: string) {
  self.postMessage({ type: 'error', message, stage } as ErrorResponse)
}

/**
 * Initialize the WASM module and proving keys
 */
async function initialize(msg: InitMessage) {
  try {
    sendProgress('loading-wasm', 'Loading Go WASM runtime...')

    // Import wasm_exec.js which defines the Go class
    // Note: In a worker, we need to use importScripts
    const wasmExecUrl = new URL('/snark/wasm_exec.js', self.location.origin).href
    importScripts(wasmExecUrl)

    go = new Go()

    sendProgress('loading-wasm', 'Loading SNARK prover WASM...', 20)

    // Fetch and instantiate the WASM module
    const wasmResponse = await fetch(msg.wasmUrl)
    const wasmBytes = await wasmResponse.arrayBuffer()

    sendProgress('loading-wasm', 'Instantiating WASM module...', 40)

    const result = await WebAssembly.instantiate(wasmBytes, go!.importObject)
    wasmInstance = result.instance

    // Start the Go runtime (runs in background)
    go!.run(wasmInstance).catch((err) => {
      console.error('Go runtime exited:', err)
    })

    sendProgress('loading-keys', 'Loading proving keys...', 60)

    // Store the proving keys
    pkData = msg.pkData
    ccsData = msg.ccsData

    sendProgress('loading-keys', 'Proving keys loaded', 100)

    isInitialized = true
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

    // Check if gnarkProve is available
    if (typeof gnarkProve !== 'function') {
      sendError(
        'gnarkProve function not found. Make sure prover.wasm was compiled with WASM entry point.',
        'prove'
      )
      return
    }

    sendProgress('proving', 'Generating zero-knowledge proof...', 10)

    // Call the WASM prover
    const resultJson = gnarkProve(
      msg.secretA,
      msg.secretR,
      msg.publicV,
      msg.publicW0,
      msg.publicW1,
      pkData!,
      ccsData!
    )

    sendProgress('proving', 'Proof generation complete', 100)

    // Parse the result (expected format: { proof: {...}, public: {...} })
    const result = JSON.parse(resultJson)

    self.postMessage({
      type: 'proof',
      proofJson: JSON.stringify(result.proof),
      publicJson: JSON.stringify(result.public),
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
 * Handle messages from main thread
 */
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data

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
    default:
      sendError(`Unknown message type: ${(msg as { type: string }).type}`)
  }
}

// Signal that the worker script is loaded
self.postMessage({ type: 'ready', stage: 'script-loaded' })

export {}
