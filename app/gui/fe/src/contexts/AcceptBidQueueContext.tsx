/**
 * Accept-Bid Queue Context
 *
 * Wraps the headless AcceptBidQueueService in a React context so components
 * can read queue state and dispatch actions via useAcceptBidQueue().
 *
 * Processing starts automatically when wallet + SNARK prover + node are ready.
 * Toast notifications are optional — when Dashboard is mounted it supplies a
 * toast handle for visible feedback; otherwise the service logs to console.
 */
import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { useWalletContext } from './WalletContext'
import { useWasm } from './WasmContext'
import { useNode } from './NodeContext'
import {
  getAcceptBidQueueService,
  type QueueItem,
  type ProcessingDeps,
  type ToastHandle,
} from '../services/acceptBidQueueService'
import { useAutoAcceptDetection } from '../hooks/useAutoAcceptDetection'
import type { EncryptionDisplay, BidDisplay } from '../services/api'
import { extractPaymentKeyHash } from '../services/transactionBuilder'

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------

export interface AcceptBidQueueContextValue {
  queue: QueueItem[]
  currentItem: QueueItem | null
  isProcessing: boolean
  autoAcceptEnabled: boolean
  queuedCount: number
  completedCount: number
  failedCount: number
  enqueue: (encryption: EncryptionDisplay, bid: BidDisplay, priority: boolean) => string | null
  remove: (itemId: string) => boolean
  retry: (itemId: string) => boolean
  clear: () => void
  setAutoAccept: (enabled: boolean) => void
  hasEncryptionInQueue: (tokenName: string) => boolean
  /** Dashboard calls this to provide toast UI. Processing works without it. */
  setToast: (toast: ToastHandle | null) => void
  /** Dashboard calls this to provide refresh trigger. Processing works without it. */
  setRefreshTrigger: (fn: (() => void) | null) => void
}

const AcceptBidQueueContext = createContext<AcceptBidQueueContextValue | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useAcceptBidQueue(): AcceptBidQueueContextValue {
  const context = useContext(AcceptBidQueueContext)
  if (!context) {
    throw new Error('useAcceptBidQueue must be used within AcceptBidQueueProvider')
  }
  return context
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface AcceptBidQueueProviderProps {
  children: ReactNode
}

export function AcceptBidQueueProvider({ children }: AcceptBidQueueProviderProps) {
  const { wallet, address } = useWalletContext()
  const { isReady: wasmReady } = useWasm()
  const { stage: nodeStage, tipSlot } = useNode()

  const userPkh = useMemo(() => {
    if (!address) return undefined
    try { return extractPaymentKeyHash(address) } catch { return undefined }
  }, [address])

  // Incremented when the service emits 'change' — drives useMemo recalculation
  const [tick, setTick] = useState(0)
  const serviceRef = useRef(getAcceptBidQueueService())
  const service = serviceRef.current

  // Optional UI deps — supplied by Dashboard when it's mounted
  const toastRef = useRef<ToastHandle | null>(null)
  const refreshTriggerRef = useRef<(() => void) | null>(null)
  const setToast = useCallback((t: ToastHandle | null) => { toastRef.current = t }, [])
  const setRefreshTrigger = useCallback((fn: (() => void) | null) => { refreshTriggerRef.current = fn }, [])

  // Subscribe to service events
  useEffect(() => {
    const onChange = () => setTick(t => t + 1)
    service.on('change', onChange)
    return () => { service.off('change', onChange) }
  }, [service])

  // Start/stop processing based on core deps (wallet + wasm + node + pkh)
  useEffect(() => {
    if (wallet && wasmReady && nodeStage === 'synced' && userPkh) {
      // Refs let processItem always read the latest toast/refresh handles
      const deps: ProcessingDeps = {
        wallet,
        userPkh,
        get toast() { return toastRef.current },
        get triggerTransactionRefresh() { return refreshTriggerRef.current },
      }
      service.startProcessing(deps)
    } else {
      service.stopProcessing()
    }

    return () => { service.stopProcessing() }
  }, [wallet, wasmReady, nodeStage, userPkh, service])

  // Stable action callbacks
  const enqueue = useCallback(
    (encryption: EncryptionDisplay, bid: BidDisplay, priority: boolean) =>
      service.enqueue(encryption, bid, priority),
    [service],
  )

  const remove = useCallback((itemId: string) => service.remove(itemId), [service])
  const retry = useCallback((itemId: string) => service.retry(itemId), [service])
  const clear = useCallback(() => service.clear(), [service])
  const setAutoAccept = useCallback((enabled: boolean) => service.setAutoAccept(enabled), [service])
  const hasEncryptionInQueue = useCallback((tokenName: string) => service.hasEncryptionInQueue(tokenName), [service])

  // Auto-detect eligible bids when auto-accept is enabled
  const autoAcceptEnabled = service.getAutoAcceptEnabled()
  useAutoAcceptDetection({
    userPkh,
    autoAcceptEnabled,
    tipSlot,
    nodeStage,
    enqueue,
  })

  // Derive state from queue snapshot — single pass for counts
  const value = useMemo((): AcceptBidQueueContextValue => {
    const queue = service.getQueue()
    const currentItem = service.getCurrentItem()
    const isProcessing = service.isProcessing()
    let queuedCount = 0, completedCount = 0, failedCount = 0
    for (const item of queue) {
      if (item.status === 'queued') queuedCount++
      else if (item.status === 'complete') completedCount++
      else if (item.status === 'failed') failedCount++
    }
    return {
      queue, currentItem, isProcessing, autoAcceptEnabled,
      queuedCount, completedCount, failedCount,
      enqueue, remove, retry, clear, setAutoAccept, hasEncryptionInQueue,
      setToast, setRefreshTrigger,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tick triggers recalculation
  }, [tick, autoAcceptEnabled, enqueue, remove, retry, clear, setAutoAccept, hasEncryptionInQueue, setToast, setRefreshTrigger, service])

  return (
    <AcceptBidQueueContext.Provider value={value}>
      {children}
    </AcceptBidQueueContext.Provider>
  )
}
