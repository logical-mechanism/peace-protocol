/**
 * Node Sync Page
 *
 * Shows progress while the Cardano node infrastructure is bootstrapping and syncing.
 * Handles Mithril snapshot download (first run) and node sync progress.
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNode, type NodeStage, type ProcessInfo } from '../contexts/NodeContext'
import { useWalletContext } from '../contexts/WalletContext'
import LoadingSpinner from '../components/LoadingSpinner'

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
    <div
      className="w-full h-6 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] overflow-hidden"
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Sync progress"
    >
      <div
        className="h-full bg-gradient-to-r from-[var(--accent)] to-[var(--success)] transition-all duration-300"
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
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
    <div className="flex flex-wrap gap-2 justify-center">
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

const SERVICE_ITEMS = [
  { name: 'cardano-node', label: 'Cardano Node', startingText: 'Replaying ledger...' },
  { name: 'ogmios', label: 'Ogmios Bridge', startingText: 'Connecting...' },
  { name: 'kupo', label: 'Kupo Indexer', startingText: 'Starting...' },
]

function getServiceState(name: string, processes: ProcessInfo[]): {
  indicator: 'waiting' | 'active' | 'ready' | 'error'
  text: string
} {
  const proc = processes.find(p => p.name === name)
  if (!proc) return { indicator: 'waiting', text: 'Waiting...' }
  const item = SERVICE_ITEMS.find(s => s.name === name)
  switch (proc.status.type) {
    case 'Starting':
    case 'Syncing':
      return { indicator: 'active', text: item?.startingText ?? 'Starting...' }
    case 'Running':
    case 'Ready':
      return { indicator: 'ready', text: 'Ready' }
    case 'Error':
      return { indicator: 'error', text: proc.last_error ?? 'Error' }
    default:
      return { indicator: 'waiting', text: 'Waiting...' }
  }
}

function ServiceChecklist({ processes }: { processes: ProcessInfo[] }) {
  return (
    <div className="mb-4 space-y-3">
      {SERVICE_ITEMS.map(({ name, label }) => {
        const state = getServiceState(name, processes)
        return (
          <div key={name} className="flex items-center gap-3">
            {state.indicator === 'waiting' && (
              <span className="w-4 h-4 flex items-center justify-center">
                <span className="w-2 h-2 rounded-full bg-[var(--text-muted)]" />
              </span>
            )}
            {state.indicator === 'active' && (
              <LoadingSpinner size="sm" label={label} />
            )}
            {state.indicator === 'ready' && (
              <span className="w-4 h-4 flex items-center justify-center text-[var(--success)] text-sm">
                ✓
              </span>
            )}
            {state.indicator === 'error' && (
              <span className="w-4 h-4 flex items-center justify-center">
                <span className="w-2 h-2 rounded-full bg-[var(--error)]" />
              </span>
            )}
            <span className={`text-sm ${
              state.indicator === 'ready'
                ? 'text-[var(--success)]'
                : state.indicator === 'error'
                ? 'text-[var(--error)]'
                : 'text-[var(--text-secondary)]'
            }`}>
              {label}
            </span>
            <span className={`text-xs ml-auto ${
              state.indicator === 'error'
                ? 'text-[var(--error)]'
                : 'text-[var(--text-muted)]'
            }`}>
              {state.text}
            </span>
          </div>
        )
      })}
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
  } = useNode()

  const [showConsole, setShowConsole] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [isStarting, setIsStarting] = useState(false)
  const timerRef = useRef<number | null>(null)
  const wasBootstrappingRef = useRef(false)
  const [prevStage, setPrevStage] = useState(stage)

  // Render-time state adjustments when stage changes (per React docs)
  if (stage !== prevStage) {
    if (stage !== 'stopped' && stage !== 'synced') {
      setElapsedTime(0)
    }
    if (stage !== 'stopped') {
      setIsStarting(false)
    }
    // Auto-expand console during starting phase so users see real activity
    if (stage === 'starting') {
      setShowConsole(true)
    }
    setPrevStage(stage)
  }

  // Elapsed timer when not stopped
  useEffect(() => {
    if (stage !== 'stopped' && stage !== 'synced') {
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
    setIsStarting(true)
    try {
      if (needsBootstrap) {
        await startBootstrap()
      } else {
        await startNode(address ?? '')
      }
    } catch {
      setIsStarting(false)
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
    case 'starting': {
      progressPercent = Math.min(syncProgress, kupoSyncProgress) || 5
      const nodeProc = processes.find(p => p.name === 'cardano-node')
      const ogmiosProc = processes.find(p => p.name === 'ogmios')
      if (!nodeProc || nodeProc.status.type === 'Starting')
        statusMessage = 'Starting Cardano node...'
      else if (!ogmiosProc || ogmiosProc.status.type !== 'Running')
        statusMessage = 'Waiting for chain bridge...'
      else
        statusMessage = 'Connecting to network...'
      break
    }
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
          <div className="mb-6 text-center">
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

          {/* Sync status checklist (when syncing) */}
          {stage === 'syncing' && (
            <div className="mb-4">
              <div className="space-y-3 mb-3">
                {[
                  { label: 'Cardano Node', synced: syncProgress >= 99.9, activeText: 'Syncing...' },
                  { label: 'Kupo Indexer', synced: kupoSyncProgress >= 99.9, activeText: 'Indexing...' },
                ].map(({ label, synced, activeText }) => (
                  <div key={label} className="flex items-center gap-3">
                    {synced ? (
                      <span className="w-4 h-4 flex items-center justify-center text-[var(--success)] text-sm">✓</span>
                    ) : (
                      <LoadingSpinner size="sm" label={label} />
                    )}
                    <span className={`text-sm ${synced ? 'text-[var(--success)]' : 'text-[var(--text-secondary)]'}`}>
                      {label}
                    </span>
                    <span className={`text-xs ml-auto ${synced ? 'text-[var(--success)]' : 'text-[var(--text-muted)]'}`}>
                      {synced ? 'Synced' : activeText}
                    </span>
                  </div>
                ))}
              </div>
              <div className="text-sm text-[var(--text-muted)]">
                {statusMessage}
              </div>
            </div>
          )}
          {stage === 'starting' && (
            <ServiceChecklist processes={processes} />
          )}
          {/* Mithril bootstrap progress bar */}
          {stage === 'bootstrapping' && (
            <div className="mb-4">
              <ProgressBar percent={progressPercent} />
              <div className="flex justify-between mt-2 text-sm text-[var(--text-muted)]">
                <span>{statusMessage}</span>
                <span>{Math.round(progressPercent)}%</span>
              </div>
            </div>
          )}
          {/* Synced status message */}
          {stage === 'synced' && (
            <div className="mb-4 text-sm text-center text-[var(--text-muted)]">
              {statusMessage}
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
          <div className="flex gap-3 justify-center">
            {stage === 'stopped' && (
              <button
                onClick={handleStart}
                disabled={isStarting}
                className="flex-1 py-3 px-4 bg-[var(--accent)] text-white font-medium rounded-[var(--radius-md)] hover:bg-[var(--accent)]/90 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isStarting
                  ? 'Starting...'
                  : needsBootstrap
                  ? 'Download Snapshot & Start'
                  : 'Start Node'}
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
