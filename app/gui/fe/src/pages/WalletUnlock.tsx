import { useState, useCallback, useRef } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import '../i18n'
import { useWalletContext } from '../contexts/WalletContext'
import LoadingSpinner from '../components/LoadingSpinner'
import { useModalStack } from '../hooks/useModalStack'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { parseUnlockError } from '../utils/walletErrors'
import type { UnlockErrorInfo } from '../utils/walletErrors'
import { copyToClipboard } from '../utils/clipboard'

export default function WalletUnlock() {
  const { unlockWallet, deleteWallet } = useWalletContext()
  const navigate = useNavigate()
  const { t } = useTranslation('wallet')

  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<UnlockErrorInfo | null>(null)
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [copiedError, setCopiedError] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)
  const [backupAcknowledged, setBackupAcknowledged] = useState(false)
  const onCloseDelete = useCallback(() => {
    setShowDeleteConfirm(false)
    setBackupAcknowledged(false)
  }, [])
  const { zIndex: deleteZIndex, shouldRender: deleteRender, animationState: deleteAnim } =
    useModalStack('DeleteWalletConfirm', showDeleteConfirm, onCloseDelete)
  const deleteDialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(deleteDialogRef, showDeleteConfirm)

  const handleUnlock = useCallback(async () => {
    if (!password || isUnlocking) return
    // Force synchronous render so the button disables before the expensive IPC call
    flushSync(() => {
      setIsUnlocking(true)
      setError(null)
    })
    // Wait for the browser to paint the disabled state
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    try {
      await unlockWallet(password)
      navigate('/dashboard')
    } catch (e) {
      setError(parseUnlockError(e))
      setPassword('')
    } finally {
      setIsUnlocking(false)
    }
  }, [password, isUnlocking, unlockWallet, navigate])

  const handleDelete = useCallback(async () => {
    setIsDeleting(true)
    try {
      await deleteWallet()
      navigate('/wallet-setup')
    } finally {
      setIsDeleting(false)
    }
  }, [deleteWallet, navigate])

  const handleCopyError = useCallback(async () => {
    if (!error) return
    const success = await copyToClipboard(error.raw)
    if (success) {
      setCopiedError(true)
      setTimeout(() => setCopiedError(false), 1500)
    }
  }, [error])

  return (
    <main
      id="main-content"
      className="relative min-h-screen flex items-center justify-center p-8 overflow-hidden"
      style={{ background: 'var(--bg-primary)' }}
    >
      {/* Atmospheric backdrop — radial accent halo centered behind the card */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none opacity-60"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, var(--accent-muted) 0%, transparent 35%)',
        }}
      />
      <div className="relative w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1
            className="text-3xl font-bold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            {t('appName')}
          </h1>
        </div>

        {/* Unlock card */}
        <form
          className="p-6 rounded-xl"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
          }}
          onSubmit={(e) => {
            e.preventDefault()
            handleUnlock()
          }}
        >
          <div className="mb-4">
            <label
              className="block text-sm mb-1"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('unlock.passwordLabel')}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError(null)
                }}
                onKeyDown={(e) => setCapsLockOn(e.getModifierState('CapsLock'))}
                className="w-full px-4 py-2 rounded-lg text-sm pr-16"
                style={{
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: `1px solid ${error ? 'var(--error)' : 'var(--border-subtle)'}`,
                  outline: 'none',
                }}
                autoComplete="current-password"
                autoFocus
                disabled={isUnlocking}
                maxLength={128}
                aria-invalid={!!error}
                aria-describedby={error ? 'password-error' : undefined}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded btn-base btn-icon"
                aria-label={t('unlock.togglePasswordVisibility')}
              >
                {showPassword ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            {capsLockOn && (
              <p className="text-xs mt-1" style={{ color: 'var(--warning)' }}>
                {t('unlock.capsLockOn')}
              </p>
            )}
          </div>

          {error && (
            <div
              id="password-error"
              role="alert"
              className="mb-4 p-3 rounded-lg text-sm"
              style={{
                background: 'var(--error-muted)',
                color: 'var(--error)',
                border: '1px solid var(--error)',
              }}
            >
              <div className="font-medium">{error.title}</div>
              <div
                className="mt-1 text-xs"
                style={{ color: 'var(--text-secondary)' }}
              >
                {error.suggestion}
              </div>
              {error.raw !== error.title && error.raw !== error.suggestion && (
                <details className="mt-2">
                  <summary
                    className="text-xs cursor-pointer"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {t('unlock.details')}
                  </summary>
                  <div className="flex items-start gap-2 mt-1">
                    <code
                      className="block text-xs font-mono break-all flex-1"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {error.raw}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyError}
                      className="shrink-0 p-0.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-all duration-[var(--transition-fast)] cursor-pointer"
                      title={t('unlock.copyErrorTitle')}
                      aria-label={t('unlock.copyErrorTitle')}
                    >
                      {copiedError ? (
                        <svg className="w-3.5 h-3.5 text-[var(--success)] copy-check-animate" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </details>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={!password || isUnlocking}
            className="w-full px-6 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 btn-base btn-primary disabled:opacity-40 disabled:pointer-events-none"
            style={{
              background:
                password && !isUnlocking ? undefined : 'var(--bg-elevated)',
              transition: 'none',
            }}
          >
            {isUnlocking && <LoadingSpinner size="sm" className="text-white" />}
            {isUnlocking ? t('unlock.unlocking') : t('unlock.unlock')}
          </button>

          {/* Forgot password */}
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="text-xs cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('unlock.forgotPassword')}
            </button>
          </div>
        </form>

        {/* Delete confirmation dialog */}
        {deleteRender && (
          <div
            ref={deleteDialogRef}
            className="fixed inset-0 flex items-center justify-center"
            style={{ zIndex: deleteZIndex }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-wallet-title"
          >
            <div
              className={`absolute inset-0 bg-black/60 backdrop-blur-sm ${deleteAnim === 'exiting' ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}`}
              onClick={onCloseDelete}
              aria-hidden="true"
            />
            <div
              className={`relative z-10 w-full max-w-sm mx-4 p-6 rounded-xl ${deleteAnim === 'exiting' ? 'modal-panel-exit' : 'modal-panel-enter'}`}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-default)',
                boxShadow: 'var(--shadow-lg)',
              }}
            >
              <h3
                id="delete-wallet-title"
                className="text-lg font-semibold mb-3"
                style={{ color: 'var(--text-primary)' }}
              >
                {t('unlock.delete.title')}
              </h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                {t('unlock.delete.description')}
              </p>
              <div
                className="p-3 rounded-lg mb-4 text-sm"
                style={{
                  background: 'var(--warning-muted)',
                  color: 'var(--warning)',
                  border: '1px solid var(--warning)',
                }}
              >
                {t('unlock.delete.warning')}
              </div>
              <label
                className="flex items-start gap-3 mb-4 text-sm cursor-pointer select-none"
                style={{ color: 'var(--text-secondary)' }}
              >
                <input
                  type="checkbox"
                  checked={backupAcknowledged}
                  onChange={(e) => setBackupAcknowledged(e.target.checked)}
                  className="sr-only"
                  aria-label={t('unlock.delete.acknowledge')}
                />
                <span
                  className="mt-0.5 w-5 h-5 flex-shrink-0 flex items-center justify-center transition-colors"
                  style={{
                    background: backupAcknowledged ? 'var(--accent)' : 'transparent',
                    border: backupAcknowledged ? '1px solid var(--accent)' : '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  {backupAcknowledged && (
                    <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
                {t('unlock.delete.acknowledge')}
              </label>
              <div className="flex gap-3">
                <button
                  onClick={onCloseDelete}
                  disabled={isDeleting}
                  className="flex-1 px-4 py-2 rounded-lg text-sm btn-base btn-tertiary"
                >
                  {t('unlock.delete.cancel')}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={!backupAcknowledged || isDeleting}
                  className="flex-1 px-4 py-2 rounded-lg text-sm font-medium btn-base btn-danger flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
                >
                  {isDeleting && <LoadingSpinner size="sm" className="text-white" />}
                  {isDeleting ? t('unlock.delete.deleting') : t('unlock.delete.confirm')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
