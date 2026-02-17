import { useState, useEffect, useCallback } from 'react'
import { getSnarkProver } from '../services/snark'

interface SnarkSetupModalProps {
  isOpen: boolean
  onClose: () => void
  onReady: () => void
}

/**
 * Modal for SNARK prover setup.
 *
 * On first launch, checks if setup files (pk.bin, ccs.bin) exist.
 * If missing, triggers decompression of bundled .zst files.
 * These files are shipped with the installer (~500MB compressed).
 */
export default function SnarkSetupModal({
  isOpen,
  onClose,
  onReady,
}: SnarkSetupModalProps) {
  const [status, setStatus] = useState<'checking' | 'decompressing' | 'complete' | 'error'>('checking')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Check setup status on open
  useEffect(() => {
    if (!isOpen) return

    const checkAndSetup = async () => {
      setStatus('checking')
      setError(null)
      setMessage('Checking setup files...')

      try {
        const prover = getSnarkProver()
        const exists = await prover.checkSetup()

        if (exists) {
          setStatus('complete')
          onReady()
        } else {
          setStatus('decompressing')
          setMessage('Decompressing SNARK setup files...')

          await prover.initialize((progress) => {
            setMessage(progress.message)
          })

          setStatus('complete')
          onReady()
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Setup failed'
        setError(msg)
        setStatus('error')
      }
    }

    checkAndSetup()
  }, [isOpen, onReady])

  const handleRetry = useCallback(async () => {
    setStatus('checking')
    setError(null)
    setMessage('Retrying setup...')

    try {
      const prover = getSnarkProver()
      await prover.initialize((progress) => {
        setMessage(progress.message)
        if (progress.stage === 'checking-setup') {
          setStatus('decompressing')
        }
      })

      setStatus('complete')
      onReady()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Setup failed'
      setError(msg)
      setStatus('error')
    }
  }, [onReady])

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
        onClick={status !== 'decompressing' ? onClose : undefined}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] shadow-lg overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">SNARK Prover Setup</h2>
            {status !== 'decompressing' && status !== 'checking' && (
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
          {(status === 'checking' || status === 'decompressing') && (
            <div className="flex flex-col items-center py-8 space-y-4">
              <div className="animate-spin w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
              <span className="text-[var(--text-secondary)]">{message}</span>
              {status === 'decompressing' && (
                <p className="text-sm text-[var(--text-muted)] text-center">
                  This only needs to happen once
                </p>
              )}
            </div>
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
                SNARK setup files are ready to use
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
        <div className="px-6 py-4 border-t border-[var(--border-subtle)] flex justify-end gap-3">
          {status === 'complete' && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-colors"
            >
              Continue
            </button>
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
                onClick={handleRetry}
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
