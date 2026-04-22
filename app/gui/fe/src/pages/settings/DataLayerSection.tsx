import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import '../../i18n'
import { invoke } from '@tauri-apps/api/core'
import type { IWallet } from '@meshsdk/core'
import { connectIagon, disconnectIagon, isIagonConnected, hasValidApiKey, getStoredApiKey, handleIagonError, isIagonAuthError, onIagonAuthFailure } from '../../services/iagonAuth'
import { verifyApiKey, deleteFile as iagonDeleteFile, getStorageUsage } from '../../services/iagonApi'
import { getOrphanedDrafts, removeListingDraft, type ListingDraft } from '../../services/listingDraftStorage'
import ConfirmModal from '../../components/ConfirmModal'
import LoadingSpinner, { DelayedSpinner } from '../../components/LoadingSpinner'
import { useToast } from '../../components/Toast'
import { formatBytes } from '../../utils/formatBytes'

interface DataLayerSectionProps {
  wallet: IWallet | null
  address: string | undefined
  walletState: string
}

export default function DataLayerSection({
  wallet,
  address,
  walletState,
}: DataLayerSectionProps) {
  const { t } = useTranslation('settings')
  const toast = useToast()

  // Iagon state
  const [iagonConnected, setIagonConnected] = useState(false)
  const [iagonLoading, setIagonLoading] = useState(false)
  const [iagonError, setIagonError] = useState('')
  const [iagonDisconnectConfirm, setIagonDisconnectConfirm] = useState(false)
  const [manualApiKey, setManualApiKey] = useState('')

  // Orphaned Iagon files
  const [orphanedDrafts, setOrphanedDrafts] = useState<ListingDraft[]>([])
  const [orphanCleanupLoading, setOrphanCleanupLoading] = useState<string | null>(null)
  const [orphanDeleteAllConfirm, setOrphanDeleteAllConfirm] = useState(false)

  // Iagon storage usage
  const [storageUsage, setStorageUsage] = useState<{ totalBytes: number; fileCount: number } | null>(null)
  const [storageUsageLoading, setStorageUsageLoading] = useState(false)

  // Hold toast + t in refs so refreshStorageUsage stays referentially stable
  // (useToast() / useTranslation() return a fresh object each render, which
  // would otherwise retrigger the auto-fetch effect and cause an infinite loop).
  const toastRef = useRef(toast)
  toastRef.current = toast
  const tRef = useRef(t)
  tRef.current = t

  // Flag set while Verify / Refresh / orphan-delete etc. are in-flight. The
  // global auth-failure listener checks this so that when the handler itself
  // is going to update state in its `finally`, the listener doesn't
  // double-set mid-await and produce an intermediate "connecting..." render.
  const iagonOperationInFlightRef = useRef(false)

  const refreshStorageUsage = useCallback(async () => {
    iagonOperationInFlightRef.current = true
    setStorageUsageLoading(true)
    try {
      const apiKey = await getStoredApiKey()
      if (!apiKey) {
        toastRef.current.error(tRef.current('dataLayer.storageUsageToastTitle'), tRef.current('dataLayer.storageUsageKeyMissing'))
        return
      }
      const usage = await getStorageUsage(apiKey)
      setStorageUsage(usage)
    } catch (err) {
      console.error('Failed to fetch Iagon storage usage:', err)
      // AUTH_FAILED: disconnect, emit event, and surface the expiry message
      // inline. handleIagonError returns true when it matched — the Dashboard
      // listener still fires the sticky warning toast, so no local toast is
      // needed here.
      const authError = await handleIagonError(err)
      if (authError) {
        setIagonConnected(false)
        setStorageUsage(null)
        setIagonError(tRef.current('dataLayer.iagonKeyExpired'))
        return
      }
      const msg = isIagonAuthError(err)
        ? tRef.current('dataLayer.iagonKeyExpired')
        : err instanceof Error ? err.message : tRef.current('dataLayer.storageUsageFetchFailed')
      toastRef.current.error(tRef.current('dataLayer.storageUsageToastTitle'), msg)
    } finally {
      setStorageUsageLoading(false)
      iagonOperationInFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    if (iagonConnected) {
      refreshStorageUsage()
    } else {
      setStorageUsage(null)
    }
  }, [iagonConnected, refreshStorageUsage])

  // Load Iagon status on mount
  useEffect(() => {
    isIagonConnected().then(setIagonConnected).catch(console.error)
  }, [])

  // Keep the local "connected" indicator in sync when anything in the app
  // detects AUTH_FAILED. This is what flips the green dot to grey without
  // the user having to click Verify themselves. If a local handler (Verify,
  // Refresh, orphan delete) is already running, it will update state in its
  // `finally` — skipping here avoids the intermediate render where iagon
  // flips to disconnected while iagonLoading is still true, which is what
  // produced the flashing buttons.
  useEffect(() => {
    const unsubscribe = onIagonAuthFailure(() => {
      if (iagonOperationInFlightRef.current) return
      setIagonConnected(false)
      setStorageUsage(null)
      setIagonError(tRef.current('dataLayer.iagonKeyExpired'))
    })
    return unsubscribe
  }, [])

  // Load orphaned drafts on mount
  useEffect(() => {
    getOrphanedDrafts().then(setOrphanedDrafts).catch((err) => console.warn('Failed to load orphaned drafts:', err))
  }, [])

  const handleConnectIagon = useCallback(async () => {
    if (!wallet || !address) return
    setIagonLoading(true)
    setIagonError('')
    try {
      await connectIagon(wallet, address)
      setIagonConnected(true)
    } catch (err) {
      console.error('Failed to connect Iagon:', err)
      const msg = err instanceof Error ? err.message : t('dataLayer.connectFailedDefault')
      setIagonError(`${msg}${t('dataLayer.connectFailedSuffix')}`)
    } finally {
      setIagonLoading(false)
    }
  }, [wallet, address, t])

  const handleDisconnectIagon = useCallback(async () => {
    setIagonLoading(true)
    setIagonError('')
    try {
      await disconnectIagon()
      setIagonConnected(false)
    } catch (err) {
      console.error('Failed to disconnect Iagon:', err)
      setIagonError(err instanceof Error ? err.message : t('dataLayer.disconnectFailed'))
    } finally {
      setIagonLoading(false)
    }
  }, [t])

  const handleVerifyIagon = useCallback(async () => {
    // Read `t` / `toast` from refs so this callback stays referentially
    // stable across renders (toast is a fresh object every render, which
    // otherwise rebuilds the button's onClick handler).
    iagonOperationInFlightRef.current = true
    setIagonLoading(true)
    try {
      const stored = await getStoredApiKey()
      if (!stored) {
        setIagonConnected(false)
        setIagonError(tRef.current('dataLayer.verifyNoKey'))
        setStorageUsage(null)
        return
      }
      // hasValidApiKey cleans up the stored key and fires the auth-failure
      // event on rejection. The listener checks `iagonOperationInFlightRef`
      // and no-ops so that THIS handler owns every state update — batching
      // them into a single post-await render avoids the brief flicker where
      // iagonConnected flips before iagonLoading does.
      const valid = await hasValidApiKey()
      if (valid) {
        setIagonError('')
        setIagonConnected(true)
        toastRef.current.success(
          tRef.current('dataLayer.verifyOkTitle'),
          tRef.current('dataLayer.verifyOkBody'),
        )
      } else {
        setIagonConnected(false)
        setStorageUsage(null)
        setIagonError(tRef.current('dataLayer.iagonKeyExpired'))
      }
    } catch (err) {
      setIagonError(err instanceof Error ? err.message : tRef.current('dataLayer.verificationFailed'))
    } finally {
      setIagonLoading(false)
      iagonOperationInFlightRef.current = false
    }
  }, [])

  const handleSaveManualKey = useCallback(async () => {
    if (!manualApiKey.trim()) return
    setIagonLoading(true)
    setIagonError('')
    try {
      const valid = await verifyApiKey(manualApiKey.trim())
      if (!valid) {
        setIagonError(t('dataLayer.manualKeyInvalid'))
        return
      }
      await invoke('store_iagon_api_key', { apiKey: manualApiKey.trim() })
      setIagonConnected(true)
      setManualApiKey('')
    } catch (err) {
      setIagonError(err instanceof Error ? err.message : t('dataLayer.manualKeySaveFailed'))
    } finally {
      setIagonLoading(false)
    }
  }, [manualApiKey, t])

  const handleDeleteOrphan = useCallback(async (draft: ListingDraft) => {
    if (!draft.iagonFileId) return
    iagonOperationInFlightRef.current = true
    setOrphanCleanupLoading(draft.id)
    try {
      const apiKey = await getStoredApiKey()
      if (apiKey && draft.iagonFileId) {
        await iagonDeleteFile(apiKey, draft.iagonFileId)
      }
      await removeListingDraft(draft.id)
      setOrphanedDrafts(prev => prev.filter(d => d.id !== draft.id))
    } catch (err) {
      console.error('Failed to delete orphaned file:', err)
      const authError = await handleIagonError(err)
      if (authError) {
        setIagonConnected(false)
        setStorageUsage(null)
        setIagonError(tRef.current('dataLayer.iagonKeyExpired'))
        return
      }
      setIagonError(err instanceof Error ? err.message : tRef.current('dataLayer.orphanedDeleteFailed'))
    } finally {
      setOrphanCleanupLoading(null)
      iagonOperationInFlightRef.current = false
    }
  }, [])

  const handleDeleteAllOrphans = useCallback(async () => {
    const apiKey = await getStoredApiKey()
    const total = orphanedDrafts.length
    const succeededIds: string[] = []
    let failedCount = 0

    for (const draft of orphanedDrafts) {
      try {
        if (apiKey && draft.iagonFileId) {
          await iagonDeleteFile(apiKey, draft.iagonFileId)
        }
        await removeListingDraft(draft.id)
        succeededIds.push(draft.id)
      } catch (err) {
        console.error(`Failed to delete orphaned file ${draft.id}:`, err)
        failedCount++
      }
    }

    const successSet = new Set(succeededIds)
    setOrphanedDrafts(prev => prev.filter(d => !successSet.has(d.id)))

    if (failedCount === 0) {
      toast.success(t('dataLayer.orphanedCleanupTitle'), t('dataLayer.orphanedCleanupBody', { count: total }))
    } else if (succeededIds.length > 0) {
      toast.warning(
        t('dataLayer.orphanedPartialTitle'),
        t('dataLayer.orphanedPartialBody', { succeeded: succeededIds.length, total, failed: failedCount }),
      )
    } else {
      toast.error(t('dataLayer.orphanedFailedTitle'), t('dataLayer.orphanedFailedBody'))
    }
  }, [orphanedDrafts, toast, t])

  return (
    <>
      <div className="space-y-6">
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <h2 className="text-lg font-medium mb-2">{t('dataLayer.iagonTitle')}</h2>
          <p className="text-sm text-[var(--text-muted)] mb-6">
            {t('dataLayer.iagonDescription')}
          </p>

          {/* Connection Status */}
          <div className="flex items-center gap-3 mb-6 p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
            <span
              className={`w-3 h-3 rounded-full ${
                iagonConnected ? 'bg-[var(--success)]' : 'bg-[var(--text-muted)]'
              }`}
            />
            <div className="flex-1">
              <p className="text-sm font-medium">
                {iagonConnected ? t('dataLayer.connected') : t('dataLayer.notConnected')}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                {iagonConnected
                  ? t('dataLayer.connectedSubtitle')
                  : t('dataLayer.notConnectedSubtitle')}
              </p>
            </div>
          </div>

          {/* Account requirement callout */}
          {!iagonConnected && (
            <div className="mb-6 p-3 bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded-[var(--radius-md)]">
              <p className="text-sm text-[var(--text-secondary)]">
                <strong className="text-[var(--accent)]">{t('dataLayer.accountRequirementPrefix')}</strong>{t('dataLayer.accountRequirementBody')}
                <a
                  href="https://app.iagon.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent)] hover:underline"
                >
                  app.iagon.com
                </a>
                {t('dataLayer.accountRequirementBodyAfter')}
              </p>
            </div>
          )}

          {/* Error */}
          {iagonError && (
            <div className="mb-4 p-3 bg-[var(--error)]/10 border border-[var(--error)]/30 rounded-[var(--radius-md)]">
              <p className="text-sm text-[var(--error)]">{iagonError}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            {!iagonConnected ? (
              <button
                onClick={handleConnectIagon}
                disabled={iagonLoading || !wallet || walletState !== 'unlocked'}
                className="px-4 py-2.5 text-sm font-medium rounded-[var(--radius-md)] flex items-center gap-2 btn-base btn-primary"
              >
                {iagonLoading ? (
                  <>
                    <LoadingSpinner size="sm" />
                    {t('dataLayer.connecting')}
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    {t('dataLayer.connectButton')}
                  </>
                )}
              </button>
            ) : (
              <>
                <button
                  onClick={handleVerifyIagon}
                  disabled={iagonLoading}
                  className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
                >
                  {iagonLoading ? t('dataLayer.verifyChecking') : t('dataLayer.verifyButton')}
                </button>
                <button
                  onClick={() => setIagonDisconnectConfirm(true)}
                  disabled={iagonLoading}
                  className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-destructive"
                >
                  {t('dataLayer.disconnectButton')}
                </button>
              </>
            )}
          </div>

          {/* Requirements info */}
          {walletState !== 'unlocked' && (
            <p className="mt-4 text-xs text-[var(--warning)]">
              {t('dataLayer.unlockFirstHint')}
            </p>
          )}
        </div>

        {/* Manual API key input */}
        {!iagonConnected && (
          <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
            <h3 className="text-sm font-medium mb-2">{t('dataLayer.manualKeyTitle')}</h3>
            <p className="text-xs text-[var(--text-muted)] mb-3">
              {t('dataLayer.manualKeyDescriptionBefore')}
              <a
                href="https://app.iagon.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent)] hover:underline"
              >
                app.iagon.com
              </a>
              {t('dataLayer.manualKeyDescriptionAfter')}
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualApiKey}
                onChange={(e) => setManualApiKey(e.target.value)}
                placeholder={t('dataLayer.manualKeyPlaceholder')}
                className="flex-1 px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
              <button
                onClick={handleSaveManualKey}
                disabled={iagonLoading || !manualApiKey.trim()}
                className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
              >
                {iagonLoading ? t('dataLayer.manualKeySaving') : t('dataLayer.manualKeySave')}
              </button>
            </div>
          </div>
        )}

        {/* Iagon Storage Usage */}
        {iagonConnected && (
          <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-medium">{t('dataLayer.storageUsageTitle')}</h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {t('dataLayer.storageUsageDescription')}
                </p>
              </div>
              <button
                onClick={refreshStorageUsage}
                disabled={storageUsageLoading}
                className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] btn-base btn-tertiary"
              >
                {storageUsageLoading ? t('dataLayer.storageUsageRefreshing') : t('dataLayer.storageUsageRefresh')}
              </button>
            </div>

            {storageUsageLoading && !storageUsage ? (
              <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] py-2">
                <DelayedSpinner size="sm" label={t('dataLayer.storageUsageLoading')} />
                {t('dataLayer.storageUsageLoadingText')}
              </div>
            ) : storageUsage ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
                  <p className="text-xs text-[var(--text-muted)] mb-1">{t('dataLayer.storageUsageTotalUsed')}</p>
                  <p className="text-lg font-medium text-[var(--text-primary)]">
                    {formatBytes(storageUsage.totalBytes)}
                  </p>
                </div>
                <div className="p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
                  <p className="text-xs text-[var(--text-muted)] mb-1">{t('dataLayer.storageUsageFiles')}</p>
                  <p className="text-lg font-medium text-[var(--text-primary)]">
                    {storageUsage.fileCount}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)] text-center py-4">
                {t('dataLayer.storageUsageUnavailable')}
              </p>
            )}
          </div>
        )}

        {/* Orphaned Files Cleanup */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-medium">{t('dataLayer.orphanedTitle')}</h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {t('dataLayer.orphanedDescription')}
              </p>
            </div>
            {orphanedDrafts.length > 1 && (
              <button
                onClick={() => setOrphanDeleteAllConfirm(true)}
                className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] btn-base btn-destructive"
              >
                {t('dataLayer.orphanedDeleteAll')}
              </button>
            )}
          </div>

          {orphanedDrafts.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-4">
              {t('dataLayer.orphanedNone')}
            </p>
          ) : (
            <div className="space-y-2">
              {orphanedDrafts.map((draft) => (
                <div
                  key={draft.id}
                  className="flex items-center gap-3 p-3 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--text-primary)] truncate">
                      {draft.originalFilename}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {draft.category} &middot;{' '}
                      {draft.originalFileSize < 1024 * 1024
                        ? `${(draft.originalFileSize / 1024).toFixed(1)} KB`
                        : `${(draft.originalFileSize / (1024 * 1024)).toFixed(1)} MB`}
                      {' '}&middot; {draft.status}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteOrphan(draft)}
                    disabled={orphanCleanupLoading === draft.id}
                    className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] btn-base btn-destructive"
                  >
                    {orphanCleanupLoading === draft.id ? t('dataLayer.orphanedDeleting') : t('dataLayer.orphanedDelete')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info card */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <h3 className="text-sm font-medium mb-3">{t('dataLayer.howItWorksTitle')}</h3>
          <div className="space-y-3 text-sm text-[var(--text-secondary)]">
            <div className="flex gap-3">
              <span className="text-[var(--accent)] font-mono text-xs mt-0.5">1</span>
              <p>{t('dataLayer.howItWorks1')}</p>
            </div>
            <div className="flex gap-3">
              <span className="text-[var(--accent)] font-mono text-xs mt-0.5">2</span>
              <p>{t('dataLayer.howItWorks2')}</p>
            </div>
            <div className="flex gap-3">
              <span className="text-[var(--accent)] font-mono text-xs mt-0.5">3</span>
              <p>{t('dataLayer.howItWorks3')}</p>
            </div>
            <div className="flex gap-3">
              <span className="text-[var(--accent)] font-mono text-xs mt-0.5">4</span>
              <p>{t('dataLayer.howItWorks4')}</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-[var(--text-muted)]">
            {t('dataLayer.howItWorksFooterBefore')}
            <a
              href="https://app.iagon.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] hover:underline"
            >
              app.iagon.com
            </a>
            {t('dataLayer.howItWorksFooterAfter')}
          </p>
        </div>
      </div>

      {/* Iagon Disconnect Confirmation */}
      <ConfirmModal
        isOpen={iagonDisconnectConfirm}
        onClose={() => setIagonDisconnectConfirm(false)}
        onConfirm={() => { setIagonDisconnectConfirm(false); handleDisconnectIagon(); }}
        title={t('dataLayer.confirmDisconnectTitle')}
        message={t('dataLayer.confirmDisconnectMessage')}
        description={t('dataLayer.confirmDisconnectDescription')}
        confirmLabel={t('dataLayer.confirmDisconnectButton')}
        confirmVariant="danger"
        loading={iagonLoading}
      />

      {/* Orphaned Iagon Files Delete All Confirmation */}
      <ConfirmModal
        isOpen={orphanDeleteAllConfirm}
        onClose={() => setOrphanDeleteAllConfirm(false)}
        onConfirm={() => { setOrphanDeleteAllConfirm(false); handleDeleteAllOrphans(); }}
        title={t('dataLayer.confirmDeleteAllTitle')}
        message={t('dataLayer.confirmDeleteAllMessage', { count: orphanedDrafts.length })}
        confirmLabel={t('dataLayer.confirmDeleteAllButton')}
        confirmVariant="danger"
      />
    </>
  )
}
