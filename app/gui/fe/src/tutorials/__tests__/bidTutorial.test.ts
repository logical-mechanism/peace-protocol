import { describe, it, expect } from 'vitest'
import { BID_TUTORIAL_STEPS } from '../bidTutorial'

describe('BID_TUTORIAL_STEPS', () => {
  it('defines exactly 4 steps', () => {
    expect(BID_TUTORIAL_STEPS).toHaveLength(4)
  })

  it('every step has required fields', () => {
    for (const step of BID_TUTORIAL_STEPS) {
      expect(step.targetSelector).toBeTruthy()
      expect(step.title).toBeTruthy()
      expect(step.description).toBeTruthy()
      expect(step.placement).toBeTruthy()
    }
  })

  it('step 1 targets the place bid button', () => {
    expect(BID_TUTORIAL_STEPS[0].targetSelector).toBe('#tutorial-place-bid')
  })

  it('all selectors are id-based for stability', () => {
    for (const step of BID_TUTORIAL_STEPS) {
      expect(step.targetSelector).toMatch(/^#tutorial-/)
    }
  })
})
