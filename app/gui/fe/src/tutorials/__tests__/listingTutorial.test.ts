import { describe, it, expect } from 'vitest'
import { LISTING_TUTORIAL_STEPS } from '../listingTutorial'

describe('LISTING_TUTORIAL_STEPS', () => {
  it('defines exactly 5 steps', () => {
    expect(LISTING_TUTORIAL_STEPS).toHaveLength(5)
  })

  it('every step has required fields', () => {
    for (const step of LISTING_TUTORIAL_STEPS) {
      expect(step.targetSelector).toBeTruthy()
      expect(step.title).toBeTruthy()
      expect(step.description).toBeTruthy()
      expect(step.placement).toBeTruthy()
    }
  })

  it('step 1 targets the create listing button', () => {
    expect(LISTING_TUTORIAL_STEPS[0].targetSelector).toBe('#tutorial-create-listing')
  })

  it('all selectors are id-based for stability', () => {
    for (const step of LISTING_TUTORIAL_STEPS) {
      expect(step.targetSelector).toMatch(/^#tutorial-/)
    }
  })
})
