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
import { useToast, ToastContainer } from '../components/Toast'
import { copyToClipboard } from '../utils/clipboard'
import { formatEta, formatSpeed, getErrorGuidance } from '../utils/nodeSyncHelpers'
import { invoke } from '@tauri-apps/api/core'
import LoadingSpinner from '../components/LoadingSpinner'
import { formatBytes } from '../utils/formatBytes'

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
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
  { name: 'cardano-node', label: 'Cardano Node', startingText: 'Replaying ledger...', description: 'Validates blocks from the Cardano blockchain and maintains a local copy of the ledger.' },
  { name: 'ogmios', label: 'Ogmios Bridge', startingText: 'Connecting...', description: 'Translates node data into a WebSocket protocol for transaction building and submission.' },
  { name: 'kupo', label: 'Kupo Indexer', startingText: 'Starting...', description: 'Indexes UTxOs at contract and wallet addresses for fast balance and listing queries.' },
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
      {SERVICE_ITEMS.map(({ name, label, description }) => {
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
            <span className="relative group">
              <span className="w-4 h-4 inline-flex items-center justify-center rounded-full border border-[var(--border-subtle)] text-[var(--text-muted)] cursor-help text-[10px] leading-none">
                ?
              </span>
              <span className="absolute left-6 top-1/2 -translate-y-1/2 z-10 hidden group-hover:block bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] px-3 py-2 text-xs text-[var(--text-secondary)] w-52 shadow-lg whitespace-normal">
                {description}
              </span>
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

  const toast = useToast()

  // Disk space check for first-run bootstrap
  const [diskSpaceWarning, setDiskSpaceWarning] = useState<string | null>(null)
  useEffect(() => {
    if (!needsBootstrap || stage !== 'stopped') return
    const checkSpace = async () => {
      try {
        const result = await invoke<{ available_bytes: number }>('get_available_disk_space')
        const availableGb = result.available_bytes / (1024 ** 3)
        const requiredGb = network === 'mainnet' ? 100 : 5
        if (availableGb < requiredGb) {
          setDiskSpaceWarning(
            `Low disk space: ${availableGb.toFixed(1)} GB available, ~${requiredGb} GB needed for ${network}. The sync may fail if disk space runs out.`
          )
        } else {
          setDiskSpaceWarning(null)
        }
      } catch {
        // Silently skip — not critical
      }
    }
    checkSpace()
  }, [needsBootstrap, stage, network])

  const [showConsole, setShowConsole] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [isStarting, setIsStarting] = useState(false)
  const timerRef = useRef<number | null>(null)
  const wasBootstrappingRef = useRef(false)
  const [prevStage, setPrevStage] = useState(stage)

  // Sync ETA tracking: sliding window of progress samples
  const syncSamplesRef = useRef<{ time: number; progress: number }[]>([])
  const lastSyncProgressRef = useRef<number>(0)
  const [syncEta, setSyncEta] = useState<string | null>(null)

  // Network tip from Koios
  const [networkTip, setNetworkTip] = useState<number | null>(null)
  const networkTipTimerRef = useRef<number | null>(null)

  // Mithril download speed/ETA tracking
  const mithrilSamplesRef = useRef<{ time: number; bytes: number }[]>([])
  const lastMithrilBytesRef = useRef<number>(0)
  const [mithrilEta, setMithrilEta] = useState<string | null>(null)
  const [mithrilSpeed, setMithrilSpeed] = useState<string | null>(null)

  // Stuck-at-99% detection
  const stuckProgressRef = useRef<number>(0)
  const stuckTimerRef = useRef<number | null>(null)
  const [showStuckMessage, setShowStuckMessage] = useState(false)

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
    // Reset state-based tracking
    setSyncEta(null)
    setNetworkTip(null)
    setMithrilEta(null)
    setMithrilSpeed(null)
    setShowStuckMessage(false)
    setPrevStage(stage)
  }

  // Reset refs when stage changes (refs can't be updated during render)
  useEffect(() => {
    syncSamplesRef.current = []
    lastSyncProgressRef.current = 0
    mithrilSamplesRef.current = []
    lastMithrilBytesRef.current = 0
    stuckProgressRef.current = 0
  }, [stage])

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

  // Track sync progress and compute ETA via interval (subscription pattern)
  useEffect(() => {
    if (stage !== 'syncing') return

    const interval = window.setInterval(() => {
      const progress = syncSamplesRef.current
      const lastProgress = lastSyncProgressRef.current
      // syncProgress is captured via closure from the outer scope — read the ref instead
      // We push samples from this interval callback to keep ref writes out of render
      if (progress.length === 0 || progress[progress.length - 1].progress !== lastProgress) {
        // No new data yet, skip
      }
      if (progress.length >= 2) {
        const oldest = progress[0]
        const newest = progress[progress.length - 1]
        const timeDelta = newest.time - oldest.time
        const progressDelta = newest.progress - oldest.progress
        if (timeDelta > 0 && progressDelta > 0) {
          const rate = progressDelta / timeDelta
          const remaining = 100 - newest.progress
          const etaSeconds = remaining / rate
          setSyncEta(etaSeconds < 86400 ? formatEta(etaSeconds) : 'estimating...')
        }
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [stage])

  // Add sync progress samples when progress changes (ref-only updates)
  useEffect(() => {
    if (stage !== 'syncing') return

    if (syncProgress !== lastSyncProgressRef.current) {
      lastSyncProgressRef.current = syncProgress
      const now = Date.now() / 1000
      syncSamplesRef.current.push({ time: now, progress: syncProgress })
      if (syncSamplesRef.current.length > 12) {
        syncSamplesRef.current = syncSamplesRef.current.slice(-12)
      }
    }
  }, [stage, syncProgress])

  // Fetch network tip every 60s during sync/starting stages
  useEffect(() => {
    if (stage !== 'syncing' && stage !== 'starting') return

    const fetchTip = async () => {
      try {
        const tip = await invoke<{ block_no: number }>('get_network_tip')
        if (tip) setNetworkTip(tip.block_no)
      } catch {
        // Koios may be unreachable; silently skip
      }
    }

    fetchTip()
    networkTipTimerRef.current = window.setInterval(fetchTip, 60_000)

    return () => {
      if (networkTipTimerRef.current) clearInterval(networkTipTimerRef.current)
    }
  }, [stage])

  // Track Mithril download speed and ETA
  useEffect(() => {
    if (stage !== 'bootstrapping' || !mithrilProgress) return

    const { bytes_downloaded, total_bytes } = mithrilProgress
    if (bytes_downloaded !== lastMithrilBytesRef.current && bytes_downloaded > 0) {
      lastMithrilBytesRef.current = bytes_downloaded
      const now = Date.now() / 1000
      mithrilSamplesRef.current.push({ time: now, bytes: bytes_downloaded })
      if (mithrilSamplesRef.current.length > 12) {
        mithrilSamplesRef.current = mithrilSamplesRef.current.slice(-12)
      }

      const samples = mithrilSamplesRef.current
      if (samples.length >= 2) {
        const oldest = samples[0]
        const newest = samples[samples.length - 1]
        const timeDelta = newest.time - oldest.time
        const bytesDelta = newest.bytes - oldest.bytes
        if (timeDelta > 0 && bytesDelta > 0) {
          const speed = bytesDelta / timeDelta
          setMithrilSpeed(formatSpeed(speed))
          const remaining = total_bytes - newest.bytes
          if (remaining > 0) {
            setMithrilEta(formatEta(remaining / speed))
          } else {
            setMithrilEta(null)
          }
        }
      }
    }
  }, [stage, mithrilProgress])

  // Detect when sync is stuck at >= 99% for 60+ seconds
  useEffect(() => {
    if (!(stage === 'syncing' && syncProgress >= 99 && syncProgress < 99.9)) {
      if (stuckTimerRef.current) clearTimeout(stuckTimerRef.current)
      return
    }

    if (syncProgress !== stuckProgressRef.current) {
      stuckProgressRef.current = syncProgress
      if (stuckTimerRef.current) clearTimeout(stuckTimerRef.current)
      stuckTimerRef.current = window.setTimeout(() => {
        setShowStuckMessage(true)
      }, 60_000)
    }

    return () => {
      if (stuckTimerRef.current) clearTimeout(stuckTimerRef.current)
    }
  }, [stage, syncProgress])

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

  const handleCopyLogs = async () => {
    if (logs.length === 0) {
      toast.warning('No logs', 'There are no log lines to copy.')
      return
    }
    const success = await copyToClipboard(logs.join('\n'))
    if (success) {
      toast.success('Logs copied', 'Console output copied to clipboard.')
    } else {
      toast.error('Copy failed', 'Could not copy logs to clipboard.')
    }
  }

  // Compute error guidance for error state
  const errorGuidance = stage === 'error' ? getErrorGuidance(error) : null

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

          {/* Sync status with block info and checklist */}
          {stage === 'syncing' && (
            <div className="mb-4">
              {tipHeight != null && tipHeight > 0 && networkTip && networkTip > 0 ? (
                <div className="text-center text-sm text-[var(--text-muted)]">
                  Block {tipHeight.toLocaleString()} / {networkTip.toLocaleString()}
                  {syncEta && <span className="ml-2">— {syncEta}</span>}
                </div>
              ) : (
                <div className="text-center text-sm text-[var(--text-muted)]">
                  {statusMessage}
                </div>
              )}

              <div className="space-y-3 mt-3 mb-3">
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

              {showStuckMessage && (
                <div className="mt-3 p-3 bg-[var(--info-muted)] border border-[var(--info)]/20 rounded-[var(--radius-md)] text-xs text-[var(--info)]">
                  The last few blocks take longer as the node validates recent transactions. This is normal.
                  {tipHeight && networkTip && networkTip > tipHeight && (
                    <span className="block mt-1">
                      {(networkTip - tipHeight).toLocaleString()} blocks remaining.
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
          {stage === 'starting' && (
            <ServiceChecklist processes={processes} />
          )}
          {/* Mithril bootstrap progress bar with speed/ETA */}
          {stage === 'bootstrapping' && (
            <div className="mb-4">
              <ProgressBar percent={progressPercent} />
              <div className="flex justify-between mt-2 text-sm text-[var(--text-muted)]">
                <span>{statusMessage}</span>
                <span>{Math.round(progressPercent)}%</span>
              </div>
              {(mithrilSpeed || mithrilEta) && (
                <div className="mt-1 text-center text-xs text-[var(--text-muted)]">
                  {mithrilSpeed}{mithrilSpeed && mithrilEta && ' \u2014 '}{mithrilEta}
                </div>
              )}
            </div>
          )}
          {/* Synced status message */}
          {stage === 'synced' && (
            <div className="mb-4 text-sm text-center text-[var(--text-muted)]">
              {statusMessage}
            </div>
          )}

          {/* Status Message (when stopped) */}
          {stage === 'stopped' && (
            <div className="mb-4 p-4 rounded-[var(--radius-md)] text-sm bg-[var(--info-muted)] text-[var(--info)] border border-[var(--info)]/20">
              {statusMessage}
            </div>
          )}

          {/* Disk space warning */}
          {diskSpaceWarning && stage === 'stopped' && (
            <div className="mb-4 p-4 rounded-[var(--radius-md)] text-sm bg-[var(--warning-muted)] text-[var(--warning)] border border-[var(--warning)]/20">
              {diskSpaceWarning}
            </div>
          )}

          {/* Error state with recovery guidance */}
          {stage === 'error' && (
            <div className="mb-4 p-4 rounded-[var(--radius-md)] text-sm bg-[var(--error)]/10 text-[var(--error)] border border-[var(--error)]/20">
              <div className="font-medium mb-2">{errorGuidance?.title ?? 'Error'}</div>
              <div className="text-xs text-[var(--text-secondary)] mb-2">{statusMessage}</div>
              {errorGuidance && (
                <ul className="text-xs text-[var(--text-muted)] space-y-1 list-disc list-inside">
                  {errorGuidance.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ul>
              )}
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

          {/* Console Toggle + Copy Logs */}
          <div className="mt-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowConsole(!showConsole)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer"
              >
                {showConsole ? 'Hide' : 'Show'} Console Output ({logs.length} lines)
              </button>
              {showConsole && logs.length > 0 && (
                <button
                  onClick={handleCopyLogs}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer flex items-center gap-1"
                  aria-label="Copy logs to clipboard"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy Logs
                </button>
              )}
            </div>
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
      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} queuedCount={toast.queuedCount} onDismissAll={toast.dismissAll} />
    </div>
  )
}
