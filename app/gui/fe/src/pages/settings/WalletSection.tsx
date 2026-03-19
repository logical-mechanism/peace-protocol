import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import type { IWallet } from '@meshsdk/core'
import { getAutolockMinutes, setAutolockMinutes } from '../../services/autolock'
import { copyToClipboard } from '../../utils/clipboard'
import { getToastDurationMs, setToastDurationMs, TOAST_DURATION_OPTIONS } from '../../services/toastSettings'
import { isSoundEnabled, setSoundEnabled, getSoundVolume, setSoundVolume, playNotificationSound } from '../../services/notificationSound'
import { isDesktopNotificationsEnabled, setDesktopNotificationsEnabled, sendDesktopNotification } from '../../services/desktopNotifications'
import { getTheme, setTheme, applyTheme, type Theme } from '../../services/themeStorage'
import { formatAdaDisplay } from '../../utils/formatAda'
import { setLastActiveTab } from '../../services/tabStorage'
import { addTransaction } from '../../services/transactionHistory'
import { createCollateral, defragWallet, previewDefrag, type DefragPreview } from '../../services/walletManagement'
import ConfirmModal from '../../components/ConfirmModal'
import InfoTooltip from '../../components/InfoTooltip'
import { useToast } from '../../components/Toast'
import { useWalletHealth } from '../../hooks/useWalletHealth'

interface WalletSectionProps {
  walletState: string
  wallet: IWallet | null
  address: string | undefined
  lovelace: string | null
  userPkh: string | undefined
  stage: string
  tipSlot: number | null
  lock: () => void
}

