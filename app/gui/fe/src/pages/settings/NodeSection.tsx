import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('settings')
  return (
    <div className="space-y-6">
      {/* Overall Status */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
        <h2 className="text-lg font-medium mb-4">{t('node.infrastructureTitle')}</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-sm text-[var(--text-muted)]">{t('node.status')}</span>
            <p className="text-lg font-medium flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: stageColor(stage) }}
              />
              {nodeStageLabel(stage, syncProgress)}
            </p>
          </div>
          <div>
            <span className="text-sm text-[var(--text-muted)]">{t('node.network')}</span>
            <p className="text-lg font-medium capitalize">{network || currentNetwork || '...'}</p>
          </div>
          {tipSlot !== null && (
            <div>
              <span className="text-sm text-[var(--text-muted)]">{t('node.tipSlot')}</span>
              <p className="text-lg font-mono">{tipSlot?.toLocaleString()}</p>
            </div>
          )}
          {tipHeight !== null && (
            <div>
              <span className="text-sm text-[var(--text-muted)]">{t('node.tipHeight')}</span>
              <p className="text-lg font-mono">{tipHeight?.toLocaleString()}</p>
            </div>
          )}
        </div>

        {(stage === 'syncing' || stage === 'starting') && (
          <div className="mt-4 space-y-3">
            <div>
              <div className="flex justify-between text-sm text-[var(--text-muted)] mb-1">
                <span>{t('node.nodeSync')}</span>
                <span>{syncProgress >= 99.9 ? t('node.synced') : `${syncProgress.toFixed(1)}%`}</span>
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
                <span>{t('node.kupoIndexer')}</span>
                <span>{kupoSyncProgress >= 99.9 ? t('node.synced') : `${kupoSyncProgress.toFixed(1)}%`}</span>
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
        <h2 className="text-lg font-medium mb-4">{t('node.processesTitle')}</h2>
        <div className="space-y-3">
          {processes.length === 0 ? (
            <p className="text-[var(--text-muted)]">{t('node.noProcesses')}</p>
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
                    <span className="text-xs text-[var(--text-muted)] font-mono">{t('node.pid', { pid: proc.pid })}</span>
                  )}
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                    {(proc.status as unknown as { type: string }).type}
                  </span>
                  {proc.restart_count > 0 && (
                    <span className="text-xs text-[var(--warning)]">
                      {t('node.restarts', { count: proc.restart_count })}
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
