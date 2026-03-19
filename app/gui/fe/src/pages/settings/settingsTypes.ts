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

export function nodeStageLabel(s: string, syncProgress: number): string {
  switch (s) {
    case 'synced': return 'Fully Synced'
    case 'syncing': return `Syncing (${syncProgress.toFixed(1)}%)`
    case 'starting': return 'Starting...'
    case 'bootstrapping': return 'Bootstrapping...'
    case 'stopped': return 'Stopped'
    case 'error': return 'Error'
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
