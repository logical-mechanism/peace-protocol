/**
 * Accept-Bid Queue Panel
 *
 * Collapsible panel shown at the top of My Sales tab when the queue has items
 * or auto-accept is enabled. Shows current processing status, queued items,
 * failed items with retry actions, and recent completions.
 */
import { useState, useEffect, memo } from 'react'
import { useAcceptBidQueue } from '../contexts/AcceptBidQueueContext'
import type { QueueItem } from '../services/acceptBidQueueService'
import { formatAda } from '../utils/formatAda'

function AcceptBidQueuePanel() {
  const {
    queue, currentItem, isProcessing, autoAcceptEnabled,
    queuedCount, completedCount, failedCount,
    remove, retry, dismiss, clear, setAutoAccept,
  } = useAcceptBidQueue()

  const [expanded, setExpanded] = useState(false)

  // Auto-expand when first item is added
  useEffect(() => {
    if (queue.length > 0 && !expanded) {
      setExpanded(true)
    }
  }, [queue.length > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  // Don't render if nothing to show
  if (!autoAcceptEnabled && queue.length === 0) {
    return null
  }

  const queuedItems = queue.filter(i => i.status === 'queued')
  const failedItems = queue.filter(i => i.status === 'failed')
  const completedItems = queue.filter(i => i.status === 'complete').slice(0, 5)

  const statusText = isProcessing
    ? `Processing ${currentItem ? '1' : '0'} of ${queuedCount + 1}`
    : failedCount > 0
      ? `${failedCount} failed`
      : queuedCount > 0
        ? `${queuedCount} queued`
        : 'Idle'

  return (
    <div className="mb-4 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] overflow-hidden">
      {/* Header bar — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-secondary)] transition-colors duration-[var(--transition-fast)]"
        aria-expanded={expanded}
        aria-controls="queue-panel-content"
      >
        <div className="flex items-center gap-3">
          {/* Queue icon */}
          <div className="flex items-center gap-2">
            {isProcessing && (
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--accent)]" />
              </span>
            )}
            <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
            </svg>
          </div>
          <span className="text-sm font-medium text-[var(--text-primary)]">Auto-Accept Queue</span>
          <span className="text-xs text-[var(--text-muted)]">{statusText}</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Auto-accept toggle */}
          <label
            className="flex items-center gap-2 cursor-pointer"
            onClick={e => e.stopPropagation()}
          >
            <span className="text-xs text-[var(--text-muted)]">Auto</span>
            <div className="relative">
              <input
                type="checkbox"
                checked={autoAcceptEnabled}
                onChange={e => setAutoAccept(e.target.checked)}
                className="sr-only"
                aria-label="Toggle auto-accept"
              />
              <div className={`w-9 h-5 rounded-full transition-colors duration-200 ${autoAcceptEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-tertiary)]'}`}>
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${autoAcceptEnabled ? 'translate-x-4' : ''}`} />
              </div>
            </div>
          </label>

          {/* Expand/collapse chevron */}
          <svg
            className={`w-4 h-4 text-[var(--text-muted)] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div id="queue-panel-content" className="border-t border-[var(--border-subtle)] px-4 py-3 space-y-4">
          {/* Currently processing */}
          {currentItem && (
            <QueueSection title="Currently Processing">
              <QueueItemCard item={currentItem} showElapsed />
            </QueueSection>
          )}

          {/* Queued items */}
          {queuedItems.length > 0 && (
            <QueueSection title={`Queued (${queuedItems.length})`}>
              <div className="space-y-2">
                {queuedItems.map(item => (
                  <QueueItemCard
                    key={item.id}
                    item={item}
                    actions={
                      <button
                        onClick={() => remove(item.id)}
                        className="text-xs text-[var(--error)] hover:underline"
                      >
                        Remove
                      </button>
                    }
                  />
                ))}
              </div>
            </QueueSection>
          )}

          {/* Failed items */}
          {failedItems.length > 0 && (
            <QueueSection title={`Failed (${failedItems.length})`}>
              <div className="space-y-2">
                {failedItems.map(item => (
                  <QueueItemCard
                    key={item.id}
                    item={item}
                    actions={
                      <div className="flex gap-2">
                        <button
                          onClick={() => retry(item.id)}
                          className="text-xs text-[var(--accent)] hover:underline"
                        >
                          Retry
                        </button>
                        <button
                          onClick={() => dismiss(item.id)}
                          className="text-xs text-[var(--text-muted)] hover:underline"
                        >
                          Dismiss
                        </button>
                      </div>
                    }
                  />
                ))}
              </div>
            </QueueSection>
          )}

          {/* Recent completions */}
          {completedItems.length > 0 && (
            <QueueSection title={`Completed (${completedCount})`}>
              <div className="space-y-2">
                {completedItems.map(item => (
                  <QueueItemCard
                    key={item.id}
                    item={item}
                    actions={
                      <button
                        onClick={() => dismiss(item.id)}
                        className="text-xs text-[var(--text-muted)] hover:underline"
                      >
                        Dismiss
                      </button>
                    }
                  />
                ))}
              </div>
            </QueueSection>
          )}

          {/* Empty state */}
          {!currentItem && queuedItems.length === 0 && failedItems.length === 0 && completedItems.length === 0 && (
            <p className="text-sm text-[var(--text-muted)] text-center py-2">
              {autoAcceptEnabled
                ? 'Waiting for eligible bids at or above your suggested price...'
                : 'Queue is empty. Accept a bid manually or enable auto-accept.'}
            </p>
          )}

          {/* Clear all button */}
          {queue.length > 1 && (
            <div className="flex justify-end">
              <button
                onClick={clear}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--error)] hover:underline"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function QueueSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">{title}</h4>
      {children}
    </div>
  )
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  queued: { label: 'Queued', color: 'var(--text-muted)' },
  preparing: { label: 'Preparing inputs...', color: 'var(--accent)' },
  proving: { label: 'Generating ZK proof...', color: 'var(--accent)' },
  submitting: { label: 'Submitting transactions...', color: 'var(--accent)' },
  complete: { label: 'Complete', color: 'var(--success)' },
  failed: { label: 'Failed', color: 'var(--error)' },
}

