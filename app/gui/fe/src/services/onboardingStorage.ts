import { storageGetJSON, storageSetJSON, storageRemove } from './storageUtils'

const ONBOARDING_KEY = 'veiled_onboarding'

export type OnboardingStep = 0 | 1 | 2 | 3
export const ONBOARDING_TOTAL_STEPS = 4

export interface OnboardingState {
  step: OnboardingStep
  completed: boolean
}

/** Read onboarding state from localStorage. Returns step 0 if not found. */
export function getOnboardingState(): OnboardingState {
  const parsed = storageGetJSON<OnboardingState | null>(ONBOARDING_KEY, null)
  if (parsed && typeof parsed.step === 'number' && typeof parsed.completed === 'boolean') {
    return parsed
  }
  return { step: 0, completed: false }
}

/** Save onboarding state. */
export function setOnboardingState(state: OnboardingState): void {
  storageSetJSON(ONBOARDING_KEY, state)
}

/** Mark onboarding as completed. */
export function completeOnboarding(): void {
  setOnboardingState({ step: 3, completed: true })
}

/** Advance to the next onboarding step. Returns the new state. */
export function advanceOnboardingStep(): OnboardingState {
  const current = getOnboardingState()
  if (current.completed) return current
  const nextStep = Math.min(current.step + 1, 3) as OnboardingStep
  const isComplete = nextStep === 3
  const newState: OnboardingState = {
    step: nextStep,
    completed: isComplete,
  }
  setOnboardingState(newState)
  return newState
}

/** Reset onboarding (for testing or re-triggering). */
export function resetOnboarding(): void {
  storageRemove(ONBOARDING_KEY)
}
