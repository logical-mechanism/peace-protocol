import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { getSnarkProver } from '../services/snark'
import { useModalStack } from '../hooks/useModalStack'
import { useFocusTrap } from '../hooks/useFocusTrap'
import LoadingSpinner from './LoadingSpinner'

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
  const { t } = useTranslation(['modals', 'common'])
  const [status, setStatus] = useState<'checking' | 'decompressing' | 'complete' | 'error'>('checking')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Stack-aware Escape key + body scroll lock + animation
  const { zIndex, shouldRender, animationState } = useModalStack(
    'snark-download', isOpen, onClose,
    status === 'decompressing' || status === 'checking',
  )
  const modalRef = useRef<HTMLDivElement>(null)
  useFocusTrap(modalRef, isOpen)

  // Check setup status on open
  useEffect(() => {
    if (!isOpen) return

    const checkAndSetup = async () => {
      setStatus('checking')
      setError(null)
      setMessage(t('modals:snarkDownload.checking'))

      try {
        const prover = getSnarkProver()
        const exists = await prover.checkSetup()

        if (exists) {
          setStatus('complete')
          onReady()
        } else {
          setStatus('decompressing')
          setMessage(t('modals:snarkDownload.decompressing'))

          await prover.initialize((progress) => {
            setMessage(progress.message)
          })

          setStatus('complete')
          onReady()
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('modals:snarkDownload.failedFallback')
        setError(msg)
        setStatus('error')
      }
    }

    checkAndSetup()
  }, [isOpen, onReady, t])

  const handleRetry = useCallback(async () => {
    setStatus('checking')
    setError(null)
    setMessage(t('modals:snarkDownload.retrying'))

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
      const msg = err instanceof Error ? err.message : t('modals:snarkDownload.failedFallback')
      setError(msg)
      setStatus('error')
    }
  }, [onReady, t])

  if (!shouldRender) return null

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="snark-download-title"
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-[var(--backdrop-overlay)] backdrop-blur-sm ${animationState === 'exiting' ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}`}
        onClick={status !== 'decompressing' ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Modal — no overflow-hidden on panel root so focus outlines on
       * edge-adjacent buttons aren't clipped in WebKit. */}
      <div className={`relative w-full max-w-lg max-h-[90vh] bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] shadow-lg flex flex-col ${animationState === 'exiting' ? 'modal-panel-exit' : 'modal-panel-enter'}`}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-subtle)] rounded-t-[var(--radius-xl)]">
          <div className="flex items-center justify-between">
            <h2 id="snark-download-title" className="text-xl font-semibold">{t('modals:snarkDownload.title')}</h2>
            {status !== 'decompressing' && status !== 'checking' && (
              // tabIndex={-1}: Escape closes — header X is a mouse convenience.
              <button
                onClick={onClose}
                aria-label={t('modals:common.closeDialog')}
                tabIndex={-1}
                className="p-1 btn-base btn-icon"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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
              <LoadingSpinner variant="ring" size="lg" />
              <span className="text-[var(--text-secondary)]">{message}</span>
              {status === 'decompressing' && (
                <p className="text-sm text-[var(--text-muted)] text-center">
                  {t('modals:snarkDownload.onlyOnce')}
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
              <p className="text-lg font-medium">{t('modals:snarkDownload.ready')}</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                {t('modals:snarkDownload.readyBody')}
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
        <div className="px-6 py-4 border-t border-[var(--border-subtle)] flex justify-end gap-3 rounded-b-[var(--radius-xl)]">
          {status === 'complete' && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
            >
              {t('modals:snarkDownload.continue')}
            </button>
          )}

          {status === 'error' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm btn-base btn-icon"
              >
                {t('common:actions.cancel')}
              </button>
              <button
                onClick={handleRetry}
                className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
              >
                {t('modals:snarkDownload.retry')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
