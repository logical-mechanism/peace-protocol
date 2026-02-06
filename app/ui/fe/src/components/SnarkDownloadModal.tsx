import { useState, useEffect, useCallback } from 'react'
import { getSnarkProver, formatBytes, EXPECTED_FILE_SIZES } from '../services/snark'
import type { ProvingProgress } from '../services/snark'

interface SnarkDownloadModalProps {
  isOpen: boolean
  onClose: () => void
  onReady: () => void
}

/**
 * Modal for downloading and caching SNARK proving files.
 *
 * The proving files (pk.bin ~613MB, ccs.bin ~85MB) are large and need to be
 * downloaded once and cached in IndexedDB for future use.
 */
export default function SnarkDownloadModal({
  isOpen,
  onClose,
  onReady,
}: SnarkDownloadModalProps) {
  const [status, setStatus] = useState<'checking' | 'prompt' | 'downloading' | 'complete' | 'error'>('checking')
  const [progress, setProgress] = useState<ProvingProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cachedFiles, setCachedFiles] = useState<{ pk: boolean; ccs: boolean }>({ pk: false, ccs: false })

  const totalSize = EXPECTED_FILE_SIZES['pk.bin'] + EXPECTED_FILE_SIZES['ccs.bin']

  // Check cache status on open
  useEffect(() => {
    if (!isOpen) return

    const checkCache = async () => {
      setStatus('checking')
      setError(null)

      try {
        const prover = getSnarkProver()
        const { cached, sizes } = await prover.checkCache()

        setCachedFiles({
          pk: sizes.pk !== null,
          ccs: sizes.ccs !== null,
        })

        if (cached) {
          setStatus('complete')
          onReady()
        } else {
          setStatus('prompt')
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to check cache'
        setError(message)
        setStatus('error')
      }
    }

    checkCache()
  }, [isOpen, onReady])

  const handleDownload = useCallback(async () => {
    setStatus('downloading')
    setError(null)

    try {
      const prover = getSnarkProver()
      await prover.ensureFilesDownloaded((progress) => {
        setProgress(progress)

        // Update cached files status as downloads complete
        if (progress.downloadProgress?.fileName === 'pk.bin' && progress.percent >= 50) {
          setCachedFiles((prev) => ({ ...prev, pk: true }))
        }
        if (progress.downloadProgress?.fileName === 'ccs.bin' && progress.percent >= 100) {
          setCachedFiles((prev) => ({ ...prev, ccs: true }))
        }
      })

      setStatus('complete')
      onReady()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Download failed'
      setError(message)
      setStatus('error')
    }
  }, [onReady])

  const handleClearCache = useCallback(async () => {
    try {
      const prover = getSnarkProver()
      await prover.clearCache()
      setCachedFiles({ pk: false, ccs: false })
      setStatus('prompt')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to clear cache'
      setError(message)
    }
  }, [])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={status !== 'downloading' ? onClose : undefined}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] shadow-lg overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">SNARK Prover Setup</h2>
            {status !== 'downloading' && (
              <button
                onClick={onClose}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-6 space-y-4">
          {status === 'checking' && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
              <span className="ml-3 text-[var(--text-secondary)]">Checking cache...</span>
            </div>
          )}

          {status === 'prompt' && (
            <>
              <p className="text-[var(--text-secondary)]">
                To generate zero-knowledge proofs, you need to download the proving keys.
                These files are large but only need to be downloaded once.
              </p>

              <div className="bg-[var(--bg-secondary)] rounded-[var(--radius-lg)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[var(--text-secondary)]">Total download size</span>
                  <span className="font-medium text-[var(--accent)]">{formatBytes(totalSize)}</span>
                </div>
                <div className="space-y-2">
                  <FileStatus name="Proving key (pk.bin)" size={EXPECTED_FILE_SIZES['pk.bin']} cached={cachedFiles.pk} />
                  <FileStatus name="Constraint system (ccs.bin)" size={EXPECTED_FILE_SIZES['ccs.bin']} cached={cachedFiles.ccs} />
                </div>
              </div>

              <div className="bg-[var(--warning-muted)] text-[var(--warning)] rounded-[var(--radius-md)] px-4 py-3 text-sm flex items-start gap-2">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>
                  Download may take several minutes depending on your connection.
                  The files will be cached for future visits.
                </span>
              </div>
            </>
          )}

          {status === 'downloading' && progress && (
            <>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-secondary)]">{progress.message}</span>
                  <span className="text-[var(--accent)]">{progress.percent}%</span>
                </div>
                <div className="h-3 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent)] transition-all duration-300 ease-out"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
              </div>

              {progress.downloadProgress && (
                <div className="text-sm text-[var(--text-muted)] text-center">
                  {formatBytes(progress.downloadProgress.loaded)} / {formatBytes(progress.downloadProgress.total)}
                </div>
              )}

              <div className="text-sm text-center text-[var(--text-muted)]">
                Do not close this tab while downloading
              </div>
            </>
          )}

          {status === 'complete' && (
            <div className="flex flex-col items-center py-8">
              <div className="w-16 h-16 bg-[var(--success-muted)] rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-[var(--success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-lg font-medium">Prover Ready</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                SNARK proving files are cached and ready to use
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="bg-[var(--error-muted)] text-[var(--error)] rounded-[var(--radius-md)] px-4 py-3 text-sm flex items-start gap-2">
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border-subtle)] flex justify-between">
          {status === 'complete' && (
            <>
              <button
                onClick={handleClearCache}
                className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                Clear Cache
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-colors"
              >
                Continue
              </button>
            </>
          )}

          {status === 'prompt' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDownload}
                className="px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-colors"
              >
                Download Files
              </button>
            </>
          )}

          {status === 'error' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDownload}
                className="px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-colors"
              >
                Retry
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

interface FileStatusProps {
  name: string
  size: number
  cached: boolean
}

function FileStatus({ name, size, cached }: FileStatusProps) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2">
        {cached ? (
          <svg className="w-4 h-4 text-[var(--success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
          </svg>
        )}
        <span className={cached ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}>
          {name}
        </span>
      </div>
      <span className="text-[var(--text-muted)]">{formatBytes(size)}</span>
    </div>
  )
}
