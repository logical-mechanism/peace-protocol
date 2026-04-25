import type { TutorialStep } from '../hooks/useTutorial'
import type { QueueItemStatus } from '../services/acceptBidQueueService'

/**
 * 4-step event-driven walkthrough for accepting a first bid (seller side).
 *
 * Unlike the listing/bid tours, progression here is NOT user-driven — the
 * tutorial hook advances through steps as the `AcceptBidQueueService` state
 * machine transitions. Step 1 targets the Accept button in `BidsModal`;
 * steps 2–4 target the `AcceptBidQueuePanel` current-item row as it moves
 * through preparing/proving → submitting → complete.
 */
export const FIRST_BID_ACCEPTED_TUTORIAL_STEPS: TutorialStep[] = [
  {
    targetSelector: '#tutorial-bid-accept-button',
    title: 'tutorial.firstBidAccepted.step1Title',
    description: 'tutorial.firstBidAccepted.step1Desc',
    placement: 'left',
  },
  {
    targetSelector: '#tutorial-queue-current-item',
    title: 'tutorial.firstBidAccepted.step2Title',
    description: 'tutorial.firstBidAccepted.step2Desc',
    placement: 'bottom',
  },
  {
    targetSelector: '#tutorial-queue-current-item',
    title: 'tutorial.firstBidAccepted.step3Title',
    description: 'tutorial.firstBidAccepted.step3Desc',
    placement: 'bottom',
  },
  {
    targetSelector: '#tutorial-queue-panel',
    title: 'tutorial.firstBidAccepted.step4Title',
    description: 'tutorial.firstBidAccepted.step4Desc',
    placement: 'bottom',
  },
]

/**
 * Map an accept-bid queue state to the matching tour step index (0-based).
 *
 * `null` means "no transition" — the tour should stay at whatever step it's
 * currently on. Called by Dashboard whenever queue state or completedCount
 * changes; a null return keeps step 1 (the Accept-button anchor) visible
 * before any queue activity starts.
 */
export function queueStateToTourStep(params: {
  currentItemStatus: QueueItemStatus | undefined
  didJustComplete: boolean
}): number | null {
  if (params.didJustComplete) return 3
  switch (params.currentItemStatus) {
    case 'submitting':
      return 2
    case 'preparing':
    case 'proving':
      return 1
    default:
      return null
  }
}

