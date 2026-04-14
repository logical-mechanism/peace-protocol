import { storageGetJSON, storageSetJSON, storageRemove } from './storageUtils'

const ONBOARDING_KEY = 'veiled_onboarding'

export type OnboardingStep = 0 | 1 | 2 | 3
export const ONBOARDING_TOTAL_STEPS = 4

export interface OnboardingState {
  step: OnboardingStep
  completed: boolean
  firstListingCompleted: boolean
  firstBidCompleted: boolean
}

const DEFAULT_STATE: OnboardingState = {
  step: 0,
  completed: false,
  firstListingCompleted: false,
  firstBidCompleted: false,
}

/** Read onboarding state from localStorage. Returns default state if not found.
 * Migrates older entries that lack the tutorial-completion fields by filling
 * them with `false`. */
export function getOnboardingState(): OnboardingState {
  const parsed = storageGetJSON<Partial<OnboardingState> | null>(ONBOARDING_KEY, null)
  if (!parsed || typeof parsed.step !== 'number' || typeof parsed.completed !== 'boolean') {
    return { ...DEFAULT_STATE }
  }
  return {
    step: parsed.step as OnboardingStep,
    completed: parsed.completed,
    firstListingCompleted: typeof parsed.firstListingCompleted === 'boolean'
      ? parsed.firstListingCompleted
      : false,
    firstBidCompleted: typeof parsed.firstBidCompleted === 'boolean'
      ? parsed.firstBidCompleted
      : false,
  }
}

/** Save onboarding state. */
export function setOnboardingState(state: OnboardingState): void {
  storageSetJSON(ONBOARDING_KEY, state)
}

/** Mark onboarding as completed (preserves tutorial flags). */
export function completeOnboarding(): void {
  const current = getOnboardingState()
  setOnboardingState({ ...current, step: 3, completed: true })
}

/** Advance to the next onboarding step. Returns the new state. */
export function advanceOnboardingStep(): OnboardingState {
  const current = getOnboardingState()
  if (current.completed) return current
  const nextStep = Math.min(current.step + 1, 3) as OnboardingStep
  const isComplete = nextStep === 3
  const newState: OnboardingState = {
    ...current,
    step: nextStep,
    completed: isComplete,
  }
  setOnboardingState(newState)
  return newState
}

/** Mark the first-listing tutorial as completed. */
export function markFirstListingCompleted(): void {
  const current = getOnboardingState()
  if (current.firstListingCompleted) return
  setOnboardingState({ ...current, firstListingCompleted: true })
}

/** Mark the first-bid tutorial as completed. */
export function markFirstBidCompleted(): void {
  const current = getOnboardingState()
  if (current.firstBidCompleted) return
  setOnboardingState({ ...current, firstBidCompleted: true })
}

/** Re-enable both guided tutorials (clears completion flags). */
export function resetTutorials(): void {
  const current = getOnboardingState()
  setOnboardingState({
    ...current,
    firstListingCompleted: false,
    firstBidCompleted: false,
  })
}

/** Reset onboarding (for testing or re-triggering). */
export function resetOnboarding(): void {
  storageRemove(ONBOARDING_KEY)
}
