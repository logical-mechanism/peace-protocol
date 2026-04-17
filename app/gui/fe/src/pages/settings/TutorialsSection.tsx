import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { getOnboardingState, resetTutorials } from '../../services/onboardingStorage'

interface TutorialFlow {
  id: string
  titleKey: string
  descriptionKey: string
  completedFlag: keyof Pick<ReturnType<typeof getOnboardingState>, 'firstListingCompleted' | 'firstBidCompleted'>
  navigateTo?: { path: string; state?: Record<string, unknown> }
}

const TUTORIAL_FLOWS: TutorialFlow[] = [
  {
    id: 'first-listing',
    titleKey: 'tutorials.flows.firstListing.title',
    descriptionKey: 'tutorials.flows.firstListing.description',
    completedFlag: 'firstListingCompleted',
    navigateTo: { path: '/dashboard', state: { tab: 'marketplace', startTutorial: 'first-listing' } },
  },
  {
    id: 'first-bid',
    titleKey: 'tutorials.flows.firstBid.title',
    descriptionKey: 'tutorials.flows.firstBid.description',
    completedFlag: 'firstBidCompleted',
    navigateTo: { path: '/dashboard', state: { tab: 'marketplace' } },
  },
  {
    id: 'first-decrypt',
    titleKey: 'tutorials.flows.firstDecrypt.title',
    descriptionKey: 'tutorials.flows.firstDecrypt.description',
    completedFlag: 'firstListingCompleted', // placeholder — not yet tracked
  },
  {
    id: 'first-bid-accepted',
    titleKey: 'tutorials.flows.firstBidAccepted.title',
    descriptionKey: 'tutorials.flows.firstBidAccepted.description',
    completedFlag: 'firstListingCompleted', // placeholder — not yet tracked
  },
  {
    id: 'iagon-primer',
    titleKey: 'tutorials.flows.iagonPrimer.title',
    descriptionKey: 'tutorials.flows.iagonPrimer.description',
    completedFlag: 'firstListingCompleted', // placeholder — not yet tracked
  },
]

const SHORTCUTS: { keys: string; descriptionKey: string }[] = [
  { keys: 'Ctrl + 1\u20135', descriptionKey: 'overlay.shortcuts.tabSwitch' },
  { keys: 'Ctrl + R', descriptionKey: 'overlay.shortcuts.refresh' },
  { keys: 'Ctrl + K', descriptionKey: 'overlay.shortcuts.commandPalette' },
  { keys: '\u2190 \u2192', descriptionKey: 'overlay.shortcuts.tabNavigate' },
  { keys: 'Home / End', descriptionKey: 'overlay.shortcuts.tabFirstLast' },
  { keys: 'Esc', descriptionKey: 'overlay.shortcuts.closeModal' },
  { keys: '?', descriptionKey: 'overlay.shortcuts.toggleHelp' },
]

export default function TutorialsSection() {
  const { t } = useTranslation('settings')
  const { t: tCommon } = useTranslation('common')
  const navigate = useNavigate()

  const [onboardingState, setOnboardingState] = useState(() => getOnboardingState())
  const [allReset, setAllReset] = useState(false)

  const handleResetAll = useCallback(() => {
    resetTutorials()
    setOnboardingState(getOnboardingState())
    setAllReset(true)
  }, [])

  const handleStartFlow = useCallback((flow: TutorialFlow) => {
    // Reset tutorials so the tour re-triggers on arrival
    resetTutorials()
    setOnboardingState(getOnboardingState())
    if (flow.navigateTo) {
      navigate(flow.navigateTo.path, { state: flow.navigateTo.state })
    }
  }, [navigate])

  const isFlowCompleted = useCallback((flow: TutorialFlow): boolean => {
    return onboardingState[flow.completedFlag]
  }, [onboardingState])

  return (
    <div className="space-y-6">
      {/* Tutorial Flows */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-medium">{t('tutorials.title')}</h2>
            <p className="text-sm text-[var(--text-muted)]">
              {t('tutorials.description')}
            </p>
          </div>
          <button
            onClick={handleResetAll}
            disabled={allReset}
            className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] btn-base btn-tertiary disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {allReset ? t('tutorials.resetAllDone') : t('tutorials.resetAll')}
          </button>
        </div>

        <div className="space-y-3">
          {TUTORIAL_FLOWS.map((flow) => {
            const completed = isFlowCompleted(flow)
            const hasNavigation = !!flow.navigateTo
            return (
              <div
                key={flow.id}
                className="flex items-center justify-between py-3 border-t border-[var(--border-subtle)] first:border-t-0 first:pt-0"
              >
                <div className="min-w-0 mr-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {t(flow.titleKey)}
                    </span>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full ${
                        completed
                          ? 'bg-[var(--success)]/15 text-[var(--success)]'
                          : 'bg-[var(--bg-secondary)] text-[var(--text-muted)]'
                      }`}
                    >
                      {completed ? t('tutorials.statusCompleted') : t('tutorials.statusNotStarted')}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    {t(flow.descriptionKey)}
                  </p>
                </div>
                {hasNavigation ? (
                  <button
                    onClick={() => handleStartFlow(flow)}
                    className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] btn-base btn-tertiary whitespace-nowrap flex-shrink-0"
                  >
                    {completed ? t('tutorials.replay') : t('tutorials.start')}
                  </button>
                ) : (
                  <span className="text-xs text-[var(--text-muted)] italic whitespace-nowrap flex-shrink-0">
                    {t('tutorials.comingSoon')}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Keyboard Shortcuts */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
        <h2 className="text-lg font-medium mb-4">{t('tutorials.shortcutsTitle')}</h2>
        <table className="w-full">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys} className="border-b border-[var(--border-subtle)] last:border-0">
                <td className="py-2.5 pr-4">
                  <kbd className="px-2 py-1 text-xs font-mono bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] text-[var(--text-primary)]">
                    {s.keys}
                  </kbd>
                </td>
                <td className="py-2.5 text-sm text-[var(--text-secondary)]">
                  {tCommon(s.descriptionKey)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
