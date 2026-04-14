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
}

export interface UseTutorialResult {
  status: TutorialStatus
  isTutorialActive: boolean
  currentStepIndex: number
  currentStep: TutorialStep | null
  totalSteps: number
  startTutorial: (steps: TutorialStep[], options?: StartOptions) => void
  nextStep: () => void
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
    setSteps(nextSteps)
    setCurrentStepIndex(0)
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
    skipTutorial,
  }), [status, currentStepIndex, steps, startTutorial, nextStep, skipTutorial])
}
