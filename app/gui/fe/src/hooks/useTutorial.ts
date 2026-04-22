import { useCallback, useMemo, useState } from 'react'

export type TutorialPlacement = 'top' | 'bottom' | 'left' | 'right'

export interface TutorialStep {
  /** CSS selector identifying the element to highlight. */
  targetSelector: string
  /** Tooltip title. */
  title: string
  /** Tooltip body text. */
  description: string
  /** Preferred tooltip placement relative to the target. Default 'bottom'. */
  placement?: TutorialPlacement
}

export type TutorialStatus = 'idle' | 'active' | 'completed'

interface StartOptions {
  /** Called when the final step is advanced past. */
  onComplete?: () => void
  /** Called when the user skips. */
  onSkip?: () => void
  /** Zero-based index to start at. Defaults to 0.
   * Useful for event-driven tours that join mid-flow (e.g. first-bid-accepted
   * auto-starting at step 2 after the user has already clicked Accept). */
  startStep?: number
}

export interface UseTutorialResult {
  status: TutorialStatus
  isTutorialActive: boolean
  currentStepIndex: number
  currentStep: TutorialStep | null
  totalSteps: number
  startTutorial: (steps: TutorialStep[], options?: StartOptions) => void
  nextStep: () => void
  /** Jump to a specific step (clamped to the valid range). No-op when inactive.
   * Intended for event-driven tours that advance in response to external state
   * transitions rather than user Next clicks. */
  goToStep: (index: number) => void
  skipTutorial: () => void
}

/**
 * State machine for a multi-step tutorial overlay. Purely client-side —
 * the caller is responsible for persisting completion (e.g. via
 * `markFirstListingCompleted`).
 */
export function useTutorial(): UseTutorialResult {
  const [steps, setSteps] = useState<TutorialStep[]>([])
  const [status, setStatus] = useState<TutorialStatus>('idle')
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [callbacks, setCallbacks] = useState<StartOptions>({})

  const startTutorial = useCallback((nextSteps: TutorialStep[], options?: StartOptions) => {
    if (nextSteps.length === 0) return
    const rawStart = options?.startStep ?? 0
    const clampedStart = Math.max(0, Math.min(rawStart, nextSteps.length - 1))
    setSteps(nextSteps)
    setCurrentStepIndex(clampedStart)
    setCallbacks(options ?? {})
    setStatus('active')
  }, [])

  const nextStep = useCallback(() => {
    setCurrentStepIndex((prev) => {
      const next = prev + 1
      if (next >= steps.length) {
        setStatus('completed')
        callbacks.onComplete?.()
        return prev
      }
      return next
    })
  }, [steps.length, callbacks])

  const goToStep = useCallback((index: number) => {
    if (steps.length === 0) return
    const clamped = Math.max(0, Math.min(index, steps.length - 1))
    setCurrentStepIndex((prev) => (prev === clamped ? prev : clamped))
  }, [steps.length])

  const skipTutorial = useCallback(() => {
    setStatus('completed')
    callbacks.onSkip?.()
  }, [callbacks])

  return useMemo<UseTutorialResult>(() => ({
    status,
    isTutorialActive: status === 'active',
    currentStepIndex,
    currentStep: status === 'active' ? steps[currentStepIndex] ?? null : null,
    totalSteps: steps.length,
    startTutorial,
    nextStep,
    goToStep,
    skipTutorial,
  }), [status, currentStepIndex, steps, startTutorial, nextStep, goToStep, skipTutorial])
}
