/**
 * ShutdownOverlay
 *
 * Full-screen overlay shown during app shutdown. Listens for Tauri events
 * emitted by the Rust shutdown handler and displays progress.
 */

import { useState, useEffect } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import LoadingSpinner from './LoadingSpinner'

interface ShutdownProgress {
  elapsed_secs: number
  timeout_secs: number
  remaining_processes: number
}

export default function ShutdownOverlay() {
  const [isShuttingDown, setIsShuttingDown] = useState(false)
  const [progress, setProgress] = useState<ShutdownProgress | null>(null)

  useEffect(() => {
    const unlisteners: Promise<UnlistenFn>[] = []

    unlisteners.push(
      listen('app-shutting-down', () => {
        setIsShuttingDown(true)
      })
    )

    unlisteners.push(
      listen<ShutdownProgress>('shutdown-progress', (event) => {
        setProgress(event.payload)
      })
    )

    return () => {
      unlisteners.forEach((p) => p.then((unlisten) => unlisten()))
    }
  }, [])

  if (!isShuttingDown) return null

  return (
    <div className="fixed inset-0 z-[100] bg-[var(--bg-primary)]/95 backdrop-blur-sm flex items-center justify-center">
      <div className="text-center">
        <div className="flex justify-center mb-4">
          <LoadingSpinner size="lg" label="Shutting down" />
        </div>
        <h2 className="text-lg font-medium text-[var(--text-primary)]">
          Shutting down...
        </h2>
        <p className="text-sm text-[var(--text-muted)] mt-2">
          Stopping services safely. Please wait.
        </p>
        {progress && progress.remaining_processes > 0 && (
          <p className="text-xs text-[var(--text-muted)] mt-3 font-mono">
            {progress.remaining_processes} process{progress.remaining_processes !== 1 ? 'es' : ''} remaining
          </p>
        )}
      </div>
    </div>
  )
}
