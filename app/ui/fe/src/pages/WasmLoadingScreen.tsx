/**
 * WASM Loading Screen
 *
 * Shows progress while the SNARK prover is being loaded.
 * The WASM prover requires ~99 minutes to load setup files into memory.
 * This screen handles the loading transparently after wallet connect.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWasm, type WasmLog } from '../contexts/WasmContext'

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="w-full h-6 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-[var(--accent)] to-[var(--success)] transition-all duration-300"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

function Timer({ elapsed }: { elapsed: number }) {
  return (
    <div className="text-2xl font-mono text-[var(--accent)]">
      Elapsed: {formatTime(elapsed)}
    </div>
  )
}

function ConsoleLog({ logs }: { logs: WasmLog[] }) {
  return (
    <div className="bg-[#111] rounded-[var(--radius-md)] p-4 max-h-64 overflow-y-auto font-mono text-xs">
      {logs.length === 0 ? (
        <div className="text-[var(--text-muted)]">Waiting for logs...</div>
      ) : (
        logs.map((log, index) => (
          <div key={index} className="flex gap-2">
            <span className="text-[var(--text-muted)]">[{log.time}]</span>
            <span
              className={
                log.type === 'error'
                  ? 'text-[var(--error)]'
                  : log.type === 'success'
                  ? 'text-[var(--success)]'
                  : log.type === 'worker'
                  ? 'text-[var(--accent)]'
                  : 'text-[var(--success)]'
              }
            >
              {log.message}
            </span>
          </div>
        ))
      )}
    </div>
  )
}

export default function WasmLoadingScreen() {
  const navigate = useNavigate()
  const {
    isReady,
    isLoading,
    isCached,
    stage,
    progress,
    statusMessage,
    elapsedTime,
    error,
    logs,
    startLoading,
    checkCache,
    clearError,
  } = useWasm()

  const [showConsole, setShowConsole] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)

  // Check cache on mount to show relevant info
  useEffect(() => {
    checkCache()
  }, [checkCache])

  // If already loading when we mount, consider it started
  useEffect(() => {
    if (isLoading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHasStarted(true)
    }
  }, [isLoading])

  const handleStartLoading = () => {
    setHasStarted(true)
    startLoading().catch(console.error)
  }

  // Auto-redirect when ready
  useEffect(() => {
    if (isReady) {
      // Small delay to show completion
      const timer = setTimeout(() => {
        navigate('/dashboard')
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [isReady, navigate])

  const handleContinueInBackground = () => {
    navigate('/dashboard')
  }

  const handleRetry = () => {
    clearError()
    setHasStarted(true)
    startLoading().catch(console.error)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 md:p-8">
      <div className="max-w-lg w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] flex items-center justify-center">
            {error ? (
              <svg
                className="w-8 h-8 text-[var(--error)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            ) : isReady ? (
              <svg
                className="w-8 h-8 text-[var(--success)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            ) : hasStarted ? (
              <svg
                className="w-8 h-8 text-[var(--accent)] animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            ) : (
              <svg
                className="w-8 h-8 text-[var(--accent)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                />
              </svg>
            )}
          </div>

          <h1 className="text-2xl font-semibold text-[var(--text-primary)] mb-2">
            {error
              ? 'Loading Failed'
              : isReady
              ? 'Ready!'
              : hasStarted
              ? 'Preparing Zero-Knowledge Prover'
              : 'Zero-Knowledge Prover Setup'}
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            {error
              ? 'There was an error loading the prover'
              : isReady
              ? 'Redirecting to dashboard...'
              : hasStarted
              ? 'This one-time setup enables privacy-preserving transactions'
              : 'Required for creating listings, decryption, and accepting bids'}
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6 mb-4">
          {error ? (
            <div className="space-y-4">
              <div className="p-4 bg-[var(--error-muted)] border border-[var(--error)] rounded-[var(--radius-md)]">
                <p className="text-sm text-[var(--error)]">{error}</p>
              </div>
              <button
                onClick={handleRetry}
                className="w-full px-4 py-3 bg-[var(--accent)] text-white font-medium rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-all duration-150 cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : !hasStarted ? (
            /* Intro Screen - before loading starts */
            <div className="space-y-6">
              <div className="space-y-4 text-sm text-[var(--text-secondary)]">
                <p>
                  The app needs to load cryptographic modules to enable secure operations.
                  The full setup takes approximately <strong className="text-[var(--text-primary)]">99 minutes</strong>.
                </p>
                <div className="space-y-2">
                  <p className="font-medium text-[var(--text-primary)]">What gets loaded:</p>
                  <ul className="list-disc list-inside space-y-1 text-[var(--text-muted)]">
                    <li>Circuit files (~698 MB) {isCached ? <span className="text-[var(--success)]">- Cached</span> : '- Will download'}</li>
                    <li>WASM cryptography module (enables listings & decryption)</li>
                    <li>Proving key deserialization (enables accepting bids)</li>
                  </ul>
                </div>
                <div className="space-y-2">
                  <p className="font-medium text-[var(--text-primary)]">What requires the prover:</p>
                  <ul className="list-disc list-inside space-y-1 text-[var(--text-muted)]">
                    <li>Creating listings - encryption key derivation</li>
                    <li>Decrypting purchases - decryption key computation</li>
                    <li>Accepting bids - zero-knowledge proof generation (~99 min setup)</li>
                  </ul>
                </div>
                <p className="text-[var(--text-muted)]">
                  You can browse the marketplace and place bids without loading.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleStartLoading}
                  className="flex-1 px-4 py-3 bg-[var(--accent)] text-white font-medium rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-all duration-150 cursor-pointer"
                >
                  Start Loading
                </button>
                <button
                  onClick={handleContinueInBackground}
                  className="flex-1 px-4 py-3 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-medium rounded-[var(--radius-md)] hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all duration-150 cursor-pointer"
                >
                  Skip for Now
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Progress Bar */}
              <div className="space-y-2">
                <ProgressBar percent={progress} />
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[var(--text-secondary)]">
                    {statusMessage}
                  </span>
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    {Math.round(progress)}%
                  </span>
                </div>
              </div>

              {/* Timer */}
              <div className="text-center">
                <Timer elapsed={elapsedTime} />
              </div>

              {/* Stage Indicator */}
              <div className="flex flex-wrap gap-2 justify-center">
                {[
                  { key: 'checking-cache', label: 'Cache' },
                  { key: 'downloading', label: 'Download' },
                  { key: 'loading-wasm', label: 'WASM' },
                  { key: 'deserializing', label: 'Setup' },
                  { key: 'ready', label: 'Ready' },
                ].map((s) => {
                  const isActive =
                    s.key === 'checking-cache'
                      ? stage === 'checking-cache'
                      : s.key === 'downloading'
                      ? stage === 'downloading-ccs' || stage === 'downloading-pk'
                      : s.key === 'loading-wasm'
                      ? stage === 'loading-wasm'
                      : s.key === 'deserializing'
                      ? stage === 'deserializing-ccs' || stage === 'deserializing-pk'
                      : stage === 'ready'

                  const isPast =
                    s.key === 'checking-cache'
                      ? ['downloading-ccs', 'downloading-pk', 'loading-wasm', 'deserializing-ccs', 'deserializing-pk', 'ready'].includes(stage)
                      : s.key === 'downloading'
                      ? ['loading-wasm', 'deserializing-ccs', 'deserializing-pk', 'ready'].includes(stage)
                      : s.key === 'loading-wasm'
                      ? ['deserializing-ccs', 'deserializing-pk', 'ready'].includes(stage)
                      : s.key === 'deserializing'
                      ? stage === 'ready'
                      : false

                  return (
                    <span
                      key={s.key}
                      className={`px-3 py-1 text-xs rounded-full border transition-all duration-200 ${
                        isActive
                          ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                          : isPast
                          ? 'bg-[var(--success-muted)] border-[var(--success)] text-[var(--success)]'
                          : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)] text-[var(--text-muted)]'
                      }`}
                    >
                      {s.label}
                    </span>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Info Box - only show when loading is in progress */}
        {!error && !isReady && hasStarted && (
          <div className="bg-[var(--info-muted)] border border-[var(--info)] rounded-[var(--radius-md)] p-4 mb-4">
            <div className="flex gap-3">
              <svg
                className="w-5 h-5 text-[var(--info)] flex-shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div className="text-sm text-[var(--text-secondary)]">
                <p className="font-medium text-[var(--text-primary)] mb-1">
                  One-time setup (~99 minutes)
                </p>
                <p>
                  The proving key (~613 MB) needs to be loaded into memory. The WASM
                  module enables encryption/decryption immediately. After full setup,
                  proof generation takes only ~5 minutes.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons - only show when loading is in progress */}
        {!error && !isReady && hasStarted && (
          <div className="space-y-3">
            <button
              onClick={handleContinueInBackground}
              className="w-full px-4 py-3 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-medium rounded-[var(--radius-md)] hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all duration-150 cursor-pointer"
            >
              Continue in Background
            </button>
            <p className="text-xs text-center text-[var(--text-muted)]">
              Browse the marketplace while loading continues
            </p>
          </div>
        )}

        {/* Console Toggle */}
        <div className="mt-6">
          <button
            onClick={() => setShowConsole(!showConsole)}
            className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer"
          >
            {showConsole ? 'Hide' : 'Show'} console output
          </button>
          {showConsole && (
            <div className="mt-3">
              <ConsoleLog logs={logs} />
            </div>
          )}
        </div>
      </div>

      {/* Network indicator */}
      <footer className="absolute bottom-4 left-0 right-0 text-center">
        <span className="inline-flex items-center gap-2 px-3 py-1 text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-full">
          <span className="w-2 h-2 rounded-full bg-[var(--warning)]"></span>
          Preprod Network
        </span>
      </footer>
    </div>
  )
}
