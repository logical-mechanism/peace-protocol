import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useUpdateCheck, type UpdateInfo } from '../../hooks/useUpdateCheck'
import { useToast } from '../../components/Toast'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function UpdateSection() {
  const [currentVersion, setCurrentVersion] = useState<string>('')
  const { state, checkForUpdate, downloadUpdate, reset } = useUpdateCheck()
  const toast = useToast()

  useEffect(() => {
    invoke<string>('get_current_version').then(setCurrentVersion).catch(console.error)
  }, [])

  const handleDownload = async (info: UpdateInfo) => {
    const path = await downloadUpdate(info.download_url)
    if (path) {
      toast.success(
        'Update downloaded',
        `Saved to: ${path}. Close and reopen the app to use the new version.`,
        0
      )
    }
  }

  return (
    <div className="space-y-6">
      {/* Version Info */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
        <h2 className="text-lg font-medium mb-4">App Updates</h2>

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--text-muted)]">Current version</span>
            <span className="px-2.5 py-1 text-sm font-mono font-medium bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)]">
              v{currentVersion}
            </span>
          </div>
          <button
            onClick={() => checkForUpdate()}
            disabled={state.status === 'checking' || state.status === 'downloading'}
            className="btn-base btn-secondary px-4 py-2 text-sm flex items-center gap-2"
          >
            {state.status === 'checking' ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Checking...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                </svg>
                Check for Updates
              </>
            )}
          </button>
        </div>

        {/* Status Area */}
        {state.status === 'up-to-date' && (
          <div className="flex items-center gap-3 p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
            <svg className="w-5 h-5 text-[var(--success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-[var(--text-secondary)]">You&apos;re on the latest version</span>
          </div>
        )}

        {state.status === 'available' && (
          <div className="space-y-4">
            <div className="p-4 bg-[var(--accent-muted)] border border-[var(--accent)] rounded-[var(--radius-md)]">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-[var(--accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                  </svg>
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    Update available: v{state.info.latest_version}
                  </span>
                </div>
                {state.info.download_size && (
                  <span className="text-xs text-[var(--text-muted)]">
                    {formatBytes(state.info.download_size)}
                  </span>
                )}
              </div>

              {state.info.release_notes && (
                <div className="mb-4 max-h-40 overflow-y-auto">
                  <p className="text-xs text-[var(--text-muted)] mb-1">Release notes:</p>
                  <pre className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap font-sans leading-relaxed">
                    {state.info.release_notes}
                  </pre>
                </div>
              )}

              <button
                onClick={() => handleDownload(state.info)}
                className="btn-base btn-primary px-4 py-2 text-sm flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Update
              </button>
            </div>
          </div>
        )}

        {state.status === 'downloading' && (
          <div className="p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--text-secondary)]">Downloading update...</span>
              <span className="text-[var(--text-muted)] font-mono">
                {state.progress.percent.toFixed(1)}%
              </span>
            </div>
            <div className="w-full h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--accent)] rounded-full transition-all duration-200"
                style={{ width: `${Math.min(state.progress.percent, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-[var(--text-muted)]">
              <span>{formatBytes(state.progress.downloaded_bytes)}</span>
              {state.progress.total_bytes > 0 && (
                <span>{formatBytes(state.progress.total_bytes)}</span>
              )}
            </div>
          </div>
        )}

        {state.status === 'downloaded' && (
          <div className="p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] space-y-3">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-[var(--success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-medium text-[var(--text-primary)]">Update downloaded</span>
            </div>
            <p className="text-sm text-[var(--text-muted)] break-all">
              Saved to: {state.filePath}
            </p>
            <p className="text-sm text-[var(--text-secondary)]">
              Close and reopen the app to use the new version.
            </p>
          </div>
        )}

        {state.status === 'error' && (
          <div className="p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5 text-[var(--error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm text-[var(--error)]">{state.message}</span>
              </div>
              <button
                onClick={() => { reset(); checkForUpdate() }}
                className="btn-base btn-tertiary px-3 py-1.5 text-xs"
              >
                Retry
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
