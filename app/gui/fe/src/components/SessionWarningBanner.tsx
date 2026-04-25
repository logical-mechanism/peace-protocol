import { useTranslation } from 'react-i18next'
import { useWalletContext } from '../contexts/WalletContext'

export default function SessionWarningBanner() {
  const { t } = useTranslation('notifications')
  const { sessionWarningSeconds, extendSession } = useWalletContext()

  if (sessionWarningSeconds === null || sessionWarningSeconds > 60) return null

  const minutes = Math.floor(sessionWarningSeconds / 60)
  const seconds = sessionWarningSeconds % 60
  const timeDisplay =
    minutes > 0
      ? `${minutes}:${seconds.toString().padStart(2, '0')}`
      : `${seconds}s`

  // Progress bar drains from 100% to 0% over 60 seconds
  const progressPercent = Math.min((sessionWarningSeconds / 60) * 100, 100)

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[80]"
      role="alert"
      aria-live="polite"
    >
      {/* Draining progress bar */}
      <div className="h-0.5" style={{ background: 'rgba(0, 0, 0, 0.15)' }}>
        <div
          className="h-full transition-all duration-1000 ease-linear"
          style={{
            width: `${progressPercent}%`,
            background: 'var(--bg-primary)',
          }}
        />
      </div>
      <div
        className="flex items-center justify-center gap-4 px-4 py-2 text-sm"
        style={{
          background: 'var(--warning)',
          borderBottom: '1px solid var(--bg-primary)',
          color: 'var(--bg-primary)',
        }}
      >
        <span>{t('banner.sessionWarning', { time: timeDisplay })}</span>
        <button
          onClick={extendSession}
          className="px-3 py-1 text-xs font-medium rounded cursor-pointer"
          style={{
            background: 'var(--bg-primary)',
            color: 'var(--warning)',
          }}
          aria-label={t('banner.extendSessionAria')}
        >
          {t('banner.stayActive')}
        </button>
      </div>
    </div>
  )
}
