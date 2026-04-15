import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getOnboardingState,
  setOnboardingState,
  advanceOnboardingStep,
  completeOnboarding,
  resetOnboarding,
  markFirstListingCompleted,
  markFirstBidCompleted,
  resetTutorials,
} from '../onboardingStorage'

const DEFAULT = {
  step: 0,
  completed: false,
  firstListingCompleted: false,
  firstBidCompleted: false,
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
      localStorage.setItem('veiled_onboarding', JSON.stringify({
        step: 2,
        completed: false,
        firstListingCompleted: true,
        firstBidCompleted: false,
      }))
      expect(getOnboardingState()).toEqual({
        step: 2,
        completed: false,
        firstListingCompleted: true,
        firstBidCompleted: false,
      })
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
      expect(getOnboardingState()).toEqual({
        step: 3,
        completed: true,
        firstListingCompleted: false,
        firstBidCompleted: false,
      })
    })
  })

  describe('setOnboardingState', () => {
    it('persists state to localStorage', () => {
      setOnboardingState({ step: 1, completed: false, firstListingCompleted: false, firstBidCompleted: false })
      const raw = localStorage.getItem('veiled_onboarding')
      expect(JSON.parse(raw!)).toEqual({ step: 1, completed: false, firstListingCompleted: false, firstBidCompleted: false })
    })
  })

  describe('advanceOnboardingStep', () => {
    it('advances from 0 to 1', () => {
      expect(advanceOnboardingStep()).toMatchObject({ step: 1, completed: false })
    })

    it('advances from 2 to 3 and marks completed', () => {
      setOnboardingState({ step: 2, completed: false, firstListingCompleted: false, firstBidCompleted: false })
      expect(advanceOnboardingStep()).toMatchObject({ step: 3, completed: true })
    })

    it('does not advance beyond 3', () => {
      setOnboardingState({ step: 3, completed: true, firstListingCompleted: false, firstBidCompleted: false })
      expect(advanceOnboardingStep()).toMatchObject({ step: 3, completed: true })
    })

    it('preserves tutorial flags when advancing', () => {
      setOnboardingState({ step: 1, completed: false, firstListingCompleted: true, firstBidCompleted: false })
      expect(advanceOnboardingStep()).toMatchObject({ firstListingCompleted: true })
    })
  })

  describe('completeOnboarding', () => {
    it('marks onboarding as completed at step 3, preserving tutorial flags', () => {
      setOnboardingState({ step: 0, completed: false, firstListingCompleted: true, firstBidCompleted: true })
      completeOnboarding()
      expect(getOnboardingState()).toEqual({
        step: 3,
        completed: true,
        firstListingCompleted: true,
        firstBidCompleted: true,
      })
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

  describe('resetTutorials', () => {
    it('clears both tutorial flags without touching onboarding state', () => {
      setOnboardingState({ step: 3, completed: true, firstListingCompleted: true, firstBidCompleted: true })
      resetTutorials()
      expect(getOnboardingState()).toEqual({
        step: 3,
        completed: true,
        firstListingCompleted: false,
        firstBidCompleted: false,
      })
    })
  })

  describe('resetOnboarding', () => {
    it('removes state from localStorage', () => {
      setOnboardingState({ step: 2, completed: false, firstListingCompleted: false, firstBidCompleted: false })
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
      expect(() => setOnboardingState({ step: 1, completed: false, firstListingCompleted: false, firstBidCompleted: false })).not.toThrow()
    })

    it('resetOnboarding silently swallows errors', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('SecurityError')
      })
      expect(() => resetOnboarding()).not.toThrow()
    })
  })
})
