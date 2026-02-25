import { useState, useCallback, useRef, useEffect } from 'react'

/** Escalating delays after a transaction is submitted (ms). */
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
    setRefreshSignal(prev => prev + 1)
    setHistorySignal(prev => prev + 1)
  }, [])

  const triggerHistoryRefresh = useCallback(() => {
    setHistorySignal(prev => prev + 1)
  }, [])

  const triggerTransactionRefresh = useCallback(() => {
    // Immediate refresh
    setRefreshSignal(prev => prev + 1)
    setHistorySignal(prev => prev + 1)

    // Clear any existing escalation timers
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []

    // Schedule escalating retries
    const newTimers = TX_CONFIRMATION_DELAYS.map(delay =>
      setTimeout(() => {
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
  }
}
