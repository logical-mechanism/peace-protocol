import { useTranslation } from 'react-i18next'
import '../../i18n'
import { useAcceptBidQueue } from '../../contexts/AcceptBidQueueContext'
import InfoTooltip from '../../components/InfoTooltip'

export default function AutomationSection() {
  const { t } = useTranslation('settings')
  const { autoAcceptEnabled, setAutoAccept, queuedCount, completedCount, failedCount, isProcessing } = useAcceptBidQueue()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{t('automation.title')}</h2>
        <p className="text-sm text-[var(--text-muted)]">{t('automation.description')}</p>
      </div>

      {/* Auto-accept toggle */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">{t('automation.autoAcceptLabel')}</span>
            <InfoTooltip text={t('automation.autoAcceptTooltip')} />
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={autoAcceptEnabled}
              onChange={e => setAutoAccept(e.target.checked)}
              className="sr-only"
            />
            <div className={`w-11 h-6 rounded-full transition-colors duration-200 ${autoAcceptEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-tertiary)]'}`}>
              <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${autoAcceptEnabled ? 'translate-x-5' : ''}`} />
            </div>
          </label>
        </div>

        <p className="text-xs text-[var(--text-muted)]">
          {t('automation.autoAcceptExplainer')}
        </p>

        {/* Queue status summary */}
        <div className="flex gap-4 pt-2 border-t border-[var(--border-subtle)]">
          <div>
            <span className="text-xs text-[var(--text-muted)]">{t('automation.status')}</span>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {isProcessing ? t('automation.processing') : t('automation.idle')}
            </p>
          </div>
          <div>
            <span className="text-xs text-[var(--text-muted)]">{t('automation.queued')}</span>
            <p className="text-sm font-medium text-[var(--text-primary)]">{queuedCount}</p>
          </div>
          <div>
            <span className="text-xs text-[var(--text-muted)]">{t('automation.completed')}</span>
            <p className="text-sm font-medium text-[var(--success)]">{completedCount}</p>
          </div>
          {failedCount > 0 && (
            <div>
              <span className="text-xs text-[var(--text-muted)]">{t('automation.failed')}</span>
              <p className="text-sm font-medium text-[var(--error)]">{failedCount}</p>
            </div>
          )}
        </div>
      </div>

      {/* How it works */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4">
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">{t('automation.howItWorksTitle')}</h3>
        <ul className="text-xs text-[var(--text-muted)] space-y-1.5">
          <li>{t('automation.howItWorks1')}</li>
          <li>{t('automation.howItWorks2')}</li>
          <li>{t('automation.howItWorks3')}</li>
          <li>{t('automation.howItWorks4')}</li>
          <li>{t('automation.howItWorks5')}</li>
        </ul>
        <p className="text-xs text-[var(--text-muted)] mt-3">
          {t('automation.viewQueueBefore')}<strong>{t('automation.viewQueueStrong')}</strong>{t('automation.viewQueueAfter')}
        </p>
      </div>
    </div>
  )
}
