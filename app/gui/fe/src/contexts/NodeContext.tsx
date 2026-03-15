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
import { useVisibleInterval } from '../hooks/useVisibility'

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
  kupo_sync_progress: number
  tip_slot: number | null
  tip_height: number | null
  network: string
  processes: ProcessInfo[]
  needs_bootstrap: boolean
  // Extended fields from cardano-cli tip query
  epoch: number | null
  era: string | null
  slot_in_epoch: number | null
  slots_to_epoch_end: number | null
  // Kupo health details from /metrics
  kupo_connection_status: boolean | null
  kupo_seconds_since_last_block: number | null
  // Express backend readiness
  express_ready: boolean
}

interface ProcessEvent {
  name: string
  status: { type: string; message?: string }
  log_line: string | null
}

export interface NodeContextValue {
  stage: NodeStage
  syncProgress: number
  kupoSyncProgress: number
  tipSlot: number | null
  tipHeight: number | null
  network: string
  processes: ProcessInfo[]
  mithrilProgress: MithrilProgress | null
  needsBootstrap: boolean
  error: string | null
  logs: string[]
  // Extended fields from cardano-cli tip query
  epoch: number | null
  era: string | null
  slotInEpoch: number | null
  slotsToEpochEnd: number | null
  // Kupo health details
  kupoConnected: boolean | null
  kupoSecondsSinceLastBlock: number | null
  // Express backend readiness
  expressReady: boolean
  startNode: (walletAddress: string) => Promise<void>
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
  const [kupoSyncProgress, setKupoSyncProgress] = useState(0)
  const [tipSlot, setTipSlot] = useState<number | null>(null)
  const [tipHeight, setTipHeight] = useState<number | null>(null)
  const [network, setNetwork] = useState('preprod')
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [mithrilProgress, setMithrilProgress] = useState<MithrilProgress | null>(null)
  const [needsBootstrap, setNeedsBootstrap] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  // Extended fields from cardano-cli
  const [epoch, setEpoch] = useState<number | null>(null)
  const [era, setEra] = useState<string | null>(null)
  const [slotInEpoch, setSlotInEpoch] = useState<number | null>(null)
  const [slotsToEpochEnd, setSlotsToEpochEnd] = useState<number | null>(null)
  // Kupo health details
  const [kupoConnected, setKupoConnected] = useState<boolean | null>(null)
  const [kupoSecondsSinceLastBlock, setKupoSecondsSinceLastBlock] = useState<number | null>(null)
  const [expressReady, setExpressReady] = useState(false)
  const mountedRef = useRef(true)
  const bootstrapInFlightRef = useRef(false)

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

    // Mithril progress events (download progress)
    unlisteners.push(
      listen<MithrilProgress>('mithril-progress', (event) => {
        if (!mountedRef.current) return
        setMithrilProgress(event.payload)
      })
    )

    return () => {
      mountedRef.current = false
      unlisteners.forEach((p) => p.then((unlisten) => unlisten()))
    }
  }, [])

  // Poll get_node_status every 5 seconds (pauses when window is not visible)
  useVisibleInterval(async () => {
    if (!mountedRef.current) return
    try {
      const status = await invoke<NodeStatus>('get_node_status')
      if (!mountedRef.current) return

      setNetwork(status.network)
      setSyncProgress(status.sync_progress * 100)
      setKupoSyncProgress(status.kupo_sync_progress * 100)
      setTipSlot(status.tip_slot)
      setTipHeight(status.tip_height)
      setProcesses(status.processes)
      setNeedsBootstrap(status.needs_bootstrap)
      setEpoch(status.epoch)
      setEra(status.era)
      setSlotInEpoch(status.slot_in_epoch)
      setSlotsToEpochEnd(status.slots_to_epoch_end)
      setKupoConnected(status.kupo_connection_status)
      setKupoSecondsSinceLastBlock(status.kupo_seconds_since_last_block)
      setExpressReady(status.express_ready)

      // Map overall state to stage
      const stageMap: Record<string, NodeStage> = {
        Stopped: 'stopped',
        Bootstrapping: 'bootstrapping',
        Starting: 'starting',
        Syncing: 'syncing',
        Synced: 'synced',
        Error: 'error',
      }
      // Don't let the poll override an optimistic bootstrapping stage
      // while the invoke is still in flight (avoids flash back to 'stopped')
      const newStage = stageMap[status.overall] || 'stopped'
      if (!(bootstrapInFlightRef.current && newStage === 'stopped')) {
        setStage(newStage)
      }

      // Clear error when things are running fine
      if (status.overall !== 'Error') {
        setError(null)
      }
    } catch {
      // Node commands not available yet or invoke failed, ignore
    }
  }, 5000)

  const startNode = useCallback(async (walletAddress: string) => {
    setError(null)
    setStage('starting')
    try {
      await invoke('start_node', { walletAddress })
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
      setKupoSyncProgress(0)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    }
  }, [])

  const startBootstrap = useCallback(async () => {
    setError(null)
    setStage('bootstrapping')
    bootstrapInFlightRef.current = true
    try {
      await invoke('start_mithril_bootstrap')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setStage('error')
    } finally {
      bootstrapInFlightRef.current = false
    }
  }, [])

  const value: NodeContextValue = {
    stage,
    syncProgress,
    kupoSyncProgress,
    tipSlot,
    tipHeight,
    network,
    processes,
    mithrilProgress,
    needsBootstrap,
    error,
    logs,
    epoch,
    era,
    slotInEpoch,
    slotsToEpochEnd,
    kupoConnected,
    kupoSecondsSinceLastBlock,
    expressReady,
    startNode,
    stopNode,
    startBootstrap,
  }

  return <NodeContext.Provider value={value}>{children}</NodeContext.Provider>
}
