import { useState, useCallback, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  getOnboardingState,
  advanceOnboardingStep,
  completeOnboarding,
  type OnboardingStep,
} from '../services/onboardingStorage'

interface TourStep {
  route: string
  titleKey: string
  descriptionKey: string
}

const TOUR_STEPS: TourStep[] = [
  {
    route: '/wallet-setup',
    titleKey: 'steps.walletSetup.title',
    descriptionKey: 'steps.walletSetup.description',
  },
  {
    route: '/node-sync',
    titleKey: 'steps.nodeSync.title',
    descriptionKey: 'steps.nodeSync.description',
  },
  {
    route: '/dashboard',
    titleKey: 'steps.marketplace.title',
    descriptionKey: 'steps.marketplace.description',
  },
  {
    route: '/dashboard',
    titleKey: 'steps.firstBid.title',
    descriptionKey: 'steps.firstBid.description',
  },
]

export default function OnboardingOverlay() {
  const { t } = useTranslation('onboarding')
  const location = useLocation()
  const [state, setState] = useState(getOnboardingState)

  const step = TOUR_STEPS[state.step]
  const visible = useMemo(() => {
    if (state.completed || !step) return false
    return location.pathname === step.route
  }, [state.completed, step, location.pathname])

  const handleNext = useCallback(() => {
    const newState = advanceOnboardingStep()
    setState(newState)
  }, [])

  const handleSkip = useCallback(() => {
    completeOnboarding()
    setState((prev) => ({ ...prev, step: 3, completed: true }))
  }, [])

  if (!visible || !step) return null

  const stepNumber = state.step as OnboardingStep
  const isLast = stepNumber === 3
  const total = TOUR_STEPS.length

  return (
    <div
      className="fixed bottom-6 right-6 z-[100] max-w-sm"
      style={{
        animation: 'onboarding-slide-up 0.3s ease-out',
      }}
      role="dialog"
      aria-label={t('tourLabel')}
      aria-labelledby="onboarding-step-title"
    >
      <div
        className="rounded-xl p-5 shadow-lg"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-default)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Step indicator dots */}
        <div
          className="flex items-center gap-1.5 mb-3"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={stepNumber + 1}
          aria-label={t('stepProgress', { current: stepNumber + 1, total })}
        >
          {TOUR_STEPS.map((_, i) => (
            <div
              key={i}
              className="h-1.5 rounded-full transition-all duration-[var(--transition-base)] ease-out"
              style={{
                width: i === stepNumber ? '1.5rem' : '0.375rem',
                background: i === stepNumber
                  ? 'var(--accent)'
                  : i < stepNumber
                    ? 'var(--success)'
                    : 'var(--bg-secondary)',
              }}
              aria-hidden="true"
            />
          ))}
          <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('stepCounter', { current: stepNumber + 1, total })}
          </span>
        </div>

        <h3
          id="onboarding-step-title"
          className="t-display text-base mb-1.5"
          style={{ color: 'var(--text-primary)' }}
        >
          {t(step.titleKey)}
        </h3>
        <p className="text-xs mb-4 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {t(step.descriptionKey)}
        </p>

        <div className="flex items-center justify-between">
          <button
            onClick={handleSkip}
            aria-label={t('skipAria')}
            className="text-xs cursor-pointer px-2 py-1 rounded-[var(--radius-sm)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors duration-[var(--transition-fast)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2"
            style={{ color: 'var(--text-muted)' }}
          >
            {t('skip')}
          </button>
          <button
            onClick={handleNext}
            aria-label={isLast ? t('finishAria') : t('nextAria', { current: stepNumber + 2, total })}
            className="px-4 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
            style={{
              background: 'var(--accent)',
              color: '#fff',
            }}
          >
            {isLast ? t('done') : t('next')}
          </button>
        </div>
      </div>
    </div>
  )
}
