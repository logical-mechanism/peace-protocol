import { nodeStageLabel, stageColor, processStatusColor } from './settingsTypes'

interface NodeSectionProps {
  stage: string
  syncProgress: number
  kupoSyncProgress: number
  tipSlot: number | null
  tipHeight: number | null
  network: string
  currentNetwork: string
  processes: Array<{ name: string; status: { type: string }; pid: number | null; restart_count: number }>
}

export default function NodeSection({
  stage,
  syncProgress,
  kupoSyncProgress,
  tipSlot,
  tipHeight,
  network,
  currentNetwork,
  processes,
}: NodeSectionProps) {
  return (
    <div className="space-y-6">
      {/* Overall Status */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
        <h2 className="text-lg font-medium mb-4">Node Infrastructure</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-sm text-[var(--text-muted)]">Status</span>
            <p className="text-lg font-medium flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: stageColor(stage) }}
              />
              {nodeStageLabel(stage, syncProgress)}
            </p>
          </div>
          <div>
            <span className="text-sm text-[var(--text-muted)]">Network</span>
            <p className="text-lg font-medium capitalize">{network || currentNetwork || '...'}</p>
          </div>
          {tipSlot !== null && (
            <div>
              <span className="text-sm text-[var(--text-muted)]">Tip Slot</span>
              <p className="text-lg font-mono">{tipSlot?.toLocaleString()}</p>
            </div>
          )}
          {tipHeight !== null && (
            <div>
              <span className="text-sm text-[var(--text-muted)]">Tip Height</span>
              <p className="text-lg font-mono">{tipHeight?.toLocaleString()}</p>
            </div>
          )}
        </div>

        {(stage === 'syncing' || stage === 'starting') && (
          <div className="mt-4 space-y-3">
            <div>
              <div className="flex justify-between text-sm text-[var(--text-muted)] mb-1">
                <span>Node Sync</span>
                <span>{syncProgress >= 99.9 ? 'Synced' : `${syncProgress.toFixed(1)}%`}</span>
              </div>
              <div className="w-full h-3 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[var(--accent)] to-[var(--success)] transition-all duration-300"
                  style={{ width: `${Math.min(syncProgress, 100)}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm text-[var(--text-muted)] mb-1">
                <span>Kupo Indexer</span>
                <span>{kupoSyncProgress >= 99.9 ? 'Synced' : `${kupoSyncProgress.toFixed(1)}%`}</span>
              </div>
              <div className="w-full h-3 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[var(--accent)] to-[var(--success)] transition-all duration-300"
                  style={{ width: `${Math.min(kupoSyncProgress, 100)}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Process List */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
        <h2 className="text-lg font-medium mb-4">Processes</h2>
        <div className="space-y-3">
          {processes.length === 0 ? (
            <p className="text-[var(--text-muted)]">No processes registered</p>
          ) : (
            processes.map((proc) => (
              <div
                key={proc.name}
                className="flex items-center justify-between py-2 border-b border-[var(--border-subtle)] last:border-b-0"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: processStatusColor(proc.status as unknown as { type: string }) }}
                  />
                  <span className="font-mono text-sm">{proc.name}</span>
                </div>
                <div className="flex items-center gap-4">
                  {proc.pid && (
                    <span className="text-xs text-[var(--text-muted)] font-mono">PID {proc.pid}</span>
                  )}
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                    {(proc.status as unknown as { type: string }).type}
                  </span>
                  {proc.restart_count > 0 && (
                    <span className="text-xs text-[var(--warning)]">
                      {proc.restart_count} restart{proc.restart_count > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
