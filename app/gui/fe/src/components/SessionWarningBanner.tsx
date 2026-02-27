import { useWalletContext } from '../contexts/WalletContext'

export default function SessionWarningBanner() {
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
      className="fixed top-0 left-0 right-0 z-50"
      role="alert"
      aria-live="polite"
    >
      {/* Draining progress bar */}
      <div className="h-0.5" style={{ background: 'var(--warning-muted)' }}>
        <div
          className="h-full transition-all duration-1000 ease-linear"
          style={{
            width: `${progressPercent}%`,
            background: 'var(--warning)',
          }}
        />
      </div>
      <div
        className="flex items-center justify-center gap-4 px-4 py-2 text-sm"
        style={{
          background: 'var(--warning-muted)',
          borderBottom: '1px solid var(--warning)',
          color: 'var(--warning)',
        }}
      >
        <span>
          Session will lock in{' '}
          <strong className="font-mono">{timeDisplay}</strong>
          {' '}&mdash; click Stay Active or press any key to continue
        </span>
        <button
          onClick={extendSession}
          className="px-3 py-1 text-xs font-medium rounded cursor-pointer"
          style={{
            background: 'var(--warning)',
            color: 'var(--bg-primary)',
          }}
          aria-label="Extend session"
        >
          Stay Active
        </button>
      </div>
    </div>
  )
}
