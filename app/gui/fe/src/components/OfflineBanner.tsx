import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export default function OfflineBanner() {
  const { t } = useTranslation('notifications')
  const [isOffline, setIsOffline] = useState(!navigator.onLine)

  useEffect(() => {
    const goOffline = () => setIsOffline(true)
    const goOnline = () => setIsOffline(false)

    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)

    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  if (!isOffline) return null

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[80]"
      role="alert"
      aria-live="assertive"
    >
      <div
        className="flex items-center justify-center gap-3 px-4 py-2 text-sm"
        style={{
          background: 'var(--error-muted)',
          borderBottom: '1px solid var(--error)',
          color: 'var(--error)',
        }}
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M18.364 5.636a9 9 0 010 12.728M5.636 18.364a9 9 0 010-12.728M8.464 15.536a5 5 0 010-7.072M15.536 8.464a5 5 0 010 7.072M12 12h.01"
          />
        </svg>
        <span>{t('banner.offline')}</span>
      </div>
    </div>
  )
}
