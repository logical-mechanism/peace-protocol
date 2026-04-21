import { describe, it, expect } from 'vitest'
import { DECRYPT_TUTORIAL_STEPS } from '../decryptTutorial'

describe('DECRYPT_TUTORIAL_STEPS', () => {
  it('defines exactly 4 steps', () => {
    expect(DECRYPT_TUTORIAL_STEPS).toHaveLength(4)
  })

  it('every step has required fields', () => {
    for (const step of DECRYPT_TUTORIAL_STEPS) {
      expect(step.targetSelector).toBeTruthy()
      expect(step.title).toBeTruthy()
      expect(step.description).toBeTruthy()
      expect(step.placement).toBeTruthy()
    }
  })

  it('step 1 targets the decrypt button on MyPurchaseBidCard', () => {
    expect(DECRYPT_TUTORIAL_STEPS[0].targetSelector).toBe('[data-tutorial="decrypt-button"]')
  })

  it('step 2 targets the DecryptModal header', () => {
    expect(DECRYPT_TUTORIAL_STEPS[1].targetSelector).toBe('#tutorial-decrypt-modal-header')
  })

  it('step 3 targets the Library tab', () => {
    expect(DECRYPT_TUTORIAL_STEPS[2].targetSelector).toBe('#tab-library')
  })

  it('step 4 targets the LibraryContentModal action row', () => {
    expect(DECRYPT_TUTORIAL_STEPS[3].targetSelector).toBe('[data-tutorial="library-content-actions"]')
  })

  it('titles and descriptions reference i18n keys under tutorial.decrypt', () => {
    for (const step of DECRYPT_TUTORIAL_STEPS) {
      expect(step.title).toMatch(/^tutorial\.decrypt\./)
      expect(step.description).toMatch(/^tutorial\.decrypt\./)
    }
  })
})
