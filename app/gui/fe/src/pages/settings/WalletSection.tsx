import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import '../../i18n'
import { invoke } from '@tauri-apps/api/core'
import type { IWallet } from '@meshsdk/core'
import { getAutolockMinutes, setAutolockMinutes } from '../../services/autolock'
import { copyToClipboard } from '../../utils/clipboard'
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
  const { t } = useTranslation('settings')
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

  const [autolockValue, setAutolockValue] = useState(() => getAutolockMinutes())
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
      setMnemonicError(t('wallet.passwordRequired'))
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
  }, [mnemonicPassword, t])

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
      toast.warning(t('wallet.copyFailedTitle'), t('wallet.copyClipboardFailedBody'))
    }
  }, [mnemonicWords, toast, t])

  const handleCopyAddress = useCallback(async () => {
    if (!address) return
    const success = await copyToClipboard(address)
    if (success) {
      setAddressCopied(true)
      setTimeout(() => setAddressCopied(false), 2000)
    } else {
      toast.warning(t('wallet.copyFailedTitle'), t('wallet.copyAddressFailedBody'))
    }
  }, [address, toast, t])

  const handleCreateCollateral = useCallback(async () => {
    if (!wallet) return
    setWalletConfirmAction(null)
    setCollateralLoading(true)
    try {
      const result = await createCollateral(wallet)
      if (result.success && result.txHash) {
        toast.transactionSuccess(t('wallet.collateralSuccessTitle'), result.txHash)
        if (userPkh) {
          addTransaction(userPkh, {
            txHash: result.txHash,
            type: 'create-collateral',
            timestamp: Date.now(),
            status: 'pending',
            description: t('wallet.collateralSuccessDescription'),
            amountLovelace: 5_000_000,
          })
        }
        setLastActiveTab('history')
        navigate('/dashboard')
      } else if (result.success && result.error) {
        toast.info(t('wallet.collateralReadyTitle'), result.error)
      } else {
        toast.error(t('wallet.collateralFailedTitle'), result.error || t('wallet.unknownError'))
      }
    } catch (err) {
      toast.error(t('wallet.collateralFailedTitle'), err instanceof Error ? err.message : t('wallet.unknownError'))
    } finally {
      setCollateralLoading(false)
    }
  }, [wallet, toast, userPkh, navigate, t])

  const handleDefragWallet = useCallback(async () => {
    if (!wallet) return
    setWalletConfirmAction(null)
    setDefragLoading(true)
    try {
      const result = await defragWallet(wallet)
      if (result.success && result.txHash) {
        const title = result.error ? t('wallet.walletPartiallyOptimizedTitle') : t('wallet.walletOptimizedTitle')
        toast.transactionSuccess(title, result.txHash, result.error)
        if (userPkh) {
          addTransaction(userPkh, {
            txHash: result.txHash,
            type: 'optimize-wallet',
            timestamp: Date.now(),
            status: 'pending',
            description: result.error
              ? t('wallet.walletOptimizedPartialDescription', { error: result.error })
              : t('wallet.walletOptimizedDescription'),
          })
        }
        setLastActiveTab('history')
        navigate('/dashboard')
      } else {
        toast.error(t('wallet.optimizationFailedTitle'), result.error || t('wallet.unknownError'))
      }
    } catch (err) {
      toast.error(t('wallet.optimizationFailedTitle'), err instanceof Error ? err.message : t('wallet.unknownError'))
    } finally {
      setDefragLoading(false)
    }
  }, [wallet, toast, userPkh, navigate, t])

  const tokenCount = defragPreview
    ? defragPreview.tokenOutputs.reduce((sum, tok) => sum + tok.assets.length, 0)
    : 0

  return (
    <>
      <div className="space-y-6">
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <h2 className="text-lg font-medium mb-4">{t('wallet.infoTitle')}</h2>
          <div className="space-y-4">
            <div>
              <span className="text-sm text-[var(--text-muted)]">{t('wallet.status')}</span>
              <p className="text-lg font-medium capitalize">{walletState}</p>
            </div>
            {address && (
              <div>
                <span className="text-sm text-[var(--text-muted)]">{t('wallet.address')}</span>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-sm font-mono bg-[var(--bg-secondary)] px-3 py-2 rounded-[var(--radius-md)] break-all flex-1">
                    {address}
                  </code>
                  <button
                    onClick={handleCopyAddress}
                    className="px-3 py-2 text-sm rounded-[var(--radius-md)] shrink-0 btn-base btn-tertiary"
                  >
                    {addressCopied ? t('wallet.copied') : t('wallet.copy')}
                  </button>
                </div>
              </div>
            )}
            {lovelace && (
              <div>
                <span className="text-sm text-[var(--text-muted)]">{t('wallet.balance')}</span>
                <p className="text-lg font-medium text-[var(--accent)]">{t('wallet.balanceAda', { amount: formatAdaDisplay(lovelace) })}</p>
              </div>
            )}
          </div>
        </div>

        {/* Wallet Management */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <h2 className="text-lg font-medium mb-2">{t('wallet.managementTitle')}</h2>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            {t('wallet.managementDescription')}
          </p>

          {walletHealth.isChecking ? (
            <p className="text-sm text-[var(--text-muted)]">{t('wallet.analyzing')}</p>
          ) : stage !== 'synced' ? (
            <p className="text-sm text-[var(--text-muted)]">{t('wallet.nodeMustBeSynced')}</p>
          ) : (
            <div className="space-y-4">
              {/* Status Grid */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
                <div>
                  <span className="text-sm text-[var(--text-muted)] inline-flex items-center gap-1">
                    {t('wallet.collateral')}
                    <InfoTooltip text={t('wallet.collateralTooltip')} />
                  </span>
                  <p className={`text-sm font-medium flex items-center gap-2 ${walletHealth.hasCollateral ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>
                    <span className={`w-2 h-2 rounded-full ${walletHealth.hasCollateral ? 'bg-[var(--success)]' : 'bg-[var(--warning)]'}`} />
                    {walletHealth.hasCollateral ? t('wallet.collateralSet') : t('wallet.collateralNotSet')}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-[var(--text-muted)]">{t('wallet.utxoCount')}</span>
                  <p className="text-sm font-medium">{walletHealth.utxoCount}</p>
                </div>
                <div>
                  <span className="text-sm text-[var(--text-muted)]">{t('wallet.pureAdaUtxos')}</span>
                  <p className="text-sm font-medium">{walletHealth.pureAdaCount}</p>
                </div>
                <div>
                  <span className="text-sm text-[var(--text-muted)]">{t('wallet.tokenUtxos')}</span>
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
                    <p className="text-sm font-medium text-[var(--warning)]">{t('wallet.needsOptimization')}</p>
                    <p className="text-sm text-[var(--text-muted)]">
                      {t('wallet.fragmentationMessage', { count: walletHealth.utxoCount })}
                      {!walletHealth.hasCollateral && ` ${t('wallet.noCollateralFound')}`}
                      {walletHealth.utxoCount > 10 && ` ${t('wallet.consolidatingHint')}`}
                    </p>
                  </div>
                </div>
              )}

              {/* Defrag Preview */}
              {defragPreview && !defragPreviewLoading && walletHealth.utxoCount > 1 && (
                <div className="p-3 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
                  <p className="text-xs text-[var(--text-muted)] mb-1">{t('wallet.optimizationPreview')}</p>
                  <p className="text-sm">
                    {t('wallet.previewUtxoChange', {
                      from: t('wallet.utxoLabel', { count: defragPreview.inputCount }),
                      to: t('wallet.utxoLabel', { count: defragPreview.resultingUtxoCount }),
                    })}
                    {tokenCount > 0 && (
                      <span className="text-[var(--text-muted)]">
                        {' '}{t('wallet.tokensConsolidated', { count: tokenCount })}
                      </span>
                    )}
                  </p>
                  {defragPreview.capped && (
                    <p className="text-xs text-[var(--warning)] mt-1">
                      {t('wallet.previewCapped')}
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
                    {t('wallet.collateralExplainer')}
                  </p>
                )}
                <div className="flex gap-3">
                  {!walletHealth.hasCollateral && (
                    <button
                      onClick={() => setWalletConfirmAction('collateral')}
                      disabled={collateralLoading || defragLoading}
                      className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
                    >
                      {collateralLoading ? t('wallet.creatingCollateral') : t('wallet.setCollateralButton')}
                    </button>
                  )}
                  <button
                    onClick={() => setWalletConfirmAction('defrag')}
                    disabled={defragLoading || collateralLoading || walletHealth.utxoCount <= 1 || (defragPreview !== null && !defragPreview.isFeasible)}
                    className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
                    title={defragPreview && !defragPreview.isFeasible ? defragPreview.infeasibleReason : undefined}
                  >
                    {defragLoading ? t('wallet.optimizingWallet') : t('wallet.optimizeWalletButton')}
                  </button>
                  <InfoTooltip text={t('wallet.optimizationTooltip')} />
                </div>
                <p className="text-xs text-[var(--text-muted)]">
                  {t('wallet.optimizationHint')}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Recovery Phrase */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <h2 className="text-lg font-medium mb-2">{t('wallet.recoveryTitle')}</h2>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            {t('wallet.recoveryDescription')}
          </p>

          {!showMnemonic ? (
            <div className="space-y-3">
              <input
                type="password"
                value={mnemonicPassword}
                onChange={(e) => setMnemonicPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRevealMnemonic()}
                placeholder={t('wallet.passwordPlaceholder')}
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
                {mnemonicLoading ? t('wallet.verifying') : t('wallet.revealButton')}
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
                  {mnemonicCopied ? t('wallet.copyMnemonicCopied') : t('wallet.copyMnemonicButton')}
                </button>
                <button
                  onClick={handleHideMnemonic}
                  className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
                >
                  {t('wallet.hideMnemonicButton')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Auto-Lock */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <h2 className="text-lg font-medium mb-2">{t('wallet.autoLockTitle')}</h2>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            {t('wallet.autoLockDescription')}
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { labelKey: 'wallet.autoLock5', value: 5 },
              { labelKey: 'wallet.autoLock10', value: 10 },
              { labelKey: 'wallet.autoLock15', value: 15 },
              { labelKey: 'wallet.autoLock30', value: 30 },
              { labelKey: 'wallet.autoLock60', value: 60 },
              { labelKey: 'wallet.autoLockNever', value: 0 },
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
                {t(preset.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Lock Wallet */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <h2 className="text-lg font-medium mb-2">{t('wallet.lockWalletTitle')}</h2>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            {t('wallet.lockWalletDescription')}
          </p>
          <button
            onClick={() => { lock(); navigate('/') }}
            className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
          >
            {t('wallet.lockWalletButton')}
          </button>
        </div>
      </div>

      {/* Wallet Management Confirmation */}
      <ConfirmModal
        isOpen={walletConfirmAction === 'collateral'}
        onClose={() => setWalletConfirmAction(null)}
        onConfirm={handleCreateCollateral}
        title={t('wallet.confirmCollateralTitle')}
        message={t('wallet.confirmCollateralMessage')}
        description={t('wallet.confirmCollateralDescription')}
        confirmLabel={t('wallet.confirmCollateralButton')}
        confirmVariant="default"
        loading={collateralLoading}
      />
      <ConfirmModal
        isOpen={walletConfirmAction === 'defrag'}
        onClose={() => setWalletConfirmAction(null)}
        onConfirm={handleDefragWallet}
        title={t('wallet.confirmDefragTitle')}
        message={
          t('wallet.confirmDefragMessage', { count: walletHealth.utxoCount })
          + (defragPreview
            ? t('wallet.confirmDefragResult', { utxo: t('wallet.utxoLabel', { count: defragPreview.resultingUtxoCount }) })
            : '')
        }
        description={t('wallet.confirmDefragDescription')}
        confirmLabel={t('wallet.confirmDefragButton')}
        confirmVariant="default"
        loading={defragLoading}
      />
    </>
  )
}
