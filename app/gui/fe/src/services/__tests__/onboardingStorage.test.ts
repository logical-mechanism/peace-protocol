import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getOnboardingState,
  setOnboardingState,
  advanceOnboardingStep,
  completeOnboarding,
  resetOnboarding,
  markFirstListingCompleted,
  markFirstBidCompleted,
  markFirstDecryptCompleted,
  markFirstBidAcceptedCompleted,
  markIagonPrimerCompleted,
  resetTutorials,
  resetTutorialFlag,
  type OnboardingState,
} from '../onboardingStorage'

const DEFAULT: OnboardingState = {
  step: 0,
  completed: false,
  firstListingCompleted: false,
  firstBidCompleted: false,
  firstDecryptCompleted: false,
  firstBidAcceptedCompleted: false,
  iagonPrimerCompleted: false,
}

function makeState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return { ...DEFAULT, ...overrides }
}

describe('onboardingStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('getOnboardingState', () => {
    it('returns default state when nothing stored', () => {
      expect(getOnboardingState()).toEqual(DEFAULT)
    })

    it('returns stored state', () => {
      localStorage.setItem('veiled_onboarding', JSON.stringify(makeState({
        step: 2,
        firstListingCompleted: true,
      })))
      expect(getOnboardingState()).toEqual(makeState({
        step: 2,
        firstListingCompleted: true,
      }))
    })

    it('returns default for malformed JSON', () => {
      localStorage.setItem('veiled_onboarding', 'not-json')
      expect(getOnboardingState()).toEqual(DEFAULT)
    })

    it('returns default for missing core fields', () => {
      localStorage.setItem('veiled_onboarding', JSON.stringify({ step: 1 }))
      expect(getOnboardingState()).toEqual(DEFAULT)
    })

    it('migrates legacy entries by adding tutorial flags as false', () => {
      localStorage.setItem('veiled_onboarding', JSON.stringify({ step: 3, completed: true }))
      expect(getOnboardingState()).toEqual(makeState({
        step: 3,
        completed: true,
      }))
    })

    it('migrates entries that have only firstListing/firstBid flags', () => {
      localStorage.setItem('veiled_onboarding', JSON.stringify({
        step: 3,
        completed: true,
        firstListingCompleted: true,
        firstBidCompleted: true,
      }))
      expect(getOnboardingState()).toEqual(makeState({
        step: 3,
        completed: true,
        firstListingCompleted: true,
        firstBidCompleted: true,
      }))
    })

    it('migrates entries missing only firstBidAcceptedCompleted', () => {
      localStorage.setItem('veiled_onboarding', JSON.stringify({
        step: 3,
        completed: true,
        firstListingCompleted: true,
        firstBidCompleted: true,
        firstDecryptCompleted: true,
      }))
      expect(getOnboardingState().firstBidAcceptedCompleted).toBe(false)
    })

    it('migrates entries missing iagonPrimerCompleted', () => {
      localStorage.setItem('veiled_onboarding', JSON.stringify({
        step: 3,
        completed: true,
        firstListingCompleted: true,
        firstBidCompleted: true,
        firstDecryptCompleted: true,
        firstBidAcceptedCompleted: true,
      }))
      expect(getOnboardingState().iagonPrimerCompleted).toBe(false)
    })
  })

  describe('setOnboardingState', () => {
    it('persists state to localStorage', () => {
      setOnboardingState(makeState({ step: 1 }))
      const raw = localStorage.getItem('veiled_onboarding')
      expect(JSON.parse(raw!)).toEqual(makeState({ step: 1 }))
    })
  })

  describe('advanceOnboardingStep', () => {
    it('advances from 0 to 1', () => {
      expect(advanceOnboardingStep()).toMatchObject({ step: 1, completed: false })
    })

    it('advances from 2 to 3 and marks completed', () => {
      setOnboardingState(makeState({ step: 2 }))
      expect(advanceOnboardingStep()).toMatchObject({ step: 3, completed: true })
    })

    it('does not advance beyond 3', () => {
      setOnboardingState(makeState({ step: 3, completed: true }))
      expect(advanceOnboardingStep()).toMatchObject({ step: 3, completed: true })
    })

    it('preserves tutorial flags when advancing', () => {
      setOnboardingState(makeState({
        step: 1,
        firstListingCompleted: true,
        firstDecryptCompleted: true,
        firstBidAcceptedCompleted: true,
        iagonPrimerCompleted: true,
      }))
      expect(advanceOnboardingStep()).toMatchObject({
        firstListingCompleted: true,
        firstDecryptCompleted: true,
        firstBidAcceptedCompleted: true,
        iagonPrimerCompleted: true,
      })
    })
  })

  describe('completeOnboarding', () => {
    it('marks onboarding as completed at step 3, preserving tutorial flags', () => {
      setOnboardingState(makeState({
        firstListingCompleted: true,
        firstBidCompleted: true,
        firstDecryptCompleted: true,
        firstBidAcceptedCompleted: true,
        iagonPrimerCompleted: true,
      }))
      completeOnboarding()
      expect(getOnboardingState()).toEqual(makeState({
        step: 3,
        completed: true,
        firstListingCompleted: true,
        firstBidCompleted: true,
        firstDecryptCompleted: true,
        firstBidAcceptedCompleted: true,
        iagonPrimerCompleted: true,
      }))
    })
  })

  describe('markFirstListingCompleted', () => {
    it('sets firstListingCompleted to true', () => {
      markFirstListingCompleted()
      expect(getOnboardingState().firstListingCompleted).toBe(true)
    })

    it('is idempotent', () => {
      markFirstListingCompleted()
      markFirstListingCompleted()
      expect(getOnboardingState().firstListingCompleted).toBe(true)
    })
  })

  describe('markFirstBidCompleted', () => {
    it('sets firstBidCompleted to true', () => {
      markFirstBidCompleted()
      expect(getOnboardingState().firstBidCompleted).toBe(true)
    })
  })

  describe('markFirstDecryptCompleted', () => {
    it('sets firstDecryptCompleted to true', () => {
      markFirstDecryptCompleted()
      expect(getOnboardingState().firstDecryptCompleted).toBe(true)
    })

    it('is idempotent', () => {
      markFirstDecryptCompleted()
      markFirstDecryptCompleted()
      expect(getOnboardingState().firstDecryptCompleted).toBe(true)
    })

    it('does not affect other tutorial flags', () => {
      setOnboardingState(makeState({
        step: 3,
        completed: true,
        firstListingCompleted: true,
        firstBidCompleted: true,
        firstBidAcceptedCompleted: true,
        iagonPrimerCompleted: true,
      }))
      markFirstDecryptCompleted()
      expect(getOnboardingState()).toEqual(makeState({
        step: 3,
        completed: true,
        firstListingCompleted: true,
        firstBidCompleted: true,
        firstDecryptCompleted: true,
        firstBidAcceptedCompleted: true,
        iagonPrimerCompleted: true,
      }))
    })
  })

  describe('markFirstBidAcceptedCompleted', () => {
    it('sets firstBidAcceptedCompleted to true', () => {
      markFirstBidAcceptedCompleted()
      expect(getOnboardingState().firstBidAcceptedCompleted).toBe(true)
    })

    it('is idempotent', () => {
      markFirstBidAcceptedCompleted()
      markFirstBidAcceptedCompleted()
      expect(getOnboardingState().firstBidAcceptedCompleted).toBe(true)
    })

    it('does not affect other tutorial flags', () => {
      setOnboardingState(makeState({
        step: 3,
        completed: true,
        firstListingCompleted: true,
        firstBidCompleted: true,
        firstDecryptCompleted: true,
        iagonPrimerCompleted: true,
      }))
      markFirstBidAcceptedCompleted()
      expect(getOnboardingState()).toEqual(makeState({
        step: 3,
        completed: true,
        firstListingCompleted: true,
        firstBidCompleted: true,
        firstDecryptCompleted: true,
        firstBidAcceptedCompleted: true,
        iagonPrimerCompleted: true,
      }))
    })
  })

  describe('markIagonPrimerCompleted', () => {
    it('sets iagonPrimerCompleted to true', () => {
      markIagonPrimerCompleted()
      expect(getOnboardingState().iagonPrimerCompleted).toBe(true)
    })

    it('is idempotent', () => {
      markIagonPrimerCompleted()
      markIagonPrimerCompleted()
      expect(getOnboardingState().iagonPrimerCompleted).toBe(true)
    })

    it('does not affect other tutorial flags', () => {
      setOnboardingState(makeState({
        step: 3,
        completed: true,
        firstListingCompleted: true,
        firstBidCompleted: true,
        firstDecryptCompleted: true,
        firstBidAcceptedCompleted: true,
      }))
      markIagonPrimerCompleted()
      expect(getOnboardingState()).toEqual(makeState({
        step: 3,
        completed: true,
        firstListingCompleted: true,
        firstBidCompleted: true,
        firstDecryptCompleted: true,
        firstBidAcceptedCompleted: true,
        iagonPrimerCompleted: true,
      }))
    })
  })

  describe('resetTutorials', () => {
    it('clears all tutorial flags without touching onboarding state', () => {
      setOnboardingState(makeState({
        step: 3,
        completed: true,
        firstListingCompleted: true,
        firstBidCompleted: true,
        firstDecryptCompleted: true,
        firstBidAcceptedCompleted: true,
        iagonPrimerCompleted: true,
      }))
      resetTutorials()
      expect(getOnboardingState()).toEqual(makeState({
        step: 3,
        completed: true,
      }))
    })
  })

  describe('resetTutorialFlag', () => {
    const ALL_ON = makeState({
      step: 3,
      completed: true,
      firstListingCompleted: true,
      firstBidCompleted: true,
      firstDecryptCompleted: true,
      firstBidAcceptedCompleted: true,
      iagonPrimerCompleted: true,
    })

    it('resets only firstBidCompleted without touching others', () => {
      setOnboardingState(ALL_ON)
      resetTutorialFlag('firstBidCompleted')
      expect(getOnboardingState()).toEqual({ ...ALL_ON, firstBidCompleted: false })
    })

    it('resets only firstListingCompleted without touching others', () => {
      setOnboardingState(ALL_ON)
      resetTutorialFlag('firstListingCompleted')
      expect(getOnboardingState()).toEqual({ ...ALL_ON, firstListingCompleted: false })
    })

    it('resets only firstDecryptCompleted without touching others', () => {
      setOnboardingState(ALL_ON)
      resetTutorialFlag('firstDecryptCompleted')
      expect(getOnboardingState()).toEqual({ ...ALL_ON, firstDecryptCompleted: false })
    })

    it('resets only firstBidAcceptedCompleted without touching others', () => {
      setOnboardingState(ALL_ON)
      resetTutorialFlag('firstBidAcceptedCompleted')
      expect(getOnboardingState()).toEqual({ ...ALL_ON, firstBidAcceptedCompleted: false })
    })

    it('resets only iagonPrimerCompleted without touching others', () => {
      setOnboardingState(ALL_ON)
      resetTutorialFlag('iagonPrimerCompleted')
      expect(getOnboardingState()).toEqual({ ...ALL_ON, iagonPrimerCompleted: false })
    })
  })

  describe('resetOnboarding', () => {
    it('removes state from localStorage', () => {
      setOnboardingState(makeState({ step: 2 }))
      resetOnboarding()
      expect(getOnboardingState()).toEqual(DEFAULT)
    })
  })

  describe('error paths', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('getOnboardingState returns default when getItem throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('SecurityError')
      })
      expect(getOnboardingState()).toEqual(DEFAULT)
    })

    it('setOnboardingState silently swallows quota exceeded error', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError')
      })
      expect(() => setOnboardingState(makeState({ step: 1 }))).not.toThrow()
    })

    it('resetOnboarding silently swallows errors', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('SecurityError')
      })
      expect(() => resetOnboarding()).not.toThrow()
    })
  })
})
