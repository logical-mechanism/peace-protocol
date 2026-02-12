/**
 * WASM Context
 *
 * Provides global state management for WASM prover loading status.
 * This allows the loading status to persist across route changes and
 * enables the "Continue in Background" feature.
 */

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import { getSnarkProver } from '../services/snark'
import type { ProvingProgress } from '../services/snark'

export type WasmStage =
  | 'idle'
  | 'checking-cache'
  | 'downloading-ccs'
  | 'downloading-pk'
  | 'loading-wasm'
  | 'deserializing-ccs'
  | 'deserializing-pk'
  | 'ready'
  | 'error'

export interface WasmLog {
  time: string
  message: string
  type: 'info' | 'success' | 'error' | 'worker'
}

export interface WasmContextValue {
  /** Whether the WASM prover is fully loaded and ready */
  isReady: boolean
  /** Whether loading is in progress */
  isLoading: boolean
  /** Whether files are cached in IndexedDB */
  isCached: boolean | null
  /** Current loading stage */
  stage: WasmStage
  /** Progress percentage (0-100) */
  progress: number
  /** Status message for current stage */
  statusMessage: string
  /** Elapsed time in seconds since loading started */
  elapsedTime: number
  /** Error message if loading failed */
  error: string | null
  /** Log messages for debugging */
  logs: WasmLog[]
  /** Start the loading process */
  startLoading: () => Promise<void>
  /** Check if files are cached */
  checkCache: () => Promise<boolean>
  /** Clear error state */
  clearError: () => void
}

const WasmContext = createContext<WasmContextValue | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useWasm(): WasmContextValue {
  const context = useContext(WasmContext)
  if (!context) {
    throw new Error('useWasm must be used within a WasmProvider')
  }
  return context
}

const STAGE_MESSAGES: Record<WasmStage, string> = {
  'idle': 'Waiting to start...',
  'checking-cache': 'Checking for cached files...',
  'downloading-ccs': 'Downloading constraint system (~52 MB)...',
  'downloading-pk': 'Downloading proving key (~447 MB)...',
  'loading-wasm': 'Loading WASM runtime...',
  'deserializing-ccs': 'Initializing constraint system...',
  'deserializing-pk': 'Loading proving key... This takes ~99 minutes',
  'ready': 'Ready to generate proofs',
  'error': 'Loading failed',
}

export function WasmProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isCached, setIsCached] = useState<boolean | null>(null)
  const [stage, setStage] = useState<WasmStage>('idle')
  const [progress, setProgress] = useState(0)
  const [statusMessage, setStatusMessage] = useState(STAGE_MESSAGES['idle'])
  const [elapsedTime, setElapsedTime] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<WasmLog[]>([])

  const timerRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | null>(null)
  const loadingPromiseRef = useRef<Promise<void> | null>(null)

  const addLog = useCallback((message: string, type: WasmLog['type'] = 'info') => {
    const time = new Date().toISOString().substring(11, 23)
    setLogs(prev => [...prev, { time, message, type }])
  }, [])

  const startTimer = useCallback(() => {
    if (timerRef.current) return
    startTimeRef.current = Date.now()
    timerRef.current = window.setInterval(() => {
      if (startTimeRef.current) {
        setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }
    }, 1000)
  }, [])

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => stopTimer()
  }, [stopTimer])

  const updateStage = useCallback((newStage: WasmStage, message?: string) => {
    setStage(newStage)
    const msg = message || STAGE_MESSAGES[newStage]
    setStatusMessage(msg)
    addLog(msg, newStage === 'error' ? 'error' : newStage === 'ready' ? 'success' : 'info')
  }, [addLog])

  const checkCache = useCallback(async (): Promise<boolean> => {
    try {
      const prover = getSnarkProver()
      const { cached } = await prover.checkCache()
      setIsCached(cached)
      return cached
    } catch (err) {
      console.error('Failed to check cache:', err)
      return false
    }
  }, [])

  const startLoading = useCallback(async (): Promise<void> => {
    // If already loading, return the existing promise
    if (loadingPromiseRef.current) {
      return loadingPromiseRef.current
    }

    // If already ready, return immediately
    if (isReady) {
      return
    }

    const doLoad = async () => {
      setIsLoading(true)
      setError(null)
      setLogs([])
      startTimer()

      try {
        const prover = getSnarkProver()

        // Stage 1: Check cache
        updateStage('checking-cache')
        setProgress(2)
        const { cached } = await prover.checkCache()
        setIsCached(cached)

        if (cached) {
          addLog('Files found in cache', 'success')
          setProgress(30)
        } else {
          addLog('Files not cached, downloading required')
        }

        // Stage 2-3: Download files if needed (handled by initialize)
        // Stage 4-6: Load WASM and deserialize (handled by initialize)

        await prover.initialize((progressInfo: ProvingProgress) => {
          // Map prover progress to our stages
          switch (progressInfo.stage) {
            case 'checking-cache':
              updateStage('checking-cache')
              setProgress(Math.min(5, progressInfo.percent * 0.05))
              break
            case 'downloading':
              if (progressInfo.downloadProgress?.fileName === 'ccs.bin') {
                updateStage('downloading-ccs', `Downloading ccs.bin (${Math.round(progressInfo.percent)}%)...`)
                setProgress(5 + (progressInfo.percent * 0.1))
              } else if (progressInfo.downloadProgress?.fileName === 'pk.bin') {
                updateStage('downloading-pk', `Downloading pk.bin (${Math.round(progressInfo.percent)}%)...`)
                setProgress(15 + (progressInfo.percent * 0.15))
              }
              break
            case 'loading-wasm':
              updateStage('loading-wasm', progressInfo.message)
              setProgress(30 + (progressInfo.percent * 0.05))
              break
            case 'loading-keys':
              // This is the long phase - deserializing CCS and PK
              if (progressInfo.percent < 30) {
                updateStage('deserializing-ccs', progressInfo.message)
                setProgress(35 + (progressInfo.percent * 0.33))
              } else {
                updateStage('deserializing-pk', progressInfo.message)
                setProgress(45 + ((progressInfo.percent - 30) * 0.78))
              }
              break
            case 'complete':
              updateStage('ready')
              setProgress(100)
              break
          }
        })

        updateStage('ready')
        setProgress(100)
        setIsReady(true)
        addLog('WASM prover initialized successfully!', 'success')
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        updateStage('error', `Loading failed: ${message}`)
        setError(message)
        addLog(`Error: ${message}`, 'error')
        throw err
      } finally {
        stopTimer()
        setIsLoading(false)
        loadingPromiseRef.current = null
      }
    }

    loadingPromiseRef.current = doLoad()
    return loadingPromiseRef.current
  }, [isReady, startTimer, stopTimer, updateStage, addLog])

  const clearError = useCallback(() => {
    setError(null)
    setStage('idle')
    setStatusMessage(STAGE_MESSAGES['idle'])
  }, [])

  const value: WasmContextValue = {
    isReady,
    isLoading,
    isCached,
    stage,
    progress,
    statusMessage,
    elapsedTime,
    error,
    logs,
    startLoading,
    checkCache,
    clearError,
  }

  return (
    <WasmContext.Provider value={value}>
      {children}
    </WasmContext.Provider>
  )
}
