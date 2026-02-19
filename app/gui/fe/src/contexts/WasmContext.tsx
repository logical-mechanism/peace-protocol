/**
 * SNARK Setup Context
 *
 * Manages the lifecycle of the native SNARK prover setup files (pk.bin, ccs.bin).
 * On mount, checks if setup files exist. If not, decompresses them from the
 * bundled .zst files. Reports progress to the UI.
 *
 * Named "WasmContext" for backward compatibility with Dashboard imports.
 */
import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type WasmStage =
  | 'idle'
  | 'checking-cache'
  | 'decompressing'
  | 'ready'
  | 'error'

export interface WasmLog {
  time: string
  message: string
  type: 'info' | 'success' | 'error' | 'worker'
}

export interface WasmContextValue {
  isReady: boolean
  isLoading: boolean
  isCached: boolean | null
  stage: WasmStage
  progress: number
  statusMessage: string
  elapsedTime: number
  error: string | null
  logs: WasmLog[]
  startLoading: () => Promise<void>
  checkCache: () => Promise<boolean>
  clearError: () => void
}

const WasmContext = createContext<WasmContextValue | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useWasm(): WasmContextValue {
  const context = useContext(WasmContext)
  if (!context) {
    return {
      isReady: false,
      isLoading: false,
      isCached: null,
      stage: 'idle',
      progress: 0,
      statusMessage: '',
      elapsedTime: 0,
      error: null,
      logs: [],
      startLoading: async () => {},
      checkCache: async () => false,
      clearError: () => {},
    }
  }
  return context
}

export function WasmProvider({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<WasmStage>('idle')
  const [progress, setProgress] = useState(0)
  const [statusMessage, setStatusMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<WasmLog[]>([])
  const initRef = useRef(false)

  const addLog = useCallback((message: string, type: WasmLog['type'] = 'info') => {
    setLogs(prev => [...prev, {
      time: new Date().toLocaleTimeString(),
      message,
      type,
    }])
  }, [])

  const checkCache = useCallback(async (): Promise<boolean> => {
    try {
      return await invoke<boolean>('snark_check_setup')
    } catch {
      return false
    }
  }, [])

  const startLoading = useCallback(async () => {
    if (stage === 'ready' || stage === 'decompressing') return

    setStage('checking-cache')
    setStatusMessage('Checking SNARK setup files...')
    addLog('Checking if setup files exist...')

    try {
      const exists = await invoke<boolean>('snark_check_setup')
      if (exists) {
        setStage('ready')
        setProgress(100)
        setStatusMessage('SNARK prover ready')
        addLog('Setup files found', 'success')
        return
      }

      // Need to decompress
      setStage('decompressing')
      setProgress(10)
      setStatusMessage('Decompressing SNARK setup files...')
      addLog('Decompressing pk.bin and ccs.bin (~500MB)...')

      await invoke('snark_decompress_setup')

      setStage('ready')
      setProgress(100)
      setStatusMessage('SNARK prover ready')
      addLog('Setup files decompressed', 'success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setStage('error')
      setError(msg)
      setStatusMessage(`Error: ${msg}`)
      addLog(msg, 'error')
    }
  }, [stage, addLog])

  const clearError = useCallback(() => {
    setError(null)
    if (stage === 'error') {
      setStage('idle')
    }
  }, [stage])

  // Listen for decompression progress events from Rust
  useEffect(() => {
    let unlisten: UnlistenFn | null = null

    listen<{ stage: string; message: string; percent: number }>('snark-setup-progress', (event) => {
      setProgress(event.payload.percent)
      setStatusMessage(event.payload.message)
      if (event.payload.stage === 'complete') {
        setStage('ready')
      }
    }).then(fn => { unlisten = fn })

    return () => { unlisten?.() }
  }, [])

  // Auto-check on mount
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time async init
    startLoading()
  }, [startLoading])

  const isReady = stage === 'ready'
  const isLoading = stage === 'checking-cache' || stage === 'decompressing'

  const value: WasmContextValue = {
    isReady,
    isLoading,
    isCached: isReady ? true : null,
    stage,
    progress,
    statusMessage,
    elapsedTime: 0,
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
