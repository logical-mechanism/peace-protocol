import { useState, useCallback, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import {
  getOnboardingState,
  advanceOnboardingStep,
  completeOnboarding,
  type OnboardingStep,
} from '../services/onboardingStorage'

interface TourStep {
  route: string
  title: string
  description: string
}

const TOUR_STEPS: TourStep[] = [
  {
    route: '/wallet-setup',
    title: 'Create Your Wallet',
    description:
      'Welcome to Veiled! Start by creating a new wallet or importing an existing one. Your wallet secures your identity on the marketplace.',
  },
  {
    route: '/node-sync',
    title: 'Sync With the Blockchain',
    description:
      'Your node will download and sync with the Cardano blockchain. This is a one-time setup that takes 10-20 minutes. You can continue in the background.',
  },
  {
    route: '/dashboard',
    title: 'Browse the Marketplace',
    description:
      'The Marketplace tab shows all available encrypted data listings. Browse categories, check prices, and find data you want to purchase.',
  },
  {
    route: '/dashboard',
    title: 'Place Your First Bid',
    description:
      'Found something interesting? Click on a listing to see details, then place a bid with your desired price. The seller can accept your bid to complete the exchange.',
  },
]

export default function OnboardingOverlay() {
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
    setState({ step: 3, completed: true })
  }, [])

  if (!visible || !step) return null

  const stepNumber = state.step as OnboardingStep
  const isLast = stepNumber === 3

  return (
    <div
      className="fixed bottom-6 right-6 z-[100] max-w-sm"
      style={{
        animation: 'onboarding-slide-up 0.3s ease-out',
      }}
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
        <div className="flex items-center gap-1.5 mb-3">
          {TOUR_STEPS.map((_, i) => (
            <div
              key={i}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: i === stepNumber ? '1.5rem' : '0.375rem',
                background: i === stepNumber
                  ? 'var(--accent)'
                  : i < stepNumber
                    ? 'var(--success)'
                    : 'var(--bg-secondary)',
              }}
            />
          ))}
          <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
            {stepNumber + 1} / {TOUR_STEPS.length}
          </span>
        </div>

        <h3
          className="text-sm font-semibold mb-1.5"
          style={{ color: 'var(--text-primary)' }}
        >
          {step.title}
        </h3>
        <p className="text-xs mb-4 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {step.description}
        </p>

        <div className="flex items-center justify-between">
          <button
            onClick={handleSkip}
            className="text-xs cursor-pointer px-2 py-1 rounded"
            style={{ color: 'var(--text-muted)' }}
          >
            Skip tour
          </button>
          <button
            onClick={handleNext}
            className="px-4 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
            style={{
              background: 'var(--accent)',
              color: '#fff',
            }}
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
