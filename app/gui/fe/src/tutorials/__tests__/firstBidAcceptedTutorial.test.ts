import { describe, it, expect } from 'vitest'
import {
  FIRST_BID_ACCEPTED_TUTORIAL_STEPS,
  queueStateToTourStep,
} from '../firstBidAcceptedTutorial'

describe('FIRST_BID_ACCEPTED_TUTORIAL_STEPS', () => {
  it('defines exactly 4 steps', () => {
    expect(FIRST_BID_ACCEPTED_TUTORIAL_STEPS).toHaveLength(4)
  })

  it('every step has required fields', () => {
    for (const step of FIRST_BID_ACCEPTED_TUTORIAL_STEPS) {
      expect(step.targetSelector).toBeTruthy()
      expect(step.title).toBeTruthy()
      expect(step.description).toBeTruthy()
      expect(step.placement).toBeTruthy()
    }
  })

  it('step 1 targets the BidsModal Accept button', () => {
    expect(FIRST_BID_ACCEPTED_TUTORIAL_STEPS[0].targetSelector).toBe('#tutorial-bid-accept-button')
  })

  it('steps 2 and 3 target the queue current-item row for state transitions', () => {
    expect(FIRST_BID_ACCEPTED_TUTORIAL_STEPS[1].targetSelector).toBe('#tutorial-queue-current-item')
    expect(FIRST_BID_ACCEPTED_TUTORIAL_STEPS[2].targetSelector).toBe('#tutorial-queue-current-item')
  })

  it('step 4 targets the queue panel (current item row vanishes on complete)', () => {
    expect(FIRST_BID_ACCEPTED_TUTORIAL_STEPS[3].targetSelector).toBe('#tutorial-queue-panel')
  })

  it('all selectors are id-based for stability', () => {
    for (const step of FIRST_BID_ACCEPTED_TUTORIAL_STEPS) {
      expect(step.targetSelector).toMatch(/^#tutorial-/)
    }
  })
})

describe('queueStateToTourStep', () => {
  it('returns null when queue is idle (no currentItem, no completion)', () => {
    expect(queueStateToTourStep({ currentItemStatus: undefined, didJustComplete: false })).toBeNull()
    expect(queueStateToTourStep({ currentItemStatus: 'queued', didJustComplete: false })).toBeNull()
  })

  it('returns step 1 (index) for preparing/proving — the ~3 min SNARK window', () => {
    expect(queueStateToTourStep({ currentItemStatus: 'preparing', didJustComplete: false })).toBe(1)
    expect(queueStateToTourStep({ currentItemStatus: 'proving', didJustComplete: false })).toBe(1)
  })

  it('returns step 2 (index) for submitting — the chained re-encryption tx', () => {
    expect(queueStateToTourStep({ currentItemStatus: 'submitting', didJustComplete: false })).toBe(2)
  })

  it('returns step 3 (index) on completion regardless of currentItemStatus', () => {
    // currentItem clears to null/undefined on completion
    expect(queueStateToTourStep({ currentItemStatus: undefined, didJustComplete: true })).toBe(3)
    // Completion wins even if a new item is already processing (next queue run)
    expect(queueStateToTourStep({ currentItemStatus: 'preparing', didJustComplete: true })).toBe(3)
  })

  it('returns null for failed status (tour pauses instead of advancing)', () => {
    expect(queueStateToTourStep({ currentItemStatus: 'failed', didJustComplete: false })).toBeNull()
  })
})
