import type { TutorialStep } from '../hooks/useTutorial'

/**
 * 4-step guided walkthrough for a buyer's first decrypt after winning a bid.
 *
 * Step 1 highlights the Decrypt button on MyPurchaseBidCard (in MyPurchasesTab).
 * Step 2 targets the DecryptModal header to explain the SNARK verification.
 * Step 3 highlights the Library tab after the content lands.
 * Step 4 points at the action row (playback / export) in LibraryContentModal.
 *
 * The flow spans multiple screens, so the caller is responsible for switching
 * tabs / opening modals between steps — this file only declares the anchors.
 */
export const DECRYPT_TUTORIAL_STEPS: TutorialStep[] = [
  {
    targetSelector: '[data-tutorial="decrypt-button"]',
    title: 'tutorial.decrypt.step1Title',
    description: 'tutorial.decrypt.step1Desc',
    placement: 'top',
  },
  {
    targetSelector: '#tutorial-decrypt-modal-header',
    title: 'tutorial.decrypt.step2Title',
    description: 'tutorial.decrypt.step2Desc',
    placement: 'bottom',
  },
  {
    targetSelector: '#tab-library',
    title: 'tutorial.decrypt.step3Title',
    description: 'tutorial.decrypt.step3Desc',
    placement: 'bottom',
  },
  {
    targetSelector: '[data-tutorial="library-content-actions"]',
    title: 'tutorial.decrypt.step4Title',
    description: 'tutorial.decrypt.step4Desc',
    placement: 'top',
  },
]
