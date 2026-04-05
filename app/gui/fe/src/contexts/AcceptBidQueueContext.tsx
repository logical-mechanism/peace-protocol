/**
 * Accept-Bid Queue Context
 *
 * Wraps the headless AcceptBidQueueService in a React context so components
 * can read queue state and dispatch actions via useAcceptBidQueue().
 *
 * Processing starts automatically when both the wallet and SNARK prover are
 * ready, and stops when either becomes unavailable.
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { useWalletContext } from './WalletContext'
import { useWasm } from './WasmContext'
import { useNode } from './NodeContext'
import {
  getAcceptBidQueueService,
  type QueueItem,
  type ProcessingDeps,
} from '../services/acceptBidQueueService'
import type { EncryptionDisplay, BidDisplay } from '../services/api'

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------

export interface AcceptBidQueueContextValue {
  queue: QueueItem[]
  currentItem: QueueItem | null
  isProcessing: boolean
  autoAcceptEnabled: boolean
  /** Number of items with status 'queued'. */
  queuedCount: number
  /** Number of items with status 'complete'. */
  completedCount: number
  /** Number of items with status 'failed'. */
  failedCount: number
  enqueue: (encryption: EncryptionDisplay, bid: BidDisplay, priority: boolean) => string | null
  remove: (itemId: string) => boolean
  retry: (itemId: string) => boolean
  dismiss: (itemId: string) => boolean
  clear: () => void
  setAutoAccept: (enabled: boolean) => void
  hasEncryptionInQueue: (tokenName: string) => boolean
  /** Called by Dashboard to supply toast/recordTransaction/triggerTransactionRefresh deps. */
  setProcessingDeps: (deps: Omit<ProcessingDeps, 'wallet'> | null) => void
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
  const { wallet } = useWalletContext()
  const { isReady: wasmReady } = useWasm()
  const { nodeStage } = useNode()

  // Force re-render when the service emits 'change'
  const [, setTick] = useState(0)
  const serviceRef = useRef(getAcceptBidQueueService())
  const service = serviceRef.current

  // Processing deps supplied by Dashboard via setProcessingDeps
  const [processingDeps, setProcessingDeps] = useState<Omit<ProcessingDeps, 'wallet'> | null>(null)

  // Subscribe to service events
  useEffect(() => {
    const onChange = () => setTick(t => t + 1)
    service.on('change', onChange)
    return () => { service.off('change', onChange) }
  }, [service])

  // Start/stop processing based on deps availability
  useEffect(() => {
    const canProcess = wallet && wasmReady && nodeStage === 'synced' && processingDeps
    if (canProcess) {
      const deps: ProcessingDeps = {
        wallet,
        ...processingDeps,
      }
      service.startProcessing(deps)
    } else {
      service.stopProcessing()
    }

    return () => {
      service.stopProcessing()
    }
  }, [wallet, wasmReady, nodeStage, processingDeps, service])

  // Stable action callbacks
  const enqueue = useCallback(
    (encryption: EncryptionDisplay, bid: BidDisplay, priority: boolean) =>
      service.enqueue(encryption, bid, priority),
    [service],
  )

  const remove = useCallback((itemId: string) => service.remove(itemId), [service])
  const retry = useCallback((itemId: string) => service.retry(itemId), [service])
  const dismiss = useCallback((itemId: string) => service.dismiss(itemId), [service])
  const clear = useCallback(() => service.clear(), [service])
  const setAutoAccept = useCallback((enabled: boolean) => service.setAutoAccept(enabled), [service])
  const hasEncryptionInQueue = useCallback((tokenName: string) => service.hasEncryptionInQueue(tokenName), [service])

  // Derive counts from queue snapshot
  const queue = service.getQueue()
  const currentItem = service.getCurrentItem()
  const isProcessing = service.isProcessing()
  const autoAcceptEnabled = service.getAutoAcceptEnabled()
  const queuedCount = queue.filter(i => i.status === 'queued').length
  const completedCount = queue.filter(i => i.status === 'complete').length
  const failedCount = queue.filter(i => i.status === 'failed').length

  const value: AcceptBidQueueContextValue = {
    queue,
    currentItem,
    isProcessing,
    autoAcceptEnabled,
    queuedCount,
    completedCount,
    failedCount,
    enqueue,
    remove,
    retry,
    dismiss,
    clear,
    setAutoAccept,
    hasEncryptionInQueue,
    setProcessingDeps,
  }

  return (
    <AcceptBidQueueContext.Provider value={value}>
      {children}
    </AcceptBidQueueContext.Provider>
  )
}
