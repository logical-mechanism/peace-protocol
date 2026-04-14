import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { IWallet } from '@meshsdk/core'
import { connectIagon, disconnectIagon, isIagonConnected, getValidApiKey, getStoredApiKey } from '../../services/iagonAuth'
import { verifyApiKey, deleteFile as iagonDeleteFile, getStorageUsage } from '../../services/iagonApi'
import { getOrphanedDrafts, removeListingDraft, type ListingDraft } from '../../services/listingDraftStorage'
import ConfirmModal from '../../components/ConfirmModal'
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

  // Hold toast in a ref so refreshStorageUsage stays referentially stable
  // (useToast() returns a fresh object each render, which would otherwise
  // retrigger the auto-fetch effect and cause an infinite loop).
  const toastRef = useRef(toast)
  toastRef.current = toast

  const refreshStorageUsage = useCallback(async () => {
    setStorageUsageLoading(true)
    try {
      const apiKey = await getStoredApiKey()
      if (!apiKey) {
        setStorageUsage(null)
        return
      }
      const usage = await getStorageUsage(apiKey)
      setStorageUsage(usage)
    } catch (err) {
      console.error('Failed to fetch Iagon storage usage:', err)
      const msg = err instanceof Error ? err.message : 'Failed to fetch storage usage'
      toastRef.current.error('Storage Usage', msg)
    } finally {
      setStorageUsageLoading(false)
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
      const msg = err instanceof Error ? err.message : 'Failed to connect to Iagon'
      setIagonError(`${msg}. You can paste your API key from app.iagon.com below instead.`)
    } finally {
      setIagonLoading(false)
    }
  }, [wallet, address])

  const handleDisconnectIagon = useCallback(async () => {
    setIagonLoading(true)
    setIagonError('')
    try {
      await disconnectIagon()
      setIagonConnected(false)
    } catch (err) {
      console.error('Failed to disconnect Iagon:', err)
      setIagonError(err instanceof Error ? err.message : 'Failed to disconnect')
    } finally {
      setIagonLoading(false)
    }
  }, [])

  const handleVerifyIagon = useCallback(async () => {
    setIagonLoading(true)
    setIagonError('')
    try {
      const key = await getValidApiKey()
      if (key) {
        setIagonConnected(true)
      } else {
        setIagonConnected(false)
        setIagonError('API key is no longer valid. Please reconnect.')
      }
    } catch (err) {
      setIagonError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setIagonLoading(false)
    }
  }, [])

  const handleSaveManualKey = useCallback(async () => {
    if (!manualApiKey.trim()) return
    setIagonLoading(true)
    setIagonError('')
    try {
      const valid = await verifyApiKey(manualApiKey.trim())
      if (!valid) {
        setIagonError('API key is invalid or expired. Check your key and try again.')
        return
      }
      await invoke('store_iagon_api_key', { apiKey: manualApiKey.trim() })
      setIagonConnected(true)
      setManualApiKey('')
    } catch (err) {
      setIagonError(err instanceof Error ? err.message : 'Failed to save API key')
    } finally {
      setIagonLoading(false)
    }
  }, [manualApiKey])

  const handleDeleteOrphan = useCallback(async (draft: ListingDraft) => {
    if (!draft.iagonFileId) return
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
      setIagonError(err instanceof Error ? err.message : 'Failed to delete file')
    } finally {
      setOrphanCleanupLoading(null)
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
      toast.success('Cleanup Complete', `Deleted ${total} orphaned file${total === 1 ? '' : 's'}.`)
    } else if (succeededIds.length > 0) {
      toast.warning('Partial Cleanup', `Deleted ${succeededIds.length} of ${total} files. ${failedCount} could not be removed.`)
    } else {
      toast.error('Cleanup Failed', 'Could not delete any orphaned files. Check your internet connection.')
    }
  }, [orphanedDrafts, toast])

  return (
    <>
      <div className="space-y-6">
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <h2 className="text-lg font-medium mb-2">Iagon Decentralized Storage</h2>
          <p className="text-sm text-[var(--text-muted)] mb-6">
            Connect your Iagon account to upload and download files for non-text listings.
            Your wallet signature is used for authentication — no passwords needed.
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
                {iagonConnected ? 'Connected' : 'Not Connected'}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                {iagonConnected
                  ? 'API key stored securely. File categories are available.'
                  : 'Connect to enable file uploads (document, audio, image, video).'}
              </p>
            </div>
          </div>

          {/* Account requirement callout */}
          {!iagonConnected && (
            <div className="mb-6 p-3 bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded-[var(--radius-md)]">
              <p className="text-sm text-[var(--text-secondary)]">
                <strong className="text-[var(--accent)]">Before connecting:</strong> You need an Iagon account with active storage.
                Visit{' '}
                <a
                  href="https://app.iagon.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent)] hover:underline"
                >
                  app.iagon.com
                </a>{' '}
                to create one, then return here to connect.
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
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Connecting...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    Connect Iagon
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
                  {iagonLoading ? 'Checking...' : 'Verify Connection'}
                </button>
                <button
                  onClick={() => setIagonDisconnectConfirm(true)}
                  disabled={iagonLoading}
                  className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-destructive"
                >
                  Disconnect
                </button>
              </>
            )}
          </div>

          {/* Requirements info */}
          {walletState !== 'unlocked' && (
            <p className="mt-4 text-xs text-[var(--warning)]">
              Unlock your wallet first to connect to Iagon.
            </p>
          )}
        </div>

        {/* Manual API key input */}
        {!iagonConnected && (
          <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
            <h3 className="text-sm font-medium mb-2">Paste API Key</h3>
            <p className="text-xs text-[var(--text-muted)] mb-3">
              If wallet signing doesn&apos;t work, paste your API key from{' '}
              <a
                href="https://app.iagon.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent)] hover:underline"
              >
                app.iagon.com
              </a>
              {' '}instead.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualApiKey}
                onChange={(e) => setManualApiKey(e.target.value)}
                placeholder="Paste your Iagon API key"
                className="flex-1 px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
              <button
                onClick={handleSaveManualKey}
                disabled={iagonLoading || !manualApiKey.trim()}
                className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
              >
                {iagonLoading ? 'Saving...' : 'Save Key'}
              </button>
            </div>
          </div>
        )}

        {/* Iagon Storage Usage */}
        {iagonConnected && (
          <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-medium">Storage Usage</h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Total encrypted data stored on Iagon across all your files.
                </p>
              </div>
              <button
                onClick={refreshStorageUsage}
                disabled={storageUsageLoading}
                className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] btn-base btn-tertiary"
              >
                {storageUsageLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            {storageUsageLoading && !storageUsage ? (
              <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] py-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Loading usage...
              </div>
            ) : storageUsage ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
                  <p className="text-xs text-[var(--text-muted)] mb-1">Total Used</p>
                  <p className="text-lg font-medium text-[var(--text-primary)]">
                    {formatBytes(storageUsage.totalBytes)}
                  </p>
                </div>
                <div className="p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
                  <p className="text-xs text-[var(--text-muted)] mb-1">Files</p>
                  <p className="text-lg font-medium text-[var(--text-primary)]">
                    {storageUsage.fileCount}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)] text-center py-4">
                Usage unavailable.
              </p>
            )}
          </div>
        )}

        {/* Orphaned Files Cleanup */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-medium">Orphaned Files</h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Files uploaded to Iagon whose listing transactions failed or were abandoned.
              </p>
            </div>
            {orphanedDrafts.length > 1 && (
              <button
                onClick={() => setOrphanDeleteAllConfirm(true)}
                className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] btn-base btn-destructive"
              >
                Delete All
              </button>
            )}
          </div>

          {orphanedDrafts.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-4">
              No orphaned drafts found.
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
                    {orphanCleanupLoading === draft.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info card */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <h3 className="text-sm font-medium mb-3">How it works</h3>
          <div className="space-y-3 text-sm text-[var(--text-secondary)]">
            <div className="flex gap-3">
              <span className="text-[var(--accent)] font-mono text-xs mt-0.5">1</span>
              <p>Your wallet signs a message to authenticate with Iagon (CIP-8).</p>
            </div>
            <div className="flex gap-3">
              <span className="text-[var(--accent)] font-mono text-xs mt-0.5">2</span>
              <p>A persistent API key is generated and stored encrypted on disk.</p>
            </div>
            <div className="flex gap-3">
              <span className="text-[var(--accent)] font-mono text-xs mt-0.5">3</span>
              <p>When you create a file listing, the encrypted file is uploaded to Iagon.</p>
            </div>
            <div className="flex gap-3">
              <span className="text-[var(--accent)] font-mono text-xs mt-0.5">4</span>
              <p>Buyers download and decrypt using their own Iagon connection.</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-[var(--text-muted)]">
            Requires an Iagon account with storage. Visit{' '}
            <a
              href="https://app.iagon.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] hover:underline"
            >
              app.iagon.com
            </a>{' '}
            to create one.
          </p>
        </div>
      </div>

      {/* Iagon Disconnect Confirmation */}
      <ConfirmModal
        isOpen={iagonDisconnectConfirm}
        onClose={() => setIagonDisconnectConfirm(false)}
        onConfirm={() => { setIagonDisconnectConfirm(false); handleDisconnectIagon(); }}
        title="Disconnect Iagon"
        message="This will remove your Iagon API key. You won't be able to upload or download files until you reconnect."
        description="You'll need to re-authenticate with your wallet before uploading files again."
        confirmLabel="Disconnect"
        confirmVariant="danger"
        loading={iagonLoading}
      />

      {/* Orphaned Iagon Files Delete All Confirmation */}
      <ConfirmModal
        isOpen={orphanDeleteAllConfirm}
        onClose={() => setOrphanDeleteAllConfirm(false)}
        onConfirm={() => { setOrphanDeleteAllConfirm(false); handleDeleteAllOrphans(); }}
        title="Delete Orphaned Files"
        message={`Delete all ${orphanedDrafts.length} orphaned file${orphanedDrafts.length !== 1 ? 's' : ''} from Iagon? This cannot be undone.`}
        confirmLabel="Delete All"
        confirmVariant="danger"
      />
    </>
  )
}