function QueueItemCard({
  item,
  showElapsed,
  actions,
}: {
  item: QueueItem
  showElapsed?: boolean
  actions?: React.ReactNode
}) {
  const label = item.encryption.description
    ? item.encryption.description.slice(0, 40)
    : item.encryption.tokenName.slice(0, 16) + '...'
  const bidAda = formatAda(item.bid.amount)
  const statusInfo = STATUS_LABELS[item.status] || STATUS_LABELS.queued

  return (
    <div className="flex items-center justify-between gap-3 p-2.5 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--text-primary)] truncate">{label}</span>
          {item.priority && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-medium">
              Manual
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs" style={{ color: statusInfo.color }}>{statusInfo.label}</span>
          <span className="text-xs text-[var(--text-muted)]">{bidAda} ADA</span>
          {showElapsed && item.status === 'proving' && item.startedAt && (
            <ElapsedTimer startTime={item.startedAt} />
          )}
          {item.provingElapsed && item.status === 'complete' && (
            <span className="text-xs text-[var(--text-muted)]">
              ({(item.provingElapsed / 1000).toFixed(0)}s proof)
            </span>
          )}
        </div>
        {item.error && (
          <p className="text-xs text-[var(--error)] mt-1 truncate" title={item.error}>{item.error}</p>
        )}
        {item.partialSuccess === 'snark-only' && (
          <p className="text-xs text-[var(--warning)] mt-1">SNARK submitted — complete re-encryption from My Sales</p>
        )}
      </div>

      {actions && <div className="flex-shrink-0">{actions}</div>}
    </div>
  )
}

function ElapsedTimer({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [startTime])

  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  return (
    <span className="text-xs text-[var(--text-muted)] tabular-nums">
      {minutes}:{seconds.toString().padStart(2, '0')}
    </span>
  )
}

export default memo(AcceptBidQueuePanel)
