import { useAcceptBidQueue } from '../../contexts/AcceptBidQueueContext'
import InfoTooltip from '../../components/InfoTooltip'

export default function AutomationSection() {
  const { autoAcceptEnabled, setAutoAccept, queuedCount, completedCount, failedCount, isProcessing } = useAcceptBidQueue()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Automation</h2>
        <p className="text-sm text-[var(--text-muted)]">Configure automatic bid acceptance behavior.</p>
      </div>

      {/* Auto-accept toggle */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">Auto-Accept Bids</span>
            <InfoTooltip text="When enabled, bids at or above your suggested price are automatically accepted. The oldest eligible bid is processed first. SNARK proofs generate in the background (~3 min each)." />
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={autoAcceptEnabled}
              onChange={e => setAutoAccept(e.target.checked)}
              className="sr-only"
            />
            <div className={`w-11 h-6 rounded-full transition-colors duration-200 ${autoAcceptEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-tertiary)]'}`}>
              <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${autoAcceptEnabled ? 'translate-x-5' : ''}`} />
            </div>
          </label>
        </div>

        <p className="text-xs text-[var(--text-muted)]">
          Automatically accepts pending bids where the bid amount meets or exceeds your listing&apos;s suggested price.
          Only processes one bid at a time. Manually accepted bids get priority in the queue.
        </p>

        {/* Queue status summary */}
        <div className="flex gap-4 pt-2 border-t border-[var(--border-subtle)]">
          <div>
            <span className="text-xs text-[var(--text-muted)]">Status</span>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {isProcessing ? 'Processing' : 'Idle'}
            </p>
          </div>
          <div>
            <span className="text-xs text-[var(--text-muted)]">Queued</span>
            <p className="text-sm font-medium text-[var(--text-primary)]">{queuedCount}</p>
          </div>
          <div>
            <span className="text-xs text-[var(--text-muted)]">Completed</span>
            <p className="text-sm font-medium text-[var(--success)]">{completedCount}</p>
          </div>
          {failedCount > 0 && (
            <div>
              <span className="text-xs text-[var(--text-muted)]">Failed</span>
              <p className="text-sm font-medium text-[var(--error)]">{failedCount}</p>
            </div>
          )}
        </div>
      </div>

      {/* How it works */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4">
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">How it works</h3>
        <ul className="text-xs text-[var(--text-muted)] space-y-1.5">
          <li>1. A bid arrives at or above your suggested price</li>
          <li>2. The bid is added to the processing queue (oldest first)</li>
          <li>3. A SNARK proof is generated in the background (~3 min)</li>
          <li>4. The proof + re-encryption transactions are submitted on-chain</li>
          <li>5. The sale completes automatically</li>
        </ul>
        <p className="text-xs text-[var(--text-muted)] mt-3">
          View the queue in the <strong>My Sales</strong> tab. Failed items can be retried from there.
        </p>
      </div>
    </div>
  )
}
