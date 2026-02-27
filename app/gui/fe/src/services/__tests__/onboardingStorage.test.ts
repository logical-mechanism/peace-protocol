import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getOnboardingState,
  setOnboardingState,
  advanceOnboardingStep,
  completeOnboarding,
  resetOnboarding,
} from '../onboardingStorage'

describe('onboardingStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('getOnboardingState', () => {
    it('returns default state when nothing stored', () => {
      const state = getOnboardingState()
      expect(state).toEqual({ step: 0, completed: false })
    })

    it('returns stored state', () => {
      localStorage.setItem('veiled_onboarding', JSON.stringify({ step: 2, completed: false }))
      const state = getOnboardingState()
      expect(state).toEqual({ step: 2, completed: false })
    })

    it('returns default for malformed JSON', () => {
      localStorage.setItem('veiled_onboarding', 'not-json')
      expect(getOnboardingState()).toEqual({ step: 0, completed: false })
    })

    it('returns default for missing fields', () => {
      localStorage.setItem('veiled_onboarding', JSON.stringify({ step: 1 }))
      expect(getOnboardingState()).toEqual({ step: 0, completed: false })
    })
  })

  describe('setOnboardingState', () => {
    it('persists state to localStorage', () => {
      setOnboardingState({ step: 1, completed: false })
      const raw = localStorage.getItem('veiled_onboarding')
      expect(JSON.parse(raw!)).toEqual({ step: 1, completed: false })
    })
  })

  describe('advanceOnboardingStep', () => {
    it('advances from 0 to 1', () => {
      const result = advanceOnboardingStep()
      expect(result).toEqual({ step: 1, completed: false })
    })

    it('advances from 2 to 3 and marks completed', () => {
      setOnboardingState({ step: 2, completed: false })
      const result = advanceOnboardingStep()
      expect(result).toEqual({ step: 3, completed: true })
    })

    it('does not advance beyond 3', () => {
      setOnboardingState({ step: 3, completed: true })
      const result = advanceOnboardingStep()
      expect(result).toEqual({ step: 3, completed: true })
    })

    it('persists the new state', () => {
      advanceOnboardingStep()
      expect(getOnboardingState()).toEqual({ step: 1, completed: false })
    })
  })

  describe('completeOnboarding', () => {
    it('marks onboarding as completed at step 3', () => {
      completeOnboarding()
      expect(getOnboardingState()).toEqual({ step: 3, completed: true })
    })
  })

  describe('resetOnboarding', () => {
    it('removes state from localStorage', () => {
      setOnboardingState({ step: 2, completed: false })
      resetOnboarding()
      expect(getOnboardingState()).toEqual({ step: 0, completed: false })
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
      expect(getOnboardingState()).toEqual({ step: 0, completed: false })
    })

    it('setOnboardingState silently swallows quota exceeded error', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError')
      })
      expect(() => setOnboardingState({ step: 1, completed: false })).not.toThrow()
    })

    it('resetOnboarding silently swallows errors', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('SecurityError')
      })
      expect(() => resetOnboarding()).not.toThrow()
    })
  })
})
