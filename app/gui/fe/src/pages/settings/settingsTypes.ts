export interface DiskUsage {
  chain_data_bytes: number
  snark_data_bytes: number
  wallet_bytes: number
  total_bytes: number
  data_dir: string
}

export interface ProcessLog {
  name: string
  lines: string[]
}

export function nodeStageLabel(s: string, syncProgress: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  switch (s) {
    case 'synced': return t('node.stageFullySynced')
    case 'syncing': return t('node.stageSyncing', { progress: syncProgress.toFixed(1) })
    case 'starting': return t('node.stageStarting')
    case 'bootstrapping': return t('node.stageBootstrapping')
    case 'stopped': return t('node.stageStopped')
    case 'error': return t('node.stageError')
    default: return s
  }
}

export function stageColor(s: string): string {
  switch (s) {
    case 'synced': return 'var(--success)'
    case 'syncing': return 'var(--warning)'
    case 'starting':
    case 'bootstrapping': return 'var(--accent)'
    case 'error': return 'var(--error)'
    default: return 'var(--text-muted)'
  }
}

export function processStatusColor(status: { type: string }): string {
  switch (status.type) {
    case 'Running':
    case 'Ready': return 'var(--success)'
    case 'Starting':
    case 'Syncing': return 'var(--warning)'
    case 'Error': return 'var(--error)'
    default: return 'var(--text-muted)'
  }
}