export default function WalletSection({
  walletState,
  wallet,
  address,
  lovelace,
  userPkh,
  stage,
  tipSlot,
  lock,
}: WalletSectionProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const walletHealth = useWalletHealth(wallet, tipSlot, stage)

  // Mnemonic state
  const [showMnemonic, setShowMnemonic] = useState(false)
  const [mnemonicWords, setMnemonicWords] = useState<string[]>([])
  const [mnemonicPassword, setMnemonicPassword] = useState('')
  const [mnemonicError, setMnemonicError] = useState('')
  const [mnemonicLoading, setMnemonicLoading] = useState(false)
  const [mnemonicCopied, setMnemonicCopied] = useState(false)

  // Preferences state
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => getTheme())
  const [autolockValue, setAutolockValue] = useState(() => getAutolockMinutes())
  const [toastDuration, setToastDuration] = useState(() => getToastDurationMs())
  const [soundEnabled, setSoundEnabledState] = useState(() => isSoundEnabled())
  const [soundVolume, setSoundVolumeState] = useState(() => getSoundVolume())
  const [desktopNotifEnabled, setDesktopNotifEnabledState] = useState(() => isDesktopNotificationsEnabled())
  const [addressCopied, setAddressCopied] = useState(false)

  // Wallet management state
  const [collateralLoading, setCollateralLoading] = useState(false)
  const [defragLoading, setDefragLoading] = useState(false)
  const [defragPreview, setDefragPreview] = useState<DefragPreview | null>(null)
  const [defragPreviewLoading, setDefragPreviewLoading] = useState(false)
  const [walletConfirmAction, setWalletConfirmAction] = useState<'collateral' | 'defrag' | null>(null)

  // Load defrag preview when wallet section is active
  useEffect(() => {
    if (stage !== 'synced' || !wallet) return
    let cancelled = false
    setDefragPreviewLoading(true)
    previewDefrag(wallet)
      .then((preview) => { if (!cancelled) setDefragPreview(preview) })
      .catch((err) => console.warn('Defrag preview failed:', err))
      .finally(() => { if (!cancelled) setDefragPreviewLoading(false) })
    return () => { cancelled = true }
  }, [stage, wallet])

  const handleRevealMnemonic = useCallback(async () => {
    if (!mnemonicPassword) {
      setMnemonicError('Password required')
      return
    }
    setMnemonicLoading(true)
    setMnemonicError('')
    try {
      const words = await invoke<string[]>('reveal_mnemonic', { password: mnemonicPassword })
      setMnemonicWords(words)
      setShowMnemonic(true)
    } catch (error) {
      setMnemonicError(error instanceof Error ? error.message : String(error))
    } finally {
      setMnemonicLoading(false)
    }
  }, [mnemonicPassword])

  const handleHideMnemonic = useCallback(() => {
    setShowMnemonic(false)
    setMnemonicWords([])
    setMnemonicPassword('')
    setMnemonicError('')
    setMnemonicCopied(false)
    navigator.clipboard.writeText('').catch(() => {})
  }, [])

  const handleCopyMnemonic = useCallback(async () => {
    const success = await copyToClipboard(mnemonicWords.join(' '))
    if (success) {
      setMnemonicCopied(true)
      setTimeout(() => setMnemonicCopied(false), 2000)
      // Auto-clear clipboard after 30 seconds for security
      setTimeout(() => {
        navigator.clipboard.writeText('').catch(() => {})
      }, 30000)
    } else {
      toast.warning('Copy failed', 'Could not copy to clipboard.')
    }
  }, [mnemonicWords, toast])

  const handleCopyAddress = useCallback(async () => {
    if (!address) return
    const success = await copyToClipboard(address)
    if (success) {
      setAddressCopied(true)
      setTimeout(() => setAddressCopied(false), 2000)
    } else {
      toast.warning('Copy failed', 'Could not copy address to clipboard.')
    }
  }, [address, toast])

  const handleCreateCollateral = useCallback(async () => {
    if (!wallet) return
    setWalletConfirmAction(null)
    setCollateralLoading(true)
    try {
      const result = await createCollateral(wallet)
      if (result.success && result.txHash) {
        toast.transactionSuccess('Collateral Created', result.txHash)
        if (userPkh) {
          addTransaction(userPkh, {
            txHash: result.txHash,
            type: 'create-collateral',
            timestamp: Date.now(),
            status: 'pending',
            description: 'Set 5 ADA collateral UTxO',
            amountLovelace: 5_000_000,
          })
        }
        setLastActiveTab('history')
        navigate('/dashboard')
      } else if (result.success && result.error) {
        toast.info('Collateral Ready', result.error)
      } else {
        toast.error('Collateral Failed', result.error || 'Unknown error')
      }
    } catch (err) {
      toast.error('Collateral Failed', err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setCollateralLoading(false)
    }
  }, [wallet, toast, userPkh, navigate])

  const handleDefragWallet = useCallback(async () => {
    if (!wallet) return
    setWalletConfirmAction(null)
    setDefragLoading(true)
    try {
      const result = await defragWallet(wallet)
      if (result.success && result.txHash) {
        const title = result.error ? 'Wallet Partially Optimized' : 'Wallet Optimized'
        toast.transactionSuccess(title, result.txHash, result.error)
        if (userPkh) {
          addTransaction(userPkh, {
            txHash: result.txHash,
            type: 'optimize-wallet',
            timestamp: Date.now(),
            status: 'pending',
            description: result.error
              ? `Optimized wallet (partial — ${result.error})`
              : 'Consolidated UTxOs for optimal transaction building',
          })
        }
        setLastActiveTab('history')
        navigate('/dashboard')
      } else {
        toast.error('Optimization Failed', result.error || 'Unknown error')
      }
    } catch (err) {
      toast.error('Optimization Failed', err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setDefragLoading(false)
    }
  }, [wallet, toast, userPkh, navigate])

  return (
    <>
      <div className="space-y-6">
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <h2 className="text-lg font-medium mb-4">Wallet Info</h2>
          <div className="space-y-4">
            <div>
              <span className="text-sm text-[var(--text-muted)]">Status</span>
              <p className="text-lg font-medium capitalize">{walletState}</p>
            </div>
            {address && (
              <div>
                <span className="text-sm text-[var(--text-muted)]">Address</span>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-sm font-mono bg-[var(--bg-secondary)] px-3 py-2 rounded-[var(--radius-md)] break-all flex-1">
                    {address}
                  </code>
                  <button
                    onClick={handleCopyAddress}
                    className="px-3 py-2 text-sm rounded-[var(--radius-md)] shrink-0 btn-base btn-tertiary"
                  >
                    {addressCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
            {lovelace && (
              <div>
                <span className="text-sm text-[var(--text-muted)]">Balance</span>
                <p className="text-lg font-medium text-[var(--accent)]">{formatAdaDisplay(lovelace)} ADA</p>
              </div>
            )}
          </div>
        </div>

        {/* Wallet Management */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <h2 className="text-lg font-medium mb-2">Wallet Management</h2>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            Manage your wallet's UTxO set for optimal transaction building.
          </p>

          {walletHealth.isChecking ? (
            <p className="text-sm text-[var(--text-muted)]">Analyzing wallet...</p>
          ) : stage !== 'synced' ? (
            <p className="text-sm text-[var(--text-muted)]">Node must be synced to analyze wallet health.</p>
          ) : (
            <div className="space-y-4">
              {/* Status Grid */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
                <div>
                  <span className="text-sm text-[var(--text-muted)] inline-flex items-center gap-1">
                    Collateral
                    <InfoTooltip text="A dedicated 5 ADA UTxO required by Cardano for Plutus script transactions. It is returned to you if the transaction succeeds." />
                  </span>
                  <p className={`text-sm font-medium flex items-center gap-2 ${walletHealth.hasCollateral ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>
                    <span className={`w-2 h-2 rounded-full ${walletHealth.hasCollateral ? 'bg-[var(--success)]' : 'bg-[var(--warning)]'}`} />
                    {walletHealth.hasCollateral ? 'Set (5 ADA)' : 'Not Set'}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-[var(--text-muted)]">UTxO Count</span>
                  <p className="text-sm font-medium">{walletHealth.utxoCount}</p>
                </div>
                <div>
                  <span className="text-sm text-[var(--text-muted)]">Pure ADA UTxOs</span>
                  <p className="text-sm font-medium">{walletHealth.pureAdaCount}</p>
                </div>
                <div>
                  <span className="text-sm text-[var(--text-muted)]">Token-bearing UTxOs</span>
                  <p className="text-sm font-medium">{walletHealth.tokenUtxoCount}</p>
                </div>
              </div>

              {/* Fragmentation Warning */}
              {walletHealth.isFragmented && (
                <div className="flex items-start gap-3 p-3 bg-[var(--warning)]/10 border border-[var(--warning)]/30 rounded-[var(--radius-md)]">
                  <svg className="w-5 h-5 text-[var(--warning)] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-[var(--warning)]">Wallet needs optimization</p>
                    <p className="text-sm text-[var(--text-muted)]">
                      Your wallet has {walletHealth.utxoCount} UTxO{walletHealth.utxoCount !== 1 ? 's' : ''}.
                      {!walletHealth.hasCollateral && ' No collateral UTxO found.'}
                      {walletHealth.utxoCount > 10 && ' Consolidating will improve transaction efficiency.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Defrag Preview */}
              {defragPreview && !defragPreviewLoading && walletHealth.utxoCount > 1 && (
                <div className="p-3 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
                  <p className="text-xs text-[var(--text-muted)] mb-1">Optimization preview:</p>
                  <p className="text-sm">
                    {defragPreview.inputCount} UTxO{defragPreview.inputCount !== 1 ? 's' : ''} &rarr; {defragPreview.resultingUtxoCount} UTxO{defragPreview.resultingUtxoCount !== 1 ? 's' : ''}
                    {defragPreview.tokenOutputs.length > 0 && (
                      <span className="text-[var(--text-muted)]">
                        {' '}({defragPreview.tokenOutputs.reduce((sum, t) => sum + t.assets.length, 0)} token{defragPreview.tokenOutputs.reduce((sum, t) => sum + t.assets.length, 0) !== 1 ? 's' : ''} consolidated)
                      </span>
                    )}
                  </p>
                  {defragPreview.capped && (
                    <p className="text-xs text-[var(--warning)] mt-1">
                      Limited to first 200 UTxOs. Run again to continue.
                    </p>
                  )}
                  {!defragPreview.isFeasible && defragPreview.infeasibleReason && (
                    <p className="text-xs text-[var(--error)] mt-1">{defragPreview.infeasibleReason}</p>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-3">
                {!walletHealth.hasCollateral && (
                  <p className="text-sm text-[var(--text-muted)]">
                    Collateral is a small ADA deposit (5 ADA) required by Cardano smart contracts for transaction validation.
                  </p>
                )}
                <div className="flex gap-3">
                  {!walletHealth.hasCollateral && (
                    <button
                      onClick={() => setWalletConfirmAction('collateral')}
                      disabled={collateralLoading || defragLoading}
                      className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
                    >
                      {collateralLoading ? 'Creating...' : 'Set Collateral (5 ADA)'}
                    </button>
                  )}
                  <button
                    onClick={() => setWalletConfirmAction('defrag')}
                    disabled={defragLoading || collateralLoading || walletHealth.utxoCount <= 1 || (defragPreview !== null && !defragPreview.isFeasible)}
                    className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
                    title={defragPreview && !defragPreview.isFeasible ? defragPreview.infeasibleReason : undefined}
                  >
                    {defragLoading ? 'Optimizing...' : 'Optimize Wallet'}
                  </button>
                  <InfoTooltip text="Combines multiple small UTxOs into fewer, larger ones. This reduces transaction complexity and fees." />
                </div>
                <p className="text-xs text-[var(--text-muted)]">
                  Optimization combines small UTxOs into fewer, larger ones to reduce transaction fees.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Recovery Phrase */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <h2 className="text-lg font-medium mb-2">Recovery Phrase</h2>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            View your 24-word recovery phrase. You will need to re-enter your password.
          </p>

          {!showMnemonic ? (
            <div className="space-y-3">
              <input
                type="password"
                value={mnemonicPassword}
                onChange={(e) => setMnemonicPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRevealMnemonic()}
                placeholder="Enter wallet password"
                className="w-full px-4 py-3 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
              {mnemonicError && (
                <p className="text-sm text-[var(--error)]">{mnemonicError}</p>
              )}
              <button
                onClick={handleRevealMnemonic}
                disabled={mnemonicLoading || !mnemonicPassword}
                className="px-4 py-2 text-sm bg-[var(--warning)] text-black rounded-[var(--radius-md)] hover:bg-[var(--warning)]/90 btn-base"
              >
                {mnemonicLoading ? 'Verifying...' : 'Reveal Recovery Phrase'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-2 p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--warning)]/30">
                {mnemonicWords.map((word, i) => (
                  <div key={i} className="flex items-center gap-2 py-1">
                    <span className="text-xs text-[var(--text-muted)] w-5 text-right">{i + 1}.</span>
                    <span className="text-sm font-mono">{word}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleCopyMnemonic}
                  className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
                >
                  {mnemonicCopied ? 'Copied!' : 'Copy to Clipboard'}
                </button>
                <button
                  onClick={handleHideMnemonic}
                  className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
                >
                  Hide Recovery Phrase
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Theme */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <h2 className="text-lg font-medium mb-2">Theme</h2>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            Choose between dark and light appearance.
          </p>
          <div className="flex gap-2">
            {([
              { label: 'Dark', value: 'dark' as Theme },
              { label: 'Light', value: 'light' as Theme },
            ] as const).map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  setCurrentTheme(option.value)
                  setTheme(option.value)
                  applyTheme(option.value)
                }}
                className={`px-4 py-2 text-sm rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer ${
                  currentTheme === option.value
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Auto-Lock */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <h2 className="text-lg font-medium mb-2">Auto-Lock</h2>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            Automatically lock the wallet after a period of inactivity.
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: '5 min', value: 5 },
              { label: '10 min', value: 10 },
              { label: '15 min', value: 15 },
              { label: '30 min', value: 30 },
              { label: '1 hour', value: 60 },
              { label: 'Never', value: 0 },
            ].map((preset) => (
              <button
                key={preset.value}
                onClick={() => {
                  setAutolockValue(preset.value)
                  setAutolockMinutes(preset.value)
                }}
                className={`px-4 py-2 text-sm rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer ${
                  autolockValue === preset.value
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Notification Duration */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <h2 className="text-lg font-medium mb-2">Notification Duration</h2>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            How long toast notifications stay visible before auto-dismissing.
          </p>
          <select
            value={toastDuration}
            onChange={(e) => {
              const ms = Number(e.target.value)
              setToastDuration(ms)
              setToastDurationMs(ms)
            }}
            className="px-4 py-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            {TOAST_DURATION_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Desktop Notifications */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium">Desktop Notifications</h2>
              <p className="text-sm text-[var(--text-muted)]">
                Show system notifications when new bids arrive on your listings.
              </p>
            </div>
            <button
              onClick={() => {
                const next = !desktopNotifEnabled
                setDesktopNotifEnabledState(next)
                setDesktopNotificationsEnabled(next)
                if (next) {
                  sendDesktopNotification('Veiled', 'Desktop notifications enabled!')
                }
              }}
              className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer flex-shrink-0 ${
                desktopNotifEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-secondary)] border border-[var(--border-subtle)]'
              }`}
              role="switch"
              aria-checked={desktopNotifEnabled}
              aria-label="Toggle desktop notifications"
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                desktopNotifEnabled ? 'translate-x-6' : 'translate-x-0'
              }`} />
            </button>
          </div>
        </div>

        {/* Notification Sound */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-medium">Notification Sound</h2>
              <p className="text-sm text-[var(--text-muted)]">
                Play a sound when new bids arrive or transactions confirm.
              </p>
            </div>
            <button
              onClick={() => {
                const next = !soundEnabled
                setSoundEnabledState(next)
                setSoundEnabled(next)
                if (next) playNotificationSound()
              }}
              className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer flex-shrink-0 ${
                soundEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-secondary)] border border-[var(--border-subtle)]'
              }`}
              role="switch"
              aria-checked={soundEnabled}
              aria-label="Toggle notification sound"
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                soundEnabled ? 'translate-x-6' : 'translate-x-0'
              }`} />
            </button>
          </div>
          {soundEnabled && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-[var(--text-secondary)]">Volume</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={soundVolume}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setSoundVolumeState(v)
                  setSoundVolume(v)
                }}
                onMouseUp={() => playNotificationSound()}
                className="flex-1 accent-[var(--accent)]"
              />
              <span className="text-sm text-[var(--text-muted)] w-8 text-right">
                {Math.round(soundVolume * 100)}%
              </span>
            </div>
          )}
        </div>

        {/* Lock Wallet */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <h2 className="text-lg font-medium mb-2">Lock Wallet</h2>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            Lock your wallet to require password entry before using it again.
          </p>
          <button
            onClick={() => { lock(); navigate('/') }}
            className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
          >
            Lock Wallet
          </button>
        </div>
      </div>

      {/* Wallet Management Confirmation */}
      <ConfirmModal
        isOpen={walletConfirmAction === 'collateral'}
        onClose={() => setWalletConfirmAction(null)}
        onConfirm={handleCreateCollateral}
        title="Set Collateral"
        message="This will create a dedicated 5 ADA collateral UTxO by sending ADA to yourself. Collateral is required for all Plutus script transactions (listings, bids, etc.)."
        description="A transaction fee (~0.2 ADA) will be deducted. You need at least 6.5 ADA total in your wallet."
        confirmLabel="Set Collateral"
        confirmVariant="default"
        loading={collateralLoading}
      />
      <ConfirmModal
        isOpen={walletConfirmAction === 'defrag'}
        onClose={() => setWalletConfirmAction(null)}
        onConfirm={handleDefragWallet}
        title="Optimize Wallet"
        message={`This will consolidate your ${walletHealth.utxoCount} UTxOs into an optimized set for efficient transaction building.${defragPreview ? ` Result: ${defragPreview.resultingUtxoCount} UTxO${defragPreview.resultingUtxoCount !== 1 ? 's' : ''}.` : ''}`}
        description="All UTxOs will be consumed and new ones created in a single transaction. A transaction fee (~0.2 ADA) will be deducted."
        confirmLabel="Optimize Wallet"
        confirmVariant="default"
        loading={defragLoading}
      />
    </>
  )
}
