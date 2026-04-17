/**
 * Accept-Bid Queue Panel
 *
 * Collapsible panel shown at the top of My Sales tab when the queue has items
 * or auto-accept is enabled. Shows current processing status, queued items,
 * failed items with retry actions, and recent completions.
 */
import { useState, useEffect, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcceptBidQueue } from '../contexts/AcceptBidQueueContext'
import type { QueueItem } from '../services/acceptBidQueueService'
import { formatAda } from '../utils/formatAda'

function AcceptBidQueuePanel() {
  const { t } = useTranslation('notifications')
  const {
    queue, currentItem, isProcessing, autoAcceptEnabled,
    queuedCount, completedCount, failedCount,
    remove, retry, clear, setAutoAccept,
  } = useAcceptBidQueue()

  const hasItems = queue.length > 0
  const [userCollapsed, setUserCollapsed] = useState(false)
  // Auto-expand when items exist, but respect user's manual collapse
  const expanded = hasItems && !userCollapsed

  // Don't render if nothing to show
  if (!autoAcceptEnabled && queue.length === 0) {
    return null
  }

  const queuedItems = queue.filter(i => i.status === 'queued')
  const failedItems = queue.filter(i => i.status === 'failed')
  const completedItems = queue.filter(i => i.status === 'complete').slice(0, 5)

  const statusText = isProcessing
    ? t('toast.acceptBidQueue.processing', { current: currentItem ? 1 : 0, total: queuedCount + 1 })
    : failedCount > 0
      ? t('toast.acceptBidQueue.failedCount', { count: failedCount })
      : queuedCount > 0
        ? t('toast.acceptBidQueue.queuedCount', { count: queuedCount })
        : t('toast.acceptBidQueue.idle')

  return (
    <div className="mb-4 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] overflow-hidden">
      {/* Header bar — always visible */}
      <button
        onClick={() => setUserCollapsed(prev => !prev)}
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
          <span className="text-sm font-medium text-[var(--text-primary)]">{t('toast.acceptBidQueue.heading')}</span>
          <span className="text-xs text-[var(--text-muted)]">{statusText}</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Auto-accept toggle */}
          <label
            className="flex items-center gap-2 cursor-pointer"
            onClick={e => e.stopPropagation()}
          >
            <span className="text-xs text-[var(--text-muted)]">{t('toast.acceptBidQueue.autoLabel')}</span>
            <div className="relative">
              <input
                type="checkbox"
                checked={autoAcceptEnabled}
                onChange={e => setAutoAccept(e.target.checked)}
                className="sr-only"
                aria-label={t('toast.acceptBidQueue.toggleAutoAccept')}
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
            <QueueSection title={t('toast.acceptBidQueue.currentlyProcessing')}>
              <QueueItemCard item={currentItem} showElapsed />
            </QueueSection>
          )}

          {/* Queued items */}
          {queuedItems.length > 0 && (
            <QueueSection title={t('toast.acceptBidQueue.queued', { count: queuedItems.length })}>
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
                        {t('toast.acceptBidQueue.remove')}
                      </button>
                    }
                  />
                ))}
              </div>
            </QueueSection>
          )}

          {/* Failed items */}
          {failedItems.length > 0 && (
            <QueueSection title={t('toast.acceptBidQueue.failed', { count: failedItems.length })}>
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
                          {t('toast.acceptBidQueue.retry')}
                        </button>
                        <button
                          onClick={() => remove(item.id)}
                          className="text-xs text-[var(--text-muted)] hover:underline"
                        >
                          {t('toast.acceptBidQueue.dismiss')}
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
            <QueueSection title={t('toast.acceptBidQueue.completed', { count: completedCount })}>
              <div className="space-y-2">
                {completedItems.map(item => (
                  <QueueItemCard
                    key={item.id}
                    item={item}
                    actions={
                      <button
                        onClick={() => remove(item.id)}
                        className="text-xs text-[var(--text-muted)] hover:underline"
                      >
                        {t('toast.acceptBidQueue.dismiss')}
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
                ? t('toast.acceptBidQueue.emptyAutoEnabled')
                : t('toast.acceptBidQueue.emptyAutoDisabled')}
            </p>
          )}

          {/* Clear all button */}
          {queue.length > 1 && (
            <div className="flex justify-end">
              <button
                onClick={clear}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--error)] hover:underline"
              >
                {t('toast.acceptBidQueue.clearAll')}
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

const STATUS_COLORS: Record<string, string> = {
  queued: 'var(--text-muted)',
  preparing: 'var(--accent)',
  proving: 'var(--accent)',
  submitting: 'var(--accent)',
  complete: 'var(--success)',
  failed: 'var(--error)',
}

const STATUS_KEYS: Record<string, string> = {
  queued: 'toast.acceptBidQueue.statusQueued',
  preparing: 'toast.acceptBidQueue.statusPreparing',
  proving: 'toast.acceptBidQueue.statusProving',
  submitting: 'toast.acceptBidQueue.statusSubmitting',
  complete: 'toast.acceptBidQueue.statusComplete',
  failed: 'toast.acceptBidQueue.statusFailed',
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
  const { t } = useTranslation('notifications')
  const label = item.encryption.description
    ? item.encryption.description.slice(0, 40)
    : item.encryption.tokenName.slice(0, 16) + '...'
  const bidAda = formatAda(item.bid.amount)
  const statusColor = STATUS_COLORS[item.status] || STATUS_COLORS.queued
  const statusKey = STATUS_KEYS[item.status] || STATUS_KEYS.queued

  return (
    <div className="flex items-center justify-between gap-3 p-2.5 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--text-primary)] truncate">{label}</span>
          {item.priority && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-medium">
              {t('toast.acceptBidQueue.manual')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs" style={{ color: statusColor }}>{t(statusKey)}</span>
          <span className="text-xs text-[var(--text-muted)]">{bidAda} ADA</span>
          {showElapsed && item.status === 'proving' && item.startedAt && (
            <ElapsedTimer startTime={item.startedAt} />
          )}
          {item.provingElapsed && item.status === 'complete' && (
            <span className="text-xs text-[var(--text-muted)]">
              {t('toast.acceptBidQueue.proofTime', { seconds: (item.provingElapsed / 1000).toFixed(0) })}
            </span>
          )}
        </div>
        {item.error && (
          <p className="text-xs text-[var(--error)] mt-1 truncate" title={item.error}>{item.error}</p>
        )}
        {item.partialSuccess === 'snark-only' && (
          <p className="text-xs text-[var(--warning)] mt-1">{t('toast.acceptBidQueue.partialSuccess')}</p>
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
