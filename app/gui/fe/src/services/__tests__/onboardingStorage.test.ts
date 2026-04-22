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
  resetTutorials,
  resetTutorialFlag,
} from '../onboardingStorage'

const DEFAULT = {
  step: 0,
  completed: false,
  firstListingCompleted: false,
  firstBidCompleted: false,
  firstDecryptCompleted: false,
  firstBidAcceptedCompleted: false,
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
        firstDecryptCompleted: false,
        firstBidAcceptedCompleted: false,
      }))
      expect(getOnboardingState()).toEqual({
        step: 2,
        completed: false,
        firstListingCompleted: true,
        firstBidCompleted: false,
        firstDecryptCompleted: false,
        firstBidAcceptedCompleted: false,
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
        firstDecryptCompleted: false,
        firstBidAcceptedCompleted: false,
      })
    })

    it('migrates entries that have only firstListing/firstBid flags', () => {
      localStorage.setItem('veiled_onboarding', JSON.stringify({
        step: 3,
        completed: true,
        firstListingCompleted: true,
        firstBidCompleted: true,
      }))
      expect(getOnboardingState()).toEqual({
        step: 3,
        completed: true,
        firstListingCompleted: true,
        firstBidCompleted: true,
        firstDecryptCompleted: false,
        firstBidAcceptedCompleted: false,
      })
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
  })

  describe('setOnboardingState', () => {
    it('persists state to localStorage', () => {
      setOnboardingState({
        step: 1,
        completed: false,
        firstListingCompleted: false,
        firstBidCompleted: false,
        firstDecryptCompleted: false,
        firstBidAcceptedCompleted: false,
      })
      const raw = localStorage.getItem('veiled_onboarding')
      expect(JSON.parse(raw!)).toEqual({
        step: 1,
        completed: false,
        firstListingCompleted: false,
        firstBidCompleted: false,
        firstDecryptCompleted: false,
        firstBidAcceptedCompleted: false,
      })
    })
  })

  describe('advanceOnboardingStep', () => {
    it('advances from 0 to 1', () => {
      expect(advanceOnboardingStep()).toMatchObject({ step: 1, completed: false })
    })

    it('advances from 2 to 3 and marks completed', () => {
      setOnboardingState({
        step: 2, completed: false,
        firstListingCompleted: false, firstBidCompleted: false,
        firstDecryptCompleted: false, firstBidAcceptedCompleted: false,
      })
      expect(advanceOnboardingStep()).toMatchObject({ step: 3, completed: true })
    })

    it('does not advance beyond 3', () => {
      setOnboardingState({
        step: 3, completed: true,
        firstListingCompleted: false, firstBidCompleted: false,
        firstDecryptCompleted: false, firstBidAcceptedCompleted: false,
      })
      expect(advanceOnboardingStep()).toMatchObject({ step: 3, completed: true })
    })

    it('preserves tutorial flags when advancing', () => {
      setOnboardingState({
        step: 1, completed: false,
        firstListingCompleted: true, firstBidCompleted: false,
        firstDecryptCompleted: true, firstBidAcceptedCompleted: true,
      })
      expect(advanceOnboardingStep()).toMatchObject({
        firstListingCompleted: true,
        firstDecryptCompleted: true,
        firstBidAcceptedCompleted: true,
      })
    })
  })

  describe('completeOnboarding', () => {
    it('marks onboarding as completed at step 3, preserving tutorial flags', () => {
      setOnboardingState({
        step: 0, completed: false,
        firstListingCompleted: true, firstBidCompleted: true,
        firstDecryptCompleted: true, firstBidAcceptedCompleted: true,
      })
      completeOnboarding()
      expect(getOnboardingState()).toEqual({
        step: 3,
        completed: true,
        firstListingCompleted: true,
        firstBidCompleted: true,
        firstDecryptCompleted: true,
        firstBidAcceptedCompleted: true,
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
      setOnboardingState({
        step: 3, completed: true,
        firstListingCompleted: true, firstBidCompleted: true,
        firstDecryptCompleted: false, firstBidAcceptedCompleted: true,
      })
      markFirstDecryptCompleted()
      expect(getOnboardingState()).toEqual({
        step: 3,
        completed: true,
        firstListingCompleted: true,
        firstBidCompleted: true,
        firstDecryptCompleted: true,
        firstBidAcceptedCompleted: true,
      })
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
      setOnboardingState({
        step: 3, completed: true,
        firstListingCompleted: true, firstBidCompleted: true,
        firstDecryptCompleted: true, firstBidAcceptedCompleted: false,
      })
      markFirstBidAcceptedCompleted()
      expect(getOnboardingState()).toEqual({
        step: 3, completed: true,
        firstListingCompleted: true, firstBidCompleted: true,
        firstDecryptCompleted: true, firstBidAcceptedCompleted: true,
      })
    })
  })

  describe('resetTutorials', () => {
    it('clears all tutorial flags without touching onboarding state', () => {
      setOnboardingState({
        step: 3, completed: true,
        firstListingCompleted: true, firstBidCompleted: true,
        firstDecryptCompleted: true, firstBidAcceptedCompleted: true,
      })
      resetTutorials()
      expect(getOnboardingState()).toEqual({
        step: 3,
        completed: true,
        firstListingCompleted: false,
        firstBidCompleted: false,
        firstDecryptCompleted: false,
        firstBidAcceptedCompleted: false,
      })
    })
  })

  describe('resetTutorialFlag', () => {
    it('resets only firstBidCompleted without touching others', () => {
      setOnboardingState({
        step: 3, completed: true,
        firstListingCompleted: true, firstBidCompleted: true,
        firstDecryptCompleted: true, firstBidAcceptedCompleted: true,
      })
      resetTutorialFlag('firstBidCompleted')
      expect(getOnboardingState()).toEqual({
        step: 3,
        completed: true,
        firstListingCompleted: true,
        firstBidCompleted: false,
        firstDecryptCompleted: true,
        firstBidAcceptedCompleted: true,
      })
    })

    it('resets only firstListingCompleted without touching others', () => {
      setOnboardingState({
        step: 3, completed: true,
        firstListingCompleted: true, firstBidCompleted: true,
        firstDecryptCompleted: true, firstBidAcceptedCompleted: true,
      })
      resetTutorialFlag('firstListingCompleted')
      expect(getOnboardingState()).toEqual({
        step: 3,
        completed: true,
        firstListingCompleted: false,
        firstBidCompleted: true,
        firstDecryptCompleted: true,
        firstBidAcceptedCompleted: true,
      })
    })

    it('resets only firstDecryptCompleted without touching others', () => {
      setOnboardingState({
        step: 3, completed: true,
        firstListingCompleted: true, firstBidCompleted: true,
        firstDecryptCompleted: true, firstBidAcceptedCompleted: true,
      })
      resetTutorialFlag('firstDecryptCompleted')
      expect(getOnboardingState()).toEqual({
        step: 3,
        completed: true,
        firstListingCompleted: true,
        firstBidCompleted: true,
        firstDecryptCompleted: false,
        firstBidAcceptedCompleted: true,
      })
    })

    it('resets only firstBidAcceptedCompleted without touching others', () => {
      setOnboardingState({
        step: 3, completed: true,
        firstListingCompleted: true, firstBidCompleted: true,
        firstDecryptCompleted: true, firstBidAcceptedCompleted: true,
      })
      resetTutorialFlag('firstBidAcceptedCompleted')
      expect(getOnboardingState()).toEqual({
        step: 3,
        completed: true,
        firstListingCompleted: true,
        firstBidCompleted: true,
        firstDecryptCompleted: true,
        firstBidAcceptedCompleted: false,
      })
    })
  })

  describe('resetOnboarding', () => {
    it('removes state from localStorage', () => {
      setOnboardingState({
        step: 2, completed: false,
        firstListingCompleted: false, firstBidCompleted: false,
        firstDecryptCompleted: false, firstBidAcceptedCompleted: false,
      })
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
      expect(() => setOnboardingState({
        step: 1, completed: false,
        firstListingCompleted: false, firstBidCompleted: false,
        firstDecryptCompleted: false, firstBidAcceptedCompleted: false,
      })).not.toThrow()
    })

    it('resetOnboarding silently swallows errors', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('SecurityError')
      })
      expect(() => resetOnboarding()).not.toThrow()
    })
  })
})
