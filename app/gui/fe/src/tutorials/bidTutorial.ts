import type { TutorialStep } from '../hooks/useTutorial'

/**
 * 4-step guided walkthrough for placing a first bid.
 *
 * Step 1 targets the "Place Bid" button on a marketplace card (modal closed).
 * Steps 2-4 target fields inside PlaceBidModal; Dashboard auto-opens the modal
 * for these steps so the user doesn't have to click the button themselves.
 */
export const BID_TUTORIAL_STEPS: TutorialStep[] = [
  {
    targetSelector: '#tutorial-place-bid',
    title: 'tutorial.bid.step1Title',
    description: 'tutorial.bid.step1Desc',
    placement: 'top',
  },
  {
    targetSelector: '#tutorial-bid-amount',
    title: 'tutorial.bid.step2Title',
    description: 'tutorial.bid.step2Desc',
    placement: 'right',
  },
  {
    targetSelector: '#tutorial-future-price',
    title: 'tutorial.bid.step3Title',
    description: 'tutorial.bid.step3Desc',
    placement: 'right',
  },
  {
    targetSelector: '#tutorial-submit-bid',
    title: 'tutorial.bid.step4Title',
    description: 'tutorial.bid.step4Desc',
    placement: 'top',
  },
]
