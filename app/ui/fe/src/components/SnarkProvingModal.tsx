import { useState, useEffect, useCallback, useRef } from 'react'
import { getSnarkProver } from '../services/snark'
import type { SnarkProofInputs, SnarkProof, ProvingProgress } from '../services/snark'

interface SnarkProvingModalProps {
  isOpen: boolean
  onClose: () => void
  onProofGenerated: (proof: SnarkProof) => void
  inputs: SnarkProofInputs | null
}

type ProvingState = 'idle' | 'initializing' | 'proving' | 'success' | 'error'

/**
 * Modal for displaying SNARK proof generation progress.
 *
 * Shows an animated progress indicator while the Web Worker generates
 * the Groth16 proof (typically 10-30 seconds on desktop).
 */
export default function SnarkProvingModal({
  isOpen,
  onClose,
  onProofGenerated,
  inputs,
}: SnarkProvingModalProps) {
  const [state, setState] = useState<ProvingState>('idle')
  const [progress, setProgress] = useState<ProvingProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [proof, setProof] = useState<SnarkProof | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Start elapsed time counter when proving
  useEffect(() => {
    if (state === 'proving' || state === 'initializing') {
      setElapsedTime(0)
      timerRef.current = setInterval(() => {
        setElapsedTime((prev) => prev + 1)
      }, 1000)
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [state])

  // Start proving when modal opens with inputs
  useEffect(() => {
    if (!isOpen || !inputs) {
      setState('idle')
      setProgress(null)
      setError(null)
      setProof(null)
      return
    }

    const generateProof = async () => {
      setState('initializing')
      setError(null)

      try {
        const prover = getSnarkProver()

        const generatedProof = await prover.generateProof(inputs, (progress) => {
          setProgress(progress)
          if (progress.stage === 'proving') {
            setState('proving')
          }
        })

        setProof(generatedProof)
        setState('success')
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Proof generation failed'
        setError(message)
        setState('error')
      }
    }

    generateProof()
  }, [isOpen, inputs])

  const handleContinue = useCallback(() => {
    if (proof) {
      onProofGenerated(proof)
    }
    onClose()
  }, [proof, onProofGenerated, onClose])

  const handleRetry = useCallback(() => {
    if (inputs) {
      setState('idle')
      setError(null)
      // Trigger a re-run by toggling a flag
      const generateProof = async () => {
        setState('initializing')

        try {
          const prover = getSnarkProver()

          const generatedProof = await prover.generateProof(inputs, (progress) => {
            setProgress(progress)
            if (progress.stage === 'proving') {
              setState('proving')
            }
          })

          setProof(generatedProof)
          setState('success')
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Proof generation failed'
          setError(message)
          setState('error')
        }
      }

      generateProof()
    }
  }, [inputs])

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

  // Warn before closing during proving
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (state === 'proving' || state === 'initializing') {
        e.preventDefault()
        e.returnValue = 'Proof generation is in progress. Are you sure you want to leave?'
        return e.returnValue
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [state])

  if (!isOpen) return null

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const canClose = state === 'success' || state === 'error' || state === 'idle'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={canClose ? onClose : undefined}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] shadow-lg overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">
              {state === 'success' ? 'Proof Generated' : 'Generating Proof'}
            </h2>
            {canClose && (
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
        <div className="px-6 py-8 space-y-6">
          {(state === 'initializing' || state === 'proving') && (
            <>
              {/* Animated prover icon */}
              <div className="flex justify-center">
                <div className="relative">
                  <div className="w-24 h-24 rounded-full bg-[var(--accent-muted)] flex items-center justify-center">
                    <svg
                      className="w-12 h-12 text-[var(--accent)] animate-pulse"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                      />
                    </svg>
                  </div>
                  {/* Spinning ring */}
                  <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[var(--accent)] animate-spin" />
                </div>
              </div>

              {/* Progress info */}
              <div className="text-center space-y-2">
                <p className="text-lg font-medium">
                  {state === 'initializing' ? 'Initializing prover...' : 'Generating zero-knowledge proof...'}
                </p>
                <p className="text-sm text-[var(--text-muted)]">
                  This may take 10-30 seconds
                </p>
              </div>

              {/* Progress bar */}
              {progress && (
                <div className="space-y-2">
                  <div className="h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--accent)] transition-all duration-500 ease-out"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-[var(--text-muted)]">
                    <span>{progress.message}</span>
                    <span>{progress.percent}%</span>
                  </div>
                </div>
              )}

              {/* Timer */}
              <div className="text-center">
                <span className="text-sm text-[var(--text-muted)]">Elapsed: </span>
                <span className="text-sm font-mono text-[var(--text-secondary)]">{formatTime(elapsedTime)}</span>
              </div>

              {/* Warning */}
              <div className="bg-[var(--warning-muted)] text-[var(--warning)] rounded-[var(--radius-md)] px-4 py-3 text-sm flex items-center gap-2">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>Do not close this tab</span>
              </div>
            </>
          )}

          {state === 'success' && (
            <div className="flex flex-col items-center py-4">
              <div className="w-20 h-20 bg-[var(--success-muted)] rounded-full flex items-center justify-center mb-4">
                <svg className="w-10 h-10 text-[var(--success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-xl font-medium">Proof Generated!</p>
              <p className="text-sm text-[var(--text-muted)] mt-2 text-center">
                Zero-knowledge proof generated successfully in {formatTime(elapsedTime)}
              </p>
            </div>
          )}

          {state === 'error' && (
            <>
              <div className="flex flex-col items-center py-4">
                <div className="w-20 h-20 bg-[var(--error-muted)] rounded-full flex items-center justify-center mb-4">
                  <svg className="w-10 h-10 text-[var(--error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <p className="text-xl font-medium">Proof Generation Failed</p>
              </div>

              <div className="bg-[var(--error-muted)] text-[var(--error)] rounded-[var(--radius-md)] px-4 py-3 text-sm">
                {error}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border-subtle)] flex justify-end gap-3">
          {state === 'success' && (
            <button
              onClick={handleContinue}
              className="px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-colors"
            >
              Continue
            </button>
          )}

          {state === 'error' && (
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
