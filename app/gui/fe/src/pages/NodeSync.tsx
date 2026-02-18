/**
 * Node Sync Page
 *
 * Shows progress while the Cardano node infrastructure is bootstrapping and syncing.
 * Handles Mithril snapshot download (first run) and node sync progress.
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNode, type NodeStage } from '../contexts/NodeContext'
import { useWalletContext } from '../contexts/WalletContext'

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="w-full h-6 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-[var(--accent)] to-[var(--success)] transition-all duration-300"
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  )
}

function ServiceProgress({ label, percent, detail }: {
  label: string
  percent: number
  detail?: string
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between text-sm text-[var(--text-muted)] mb-1">
        <span className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{
              backgroundColor: percent >= 99.9
                ? 'var(--success)'
                : percent > 0
                ? 'var(--warning)'
                : 'var(--text-muted)'
            }}
          />
          {label}
        </span>
        <span>{percent >= 99.9 ? 'Synced' : `${percent.toFixed(1)}%`}</span>
      </div>
      <div className="w-full h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-[var(--accent)] to-[var(--success)] transition-all duration-300"
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      {detail && (
        <div className="text-xs text-[var(--text-muted)] mt-0.5">{detail}</div>
      )}
    </div>
  )
}

interface StageIndicatorProps {
  stages: { key: string; label: string }[]
  currentStage: NodeStage
}

function StageIndicator({ stages, currentStage }: StageIndicatorProps) {
  const stageOrder: NodeStage[] = ['stopped', 'bootstrapping', 'starting', 'syncing', 'synced']
  const currentIndex = stageOrder.indexOf(currentStage)

  return (
    <div className="flex flex-wrap gap-2">
      {stages.map((s, i) => {
        const stageIndex = stageOrder.indexOf(s.key as NodeStage)
        const isActive = s.key === currentStage
        const isPast = stageIndex < currentIndex && currentStage !== 'error'
        const isError = currentStage === 'error' && isActive

        return (
          <span
            key={s.key}
            className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${
              isError
                ? 'bg-[var(--error)]/20 text-[var(--error)] border border-[var(--error)]/30'
                : isActive
                ? 'bg-[var(--accent-muted)] text-[var(--accent)] border border-[var(--accent)]/30'
                : isPast
                ? 'bg-[var(--success-muted)] text-[var(--success)] border border-[var(--success)]/30'
                : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-subtle)]'
            }`}
          >
            {isPast ? '✓ ' : isActive && i < stages.length - 1 ? '● ' : ''}
            {s.label}
          </span>
        )
      })}
    </div>
  )
}

function ConsoleLog({ logs }: { logs: string[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  return (
    <div
      ref={scrollRef}
      className="bg-[#111] rounded-[var(--radius-md)] p-4 max-h-64 overflow-y-auto font-mono text-xs"
    >
      {logs.length === 0 ? (
        <div className="text-[var(--text-muted)]">Waiting for logs...</div>
      ) : (
        logs.map((line, i) => (
          <div key={i} className="text-[var(--success)]/80">
            {line}
          </div>
        ))
      )}
    </div>
  )
}

const STAGES = [
  { key: 'bootstrapping', label: 'Bootstrap' },
  { key: 'starting', label: 'Starting' },
  { key: 'syncing', label: 'Syncing' },
  { key: 'synced', label: 'Ready' },
]

export default function NodeSync() {
  const navigate = useNavigate()
  const { address } = useWalletContext()
  const {
    stage,
    syncProgress,
    kupoSyncProgress,
    tipSlot,
    tipHeight,
    network,
    mithrilProgress,
    needsBootstrap,
    error,
    logs,
    startNode,
    stopNode,
    startBootstrap,
  } = useNode()

  const [showConsole, setShowConsole] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)
  const timerRef = useRef<number | null>(null)
  const wasBootstrappingRef = useRef(false)

  // Elapsed timer when not stopped
  useEffect(() => {
    if (stage !== 'stopped' && stage !== 'synced') {
      setElapsedTime(0)
      timerRef.current = window.setInterval(() => {
        setElapsedTime((prev) => prev + 1)
      }, 1000)
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [stage])

  // Auto-start node stack after Mithril bootstrap completes.
  // Detects bootstrapping→stopped transition with needsBootstrap=false
  // (confirms chain data now exists on disk).
  useEffect(() => {
    if (stage === 'bootstrapping') {
      wasBootstrappingRef.current = true
    }
    if (wasBootstrappingRef.current && stage === 'stopped' && !needsBootstrap) {
      wasBootstrappingRef.current = false
      startNode(address ?? '')
    }
  }, [stage, needsBootstrap, startNode, address])

  // Navigate to dashboard when synced
  const canContinue = stage === 'synced' || (stage === 'syncing' && syncProgress >= 99 && kupoSyncProgress >= 99)

  const handleContinue = () => {
    navigate('/dashboard')
  }

  const handleStart = async () => {
    if (needsBootstrap) {
      await startBootstrap()
    } else {
      await startNode(address ?? '')
    }
  }

  const handleRetry = async () => {
    await stopNode()
    // Small delay before restart
    setTimeout(() => handleStart(), 1000)
  }

  // Determine progress for the bar
  let progressPercent = 0
  let statusMessage = ''

  switch (stage) {
    case 'stopped':
      statusMessage = needsBootstrap
        ? 'Blockchain data not found. Download a snapshot to get started.'
        : 'Node infrastructure is stopped.'
      break
    case 'bootstrapping':
      progressPercent = mithrilProgress?.progress_percent ?? 0
      if (mithrilProgress) {
        const downloaded = formatBytes(mithrilProgress.bytes_downloaded)
        const total = formatBytes(mithrilProgress.total_bytes)
        statusMessage = mithrilProgress.message || `Downloading snapshot: ${downloaded} / ${total}`
      } else {
        statusMessage = 'Preparing to download blockchain snapshot...'
      }
      break
    case 'starting':
      progressPercent = 10
      statusMessage = 'Starting node infrastructure...'
      break
    case 'syncing':
      progressPercent = Math.min(syncProgress, kupoSyncProgress)
      if (syncProgress >= 99.9 && kupoSyncProgress >= 99.9) {
        statusMessage = `Fully synced with ${network} network`
      } else if (syncProgress >= 99.9) {
        statusMessage = `Node synced, waiting for Kupo indexer...`
      } else {
        statusMessage = `Syncing with ${network} network...`
      }
      break
    case 'synced':
      progressPercent = 100
      statusMessage = `Fully synced with ${network} network`
      if (tipHeight) statusMessage += ` at block ${tipHeight.toLocaleString()}`
      break
    case 'error':
      statusMessage = error || 'An error occurred'
      break
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'var(--bg-primary)' }}
    >
      <div className="max-w-lg w-full">
        <div
          className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-8"
          style={{ boxShadow: 'var(--shadow-lg)' }}
        >
          {/* Header */}
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 flex items-center justify-center rounded-full bg-[var(--bg-secondary)]">
              {stage === 'error' ? (
                <svg className="w-6 h-6 text-[var(--error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              ) : stage === 'synced' ? (
                <svg className="w-6 h-6 text-[var(--success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : stage === 'stopped' ? (
                <svg className="w-6 h-6 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              ) : (
                <svg className="w-6 h-6 text-[var(--accent)] animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
            </div>
            <div>
              <h1 className="text-xl font-semibold">
                {stage === 'stopped'
                  ? 'Node Setup'
                  : stage === 'bootstrapping'
                  ? 'Downloading Snapshot'
                  : stage === 'starting'
                  ? 'Starting Node'
                  : stage === 'syncing'
                  ? 'Syncing Chain'
                  : stage === 'synced'
                  ? 'Node Ready'
                  : 'Node Error'}
              </h1>
              <p className="text-sm text-[var(--text-muted)]">
                {network.charAt(0).toUpperCase() + network.slice(1)} Network
              </p>
            </div>
          </div>

          {/* Stage Indicator */}
          <div className="mb-6">
            <StageIndicator stages={STAGES} currentStage={stage} />
          </div>

          {/* Progress Bars (when active) */}
          {stage === 'syncing' && (
            <div className="mb-4">
              <ServiceProgress
                label="Cardano Node"
                percent={syncProgress}
                detail={tipSlot ? `Slot ${tipSlot.toLocaleString()}` : undefined}
              />
              <ServiceProgress
                label="Kupo Indexer"
                percent={kupoSyncProgress}
              />
              <div className="mt-2 text-sm text-[var(--text-muted)]">
                {statusMessage}
              </div>
            </div>
          )}
          {stage !== 'stopped' && stage !== 'error' && stage !== 'syncing' && (
            <div className="mb-4">
              <ProgressBar percent={progressPercent} />
              <div className="flex justify-between mt-2 text-sm text-[var(--text-muted)]">
                <span>{statusMessage}</span>
                <span>{Math.round(progressPercent)}%</span>
              </div>
            </div>
          )}

          {/* Status Message (when stopped or error) */}
          {(stage === 'stopped' || stage === 'error') && (
            <div
              className={`mb-4 p-4 rounded-[var(--radius-md)] text-sm ${
                stage === 'error'
                  ? 'bg-[var(--error)]/10 text-[var(--error)] border border-[var(--error)]/20'
                  : 'bg-[var(--info-muted)] text-[var(--info)] border border-[var(--info)]/20'
              }`}
            >
              {statusMessage}
            </div>
          )}

          {/* Timer (when running) */}
          {stage !== 'stopped' && stage !== 'synced' && (
            <div className="mb-6 text-center">
              <span className="text-2xl font-mono text-[var(--accent)]">
                {formatTime(elapsedTime)}
              </span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            {stage === 'stopped' && (
              <button
                onClick={handleStart}
                className="flex-1 py-3 px-4 bg-[var(--accent)] text-white font-medium rounded-[var(--radius-md)] hover:bg-[var(--accent)]/90 transition-all cursor-pointer"
              >
                {needsBootstrap ? 'Download Snapshot & Start' : 'Start Node'}
              </button>
            )}

            {stage === 'error' && (
              <button
                onClick={handleRetry}
                className="flex-1 py-3 px-4 bg-[var(--accent)] text-white font-medium rounded-[var(--radius-md)] hover:bg-[var(--accent)]/90 transition-all cursor-pointer"
              >
                Retry
              </button>
            )}

            {canContinue && (
              <button
                onClick={handleContinue}
                className="flex-1 py-3 px-4 bg-[var(--accent)] text-white font-medium rounded-[var(--radius-md)] hover:bg-[var(--accent)]/90 transition-all cursor-pointer"
              >
                Continue to Dashboard
              </button>
            )}

            {(stage === 'syncing' || stage === 'starting' || stage === 'bootstrapping') && (
              <button
                onClick={() => navigate('/dashboard')}
                className="py-3 px-4 border border-[var(--border-subtle)] text-[var(--text-secondary)] font-medium rounded-[var(--radius-md)] hover:bg-[var(--bg-card-hover)] transition-all cursor-pointer"
              >
                Continue in Background
              </button>
            )}

            {stage !== 'stopped' && stage !== 'synced' && (
              <button
                onClick={stopNode}
                className="py-3 px-4 border border-[var(--border-subtle)] text-[var(--text-muted)] font-medium rounded-[var(--radius-md)] hover:bg-[var(--bg-card-hover)] transition-all cursor-pointer"
              >
                Stop
              </button>
            )}
          </div>

          {/* Console Toggle */}
          <div className="mt-6">
            <button
              onClick={() => setShowConsole(!showConsole)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer"
            >
              {showConsole ? 'Hide' : 'Show'} Console Output ({logs.length} lines)
            </button>
            {showConsole && (
              <div className="mt-2">
                <ConsoleLog logs={logs} />
              </div>
            )}
          </div>

          {/* Info Box */}
          {stage === 'stopped' && needsBootstrap && (
            <div className="mt-6 p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] text-sm text-[var(--text-muted)]">
              <p className="font-medium text-[var(--text-secondary)] mb-1">First-time setup</p>
              <p>
                A Mithril snapshot will be downloaded to bootstrap the Cardano node.
                This takes approximately 10-20 minutes depending on your connection speed.
                The snapshot is verified cryptographically before use.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
