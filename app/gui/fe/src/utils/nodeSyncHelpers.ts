/**
 * Pure helper functions for the NodeSync page.
 * Extracted to a separate file so they can be tested without pulling
 * in React contexts or WASM dependencies.
 */

export function formatEta(totalSeconds: number): string {
  if (totalSeconds < 60) return 'less than a minute remaining'
  if (totalSeconds < 3600) {
    const mins = Math.ceil(totalSeconds / 60)
    return `~${mins} min remaining`
  }
  const hours = Math.floor(totalSeconds / 3600)
  const mins = Math.ceil((totalSeconds % 3600) / 60)
  return `~${hours}h ${mins}m remaining`
}

export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024 * 1024) {
    return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`
  }
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
}

export interface ErrorGuidance {
  title: string
  steps: string[]
}

export function getErrorGuidance(error: string | null): ErrorGuidance {
  if (!error) {
    return {
      title: 'An error occurred',
      steps: ['Try restarting the node using the Retry button.'],
    }
  }
  const lower = error.toLowerCase()

  if (lower.includes('no space') || lower.includes('disk full') || lower.includes('enospc')) {
    return {
      title: 'Disk space is full',
      steps: [
        'Free up disk space (the Cardano node requires at least 15 GB).',
        'Check disk usage in Settings > Storage.',
        'Consider deleting chain data and re-syncing with a fresh Mithril snapshot.',
      ],
    }
  }

  if (lower.includes('address already in use') || lower.includes('eaddrinuse')) {
    return {
      title: 'Port conflict detected',
      steps: [
        'Another process is using a required port (3001, 1337, or 1442).',
        'Close any other instances of this application.',
        'If the issue persists, restart your computer to release the ports.',
      ],
    }
  }

  if (lower.includes('connection refused') || lower.includes('econnrefused')) {
    return {
      title: 'Connection refused',
      steps: [
        'A required service failed to start or crashed.',
        'Try stopping and restarting the node.',
        'Check the console output for specific error details.',
      ],
    }
  }

  if (lower.includes('signal') || lower.includes('killed') || lower.includes('crash') || lower.includes('exited')) {
    return {
      title: 'Process crashed unexpectedly',
      steps: [
        'The node or a supporting service exited unexpectedly.',
        'Try restarting — the issue may be transient.',
        'If it persists, check console logs and consider re-syncing from a Mithril snapshot.',
      ],
    }
  }

  if (lower.includes('permission') || lower.includes('eacces')) {
    return {
      title: 'Permission denied',
      steps: [
        'The application lacks permission to access required files or ports.',
        'Ensure the app data directory is writable.',
        'Try running the application with appropriate permissions.',
      ],
    }
  }

  if (lower.includes('timeout') || lower.includes('timed out')) {
    return {
      title: 'Operation timed out',
      steps: [
        'A service took too long to respond.',
        'Check your internet connection if this occurred during bootstrap.',
        'Try restarting the node.',
      ],
    }
  }

  return {
    title: 'An error occurred',
    steps: [
      'Try restarting the node using the Retry button.',
      'Check the console output for detailed error information.',
      'If the issue persists, stop the node, restart the application, and try again.',
    ],
  }
}
