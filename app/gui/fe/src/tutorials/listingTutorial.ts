import type { TutorialStep } from '../hooks/useTutorial'

/**
 * 5-step guided walkthrough for creating a first listing.
 *
 * Each step targets a stable `id` attribute on the relevant DOM element.
 * The overlay polls for the target so it tolerates elements that mount
 * after the step begins (e.g. modal fields appearing when the modal opens).
 */
export const LISTING_TUTORIAL_STEPS: TutorialStep[] = [
  {
    targetSelector: '#tutorial-create-listing',
    title: 'tutorial.listing.step1Title',
    description: 'tutorial.listing.step1Desc',
    placement: 'bottom',
  },
  {
    targetSelector: '#tutorial-data-type-toggle',
    title: 'tutorial.listing.step2Title',
    description: 'tutorial.listing.step2Desc',
    placement: 'bottom',
  },
  {
    targetSelector: '#tutorial-description-field',
    title: 'tutorial.listing.step3Title',
    description: 'tutorial.listing.step3Desc',
    placement: 'right',
  },
  {
    targetSelector: '#tutorial-price-field',
    title: 'tutorial.listing.step4Title',
    description: 'tutorial.listing.step4Desc',
    placement: 'right',
  },
  {
    targetSelector: '#tutorial-submit-listing',
    title: 'tutorial.listing.step5Title',
    description: 'tutorial.listing.step5Desc',
    placement: 'top',
  },
]
