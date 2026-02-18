import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWalletContext } from '../contexts/WalletContext'
import LoadingSpinner from '../components/LoadingSpinner'

export default function WalletUnlock() {
  const { unlockWallet, deleteWallet } = useWalletContext()
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleUnlock = useCallback(async () => {
    if (!password) return
    setIsUnlocking(true)
    setError(null)
    try {
      await unlockWallet(password)
      navigate('/dashboard')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to unlock wallet')
      setPassword('')
    } finally {
      setIsUnlocking(false)
    }
  }, [password, unlockWallet, navigate])

  const handleDelete = useCallback(async () => {
    await deleteWallet()
    navigate('/wallet-setup')
  }, [deleteWallet, navigate])

  return (
    <div
      className="min-h-screen flex items-center justify-center p-8"
      style={{ background: 'var(--bg-primary)' }}
    >
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1
            className="text-3xl font-bold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Veiled
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Enter your password to unlock
          </p>
        </div>

        {/* Unlock card */}
        <div
          className="p-6 rounded-xl"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div className="mb-4">
            <label
              className="block text-sm mb-1"
              style={{ color: 'var(--text-muted)' }}
            >
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleUnlock()
                }}
                className="w-full px-4 py-2 rounded-lg text-sm pr-16"
                style={{
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: `1px solid ${error ? 'var(--error)' : 'var(--border-subtle)'}`,
                  outline: 'none',
                }}
                placeholder="Enter spending password"
                autoComplete="current-password"
                autoFocus
                disabled={isUnlocking}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded cursor-pointer"
                style={{ color: 'var(--text-muted)' }}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {error && (
            <div
              className="mb-4 p-3 rounded-lg text-sm"
              style={{
                background: 'var(--error-muted)',
                color: 'var(--error)',
                border: '1px solid var(--error)',
              }}
            >
              {error}
            </div>
          )}

          <button
            onClick={handleUnlock}
            disabled={!password || isUnlocking}
            className="w-full px-6 py-2 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{
              background:
                password && !isUnlocking ? 'var(--accent)' : 'var(--bg-elevated)',
              color: '#fff',
            }}
          >
            {isUnlocking && <LoadingSpinner size="sm" className="text-white" />}
            {isUnlocking ? 'Unlocking...' : 'Unlock'}
          </button>

          {/* Forgot password */}
          <div className="mt-4 text-center">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="text-xs cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
            >
              Forgot password?
            </button>
          </div>
        </div>

        {/* Delete confirmation dialog */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 flex items-center justify-center z-50">
            <div
              className="absolute inset-0"
              style={{ background: 'rgba(0,0,0,0.6)' }}
              onClick={() => setShowDeleteConfirm(false)}
            />
            <div
              className="relative w-full max-w-sm mx-4 p-6 rounded-xl"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-default)',
                boxShadow: 'var(--shadow-lg)',
              }}
            >
              <h3
                className="text-lg font-semibold mb-3"
                style={{ color: 'var(--text-primary)' }}
              >
                Delete Wallet?
              </h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                This will remove the encrypted wallet from this device. Your funds
                are safe if you have your 24-word recovery phrase backed up. You
                can re-import it after deleting.
              </p>
              <div
                className="p-3 rounded-lg mb-4 text-sm"
                style={{
                  background: 'var(--warning-muted)',
                  color: 'var(--warning)',
                  border: '1px solid var(--warning)',
                }}
              >
                Without your recovery phrase, your funds will be permanently lost.
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 px-4 py-2 rounded-lg text-sm cursor-pointer"
                  style={{
                    background: 'var(--bg-elevated)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
                  style={{
                    background: 'var(--error)',
                    color: '#fff',
                  }}
                >
                  Delete Wallet
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
