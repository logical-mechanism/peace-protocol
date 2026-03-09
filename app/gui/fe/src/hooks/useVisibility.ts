import { useEffect, useRef, useCallback } from 'react'

/**
 * Runs a callback on an interval that automatically pauses when the
 * document/window is not visible (e.g. user switched to another app).
 *
 * Returns a stable `triggerNow` function that fires the callback
 * immediately (useful for eager refreshes on user action).
 */
export function useVisibleInterval(
  callback: () => void,
  delayMs: number,
): () => void {
  const cbRef = useRef(callback)

  useEffect(() => {
    cbRef.current = callback
  })

  const intervalRef = useRef<number | null>(null)

  const start = useCallback(() => {
    if (intervalRef.current !== null) return
    intervalRef.current = window.setInterval(() => cbRef.current(), delayMs)
  }, [delayMs])

  const stop = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  useEffect(() => {
    // Start immediately if visible
    if (!document.hidden) {
      cbRef.current()
      start()
    }

    const onVisibility = () => {
      if (document.hidden) {
        stop()
      } else {
        cbRef.current()
        start()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [start, stop])

  return useCallback(() => cbRef.current(), [])
}
