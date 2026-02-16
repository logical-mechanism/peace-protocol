// Shim for Phase 0 - Dashboard.tsx imports useWasm
// Will be replaced by NodeContext in Phase 2
import { createContext, useContext, useCallback, type ReactNode } from 'react'

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

const defaultValue: WasmContextValue = {
  isReady: false,
  isLoading: false,
  isCached: null,
  stage: 'idle',
  progress: 0,
  statusMessage: 'SNARK prover not available in scaffold',
  elapsedTime: 0,
  error: null,
  logs: [],
  startLoading: async () => {},
  checkCache: async () => false,
  clearError: () => {},
}

const WasmContext = createContext<WasmContextValue | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useWasm(): WasmContextValue {
  const context = useContext(WasmContext)
  if (!context) {
    // In Phase 0, return defaults instead of throwing
    // This allows Dashboard to render without WasmProvider
    return defaultValue
  }
  return context
}

export function WasmProvider({ children }: { children: ReactNode }) {
  const startLoading = useCallback(async () => {}, [])
  const checkCache = useCallback(async () => false, [])
  const clearError = useCallback(() => {}, [])

  const value: WasmContextValue = {
    ...defaultValue,
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
