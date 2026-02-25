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

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-4 px-4 py-2 text-sm"
      style={{
        background: 'var(--warning-muted)',
        borderBottom: '1px solid var(--warning)',
        color: 'var(--warning)',
      }}
      role="alert"
      aria-live="polite"
    >
      <span>
        Session will lock in{' '}
        <strong className="font-mono">{timeDisplay}</strong> due to inactivity
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
  )
}
