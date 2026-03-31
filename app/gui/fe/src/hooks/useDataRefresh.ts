import { useState, useCallback, useRef, useEffect } from 'react'
import { apiCache } from '../services/apiCache'
import { optimisticStore } from '../services/optimisticStore'

/**
 * Escalating delays (ms) for polling after transaction submission.
 * Starts frequent (20s) when confirmation is likely imminent, then backs off
 * as the wait grows. Final 180s poll acts as a catch-all for slow propagation.
 */
const TX_CONFIRMATION_DELAYS = [20_000, 45_000, 90_000, 180_000]

export interface DataRefreshState {
  /** Monotonically increasing signal. Tabs re-fetch when this changes. */
  refreshSignal: number
  /** Separate signal for history-only refreshes. */
  historySignal: number
  /** Trigger a data refresh across all tabs. */
  triggerRefresh: () => void
  /** Trigger a history-only refresh. */
  triggerHistoryRefresh: () => void
  /** Trigger refresh + schedule escalating retries (after tx submission). */
  triggerTransactionRefresh: () => void
  /** Trigger refresh without clearing cache (use when cache is already warm). */
  triggerSoftRefresh: () => void
}

export function useDataRefresh(): DataRefreshState {
  const [refreshSignal, setRefreshSignal] = useState(0)
  const [historySignal, setHistorySignal] = useState(0)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout)
      timersRef.current = []
    }
  }, [])

  const triggerRefresh = useCallback(() => {
    apiCache.clear()
    setRefreshSignal(prev => prev + 1)
    setHistorySignal(prev => prev + 1)
  }, [])

  const triggerHistoryRefresh = useCallback(() => {
    setHistorySignal(prev => prev + 1)
  }, [])

  const triggerSoftRefresh = useCallback(() => {
    setRefreshSignal(prev => prev + 1)
    setHistorySignal(prev => prev + 1)
  }, [])

  const triggerTransactionRefresh = useCallback(() => {
    // Prune stale optimistic entries before refreshing
    optimisticStore.pruneStale()
    // Immediate refresh — clear cache so each retry gets fresh data
    apiCache.clear()
    setRefreshSignal(prev => prev + 1)
    setHistorySignal(prev => prev + 1)

    // Clear any existing escalation timers
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []

    // Schedule escalating retries
    const newTimers = TX_CONFIRMATION_DELAYS.map(delay =>
      setTimeout(() => {
        apiCache.clear()
        setRefreshSignal(prev => prev + 1)
        setHistorySignal(prev => prev + 1)
      }, delay)
    )
    timersRef.current = newTimers
  }, [])

  return {
    refreshSignal,
    historySignal,
    triggerRefresh,
    triggerHistoryRefresh,
    triggerTransactionRefresh,
    triggerSoftRefresh,
  }
}
