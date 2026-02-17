import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type NodeStage =
  | 'stopped'
  | 'bootstrapping'
  | 'starting'
  | 'syncing'
  | 'synced'
  | 'error'

export interface ProcessInfo {
  name: string
  status: { type: string; message?: string; progress?: number }
  pid: number | null
  restart_count: number
  last_error: string | null
}

export interface MithrilProgress {
  stage: string
  progress_percent: number
  bytes_downloaded: number
  total_bytes: number
  message: string
}

interface NodeStatus {
  overall: string
  sync_progress: number
  tip_slot: number | null
  tip_height: number | null
  network: string
  processes: ProcessInfo[]
  needs_bootstrap: boolean
}

interface ProcessEvent {
  name: string
  status: { type: string; message?: string }
  log_line: string | null
}

export interface NodeContextValue {
  stage: NodeStage
  syncProgress: number
  tipSlot: number | null
  tipHeight: number | null
  network: string
  processes: ProcessInfo[]
  mithrilProgress: MithrilProgress | null
  needsBootstrap: boolean
  error: string | null
  logs: string[]
  startNode: () => Promise<void>
  stopNode: () => Promise<void>
  startBootstrap: () => Promise<void>
}

const NodeContext = createContext<NodeContextValue | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useNode(): NodeContextValue {
  const context = useContext(NodeContext)
  if (!context) {
    throw new Error('useNode must be used within NodeProvider')
  }
  return context
}

export function NodeProvider({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<NodeStage>('stopped')
  const [syncProgress, setSyncProgress] = useState(0)
  const [tipSlot, setTipSlot] = useState<number | null>(null)
  const [tipHeight, setTipHeight] = useState<number | null>(null)
  const [network, setNetwork] = useState('preprod')
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [mithrilProgress, setMithrilProgress] = useState<MithrilProgress | null>(null)
  const [needsBootstrap, setNeedsBootstrap] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const pollRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  // Listen for Tauri events from Rust backend
  useEffect(() => {
    mountedRef.current = true
    const unlisteners: Promise<UnlistenFn>[] = []

    // Process status events (real-time from stdout reader)
    unlisteners.push(
      listen<ProcessEvent>('process-status', (event) => {
        if (!mountedRef.current) return
        const { name, status, log_line } = event.payload

        // Update error state if a process has an error
        if (status.type === 'Error' && status.message) {
          setError(`${name}: ${status.message}`)
        }

        // Append log
        if (log_line) {
          setLogs((prev) => [...prev.slice(-500), `[${name}] ${log_line}`])
        }
      })
    )

    // Mithril progress events
    unlisteners.push(
      listen<MithrilProgress>('mithril-progress', (event) => {
        if (!mountedRef.current) return
        setMithrilProgress(event.payload)
        if (event.payload.stage === 'Complete') {
          setStage('starting')
        }
      })
    )

    return () => {
      mountedRef.current = false
      unlisteners.forEach((p) => p.then((unlisten) => unlisten()))
    }
  }, [])

  // Poll get_node_status every 5 seconds
  useEffect(() => {
    const poll = async () => {
      if (!mountedRef.current) return
      try {
        const status = await invoke<NodeStatus>('get_node_status')
        if (!mountedRef.current) return

        setNetwork(status.network)
        setSyncProgress(status.sync_progress * 100)
        setTipSlot(status.tip_slot)
        setTipHeight(status.tip_height)
        setProcesses(status.processes)
        setNeedsBootstrap(status.needs_bootstrap)

        // Map overall state to stage
        const stageMap: Record<string, NodeStage> = {
          Stopped: 'stopped',
          Bootstrapping: 'bootstrapping',
          Starting: 'starting',
          Syncing: 'syncing',
          Synced: 'synced',
          Error: 'error',
        }
        setStage(stageMap[status.overall] || 'stopped')

        // Clear error when things are running fine
        if (status.overall !== 'Error') {
          setError(null)
        }
      } catch {
        // Node commands not available yet or invoke failed, ignore
      }
    }

    poll()
    pollRef.current = window.setInterval(poll, 5000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const startNode = useCallback(async () => {
    setError(null)
    setStage('starting')
    try {
      await invoke('start_node')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setStage('error')
    }
  }, [])

  const stopNode = useCallback(async () => {
    try {
      await invoke('stop_node')
      setStage('stopped')
      setSyncProgress(0)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    }
  }, [])

  const startBootstrap = useCallback(async () => {
    setError(null)
    setStage('bootstrapping')
    try {
      await invoke('start_mithril_bootstrap')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setStage('error')
    }
  }, [])

  const value: NodeContextValue = {
    stage,
    syncProgress,
    tipSlot,
    tipHeight,
    network,
    processes,
    mithrilProgress,
    needsBootstrap,
    error,
    logs,
    startNode,
    stopNode,
    startBootstrap,
  }

  return <NodeContext.Provider value={value}>{children}</NodeContext.Provider>
}
