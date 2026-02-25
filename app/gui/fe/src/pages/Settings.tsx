/**
 * Settings Page
 *
 * Network toggle, node status, wallet info, data directory, disk usage,
 * and process logs viewer.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { useWalletContext, useAddress, useLovelace } from '../contexts/WalletContext'
import { getAutolockMinutes, setAutolockMinutes } from '../services/autolock'
import { useNode } from '../contexts/NodeContext'
import { copyToClipboard } from '../utils/clipboard'
import { connectIagon, disconnectIagon, isIagonConnected, getValidApiKey, getStoredApiKey } from '../services/iagonAuth'
import { verifyApiKey, deleteFile as iagonDeleteFile } from '../services/iagonApi'
import { getOrphanedDrafts, removeListingDraft, type ListingDraft } from '../services/listingDraftStorage'
import { getTransactions, clearHistory, clearOlderThan, clearFailed } from '../services/transactionHistory'
import { extractPaymentKeyHash } from '../services/transactionBuilder'
import { listCachedImages, deleteCachedImage, type ImageCacheStatus } from '../services/imageCache'
import { getToastDurationMs, setToastDurationMs, TOAST_DURATION_OPTIONS } from '../services/toastSettings'

interface DiskUsage {
  chain_data_bytes: number
  snark_data_bytes: number
  wallet_bytes: number
  total_bytes: number
  data_dir: string
}

interface ProcessLog {
  name: string
  lines: string[]
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export default function Settings() {
  const navigate = useNavigate()
  const { walletState, lock, wallet } = useWalletContext()
  const address = useAddress()
  const lovelace = useLovelace()
  const { stage, syncProgress, kupoSyncProgress, tipSlot, tipHeight, network, processes } = useNode()

  // Settings state
  const [currentNetwork, setCurrentNetwork] = useState<string>('')
  const [diskUsage, setDiskUsage] = useState<DiskUsage | null>(null)
  const [showMnemonic, setShowMnemonic] = useState(false)
  const [mnemonicWords, setMnemonicWords] = useState<string[]>([])
  const [mnemonicPassword, setMnemonicPassword] = useState('')
  const [mnemonicError, setMnemonicError] = useState('')
  const [mnemonicLoading, setMnemonicLoading] = useState(false)
  const [networkSwitching, setNetworkSwitching] = useState(false)
  const [autolockValue, setAutolockValue] = useState(() => getAutolockMinutes())
  const [toastDuration, setToastDuration] = useState(() => getToastDurationMs())
  const [addressCopied, setAddressCopied] = useState(false)
  const location = useLocation()
  const [activeSection, setActiveSection] = useState<string>(
    (location.state as { section?: string })?.section || 'node'
  )

  // Iagon data layer
  const [iagonConnected, setIagonConnected] = useState(false)
  const [iagonLoading, setIagonLoading] = useState(false)
  const [iagonError, setIagonError] = useState('')
  const [manualApiKey, setManualApiKey] = useState('')

  // Orphaned Iagon files (from failed/abandoned listing drafts)
  const [orphanedDrafts, setOrphanedDrafts] = useState<ListingDraft[]>([])
  const [orphanCleanupLoading, setOrphanCleanupLoading] = useState<string | null>(null)

  // Image cache management
  const [imageCacheStatus, setImageCacheStatus] = useState<ImageCacheStatus | null>(null)
  const [cacheDeleting, setCacheDeleting] = useState<string | null>(null)
  const [cacheClearingAll, setCacheClearingAll] = useState(false)

  // Transaction history cleanup
  const [txHistoryCount, setTxHistoryCount] = useState(0)

  // Derived user PKH for transaction history operations
  const userPkh = useMemo(() => {
    if (!address) return undefined
    try { return extractPaymentKeyHash(address) } catch { return undefined }
  }, [address])

  // Process logs
  const [selectedProcess, setSelectedProcess] = useState<string>('cardano-node')
  const [processLogs, setProcessLogs] = useState<ProcessLog | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)

  // Developer debug mode
  const [debugMode, setDebugMode] = useState(() => localStorage.getItem('veiled_debug_mode') === 'true')
  const [appConfig, setAppConfig] = useState<Record<string, unknown> | null>(null)
  const [localStorageKeys, setLocalStorageKeys] = useState<string[]>([])

  // Load network, disk usage, and Iagon status on mount
  useEffect(() => {
    invoke<string>('get_network').then(setCurrentNetwork).catch(console.error)
    invoke<DiskUsage>('get_disk_usage').then(setDiskUsage).catch(console.error)
    isIagonConnected().then(setIagonConnected).catch(console.error)
  }, [])

  // Load orphaned drafts when datalayer section is active
  useEffect(() => {
    if (activeSection !== 'datalayer') return
    getOrphanedDrafts().then(setOrphanedDrafts).catch(() => {})
  }, [activeSection])

  // Load image cache status and transaction history count when storage section is active
  useEffect(() => {
    if (activeSection === 'storage') {
      listCachedImages().then(setImageCacheStatus).catch(console.error)
      if (userPkh) {
        setTxHistoryCount(getTransactions(userPkh).length)
      }
    }
  }, [activeSection, userPkh])

  // Load debug info when debug mode is active on logs tab
  useEffect(() => {
    if (debugMode && activeSection === 'logs') {
      invoke<Record<string, unknown>>('get_app_config').then(setAppConfig).catch(console.error)
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key) keys.push(key)
      }
      setLocalStorageKeys(keys.sort())
    }
  }, [debugMode, activeSection])

  const handleToggleDebug = useCallback((enabled: boolean) => {
    setDebugMode(enabled)
    localStorage.setItem('veiled_debug_mode', String(enabled))
  }, [])

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
    if (!confirm('Delete all orphaned files from Iagon? This cannot be undone.')) return
    const apiKey = await getStoredApiKey()
    for (const draft of orphanedDrafts) {
      try {
        if (apiKey && draft.iagonFileId) {
          await iagonDeleteFile(apiKey, draft.iagonFileId)
        }
        await removeListingDraft(draft.id)
      } catch {
        // continue with others
      }
    }
    setOrphanedDrafts([])
  }, [orphanedDrafts])

  const handleDeleteCachedImage = useCallback(async (tokenName: string) => {
    setCacheDeleting(tokenName)
    try {
      await deleteCachedImage(tokenName)
      setImageCacheStatus(prev =>
        prev ? { ...prev, cached: prev.cached.filter(t => t !== tokenName) } : prev
      )
    } catch (err) {
      console.error('Failed to delete cached image:', err)
    } finally {
      setCacheDeleting(null)
    }
  }, [])

  const handleClearAllCache = useCallback(async () => {
    if (!imageCacheStatus || !confirm('Clear all cached images? They will be re-downloaded when needed.')) return
    setCacheClearingAll(true)
    try {
      for (const tokenName of imageCacheStatus.cached) {
        await deleteCachedImage(tokenName)
      }
      setImageCacheStatus(prev => prev ? { ...prev, cached: [] } : prev)
    } catch (err) {
      console.error('Failed to clear image cache:', err)
    } finally {
      setCacheClearingAll(false)
    }
  }, [imageCacheStatus])

  const handleNetworkSwitch = useCallback(async (newNetwork: string) => {
    if (newNetwork === currentNetwork) return
    if (!confirm(`Switch to ${newNetwork}? This requires restarting the node and uses a separate chain data directory.`)) return

    setNetworkSwitching(true)
    try {
      await invoke('set_network', { network: newNetwork })
      setCurrentNetwork(newNetwork)
      alert(`Network switched to ${newNetwork}. Please restart the application for changes to take effect.`)
    } catch (error) {
      console.error('Failed to switch network:', error)
      alert(`Failed to switch network: ${error}`)
    } finally {
      setNetworkSwitching(false)
    }
  }, [currentNetwork])

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
  }, [])

  const handleCopyAddress = useCallback(async () => {
    if (!address) return
    const success = await copyToClipboard(address)
    if (success) {
      setAddressCopied(true)
      setTimeout(() => setAddressCopied(false), 2000)
    }
  }, [address])

  const handleFetchLogs = useCallback(async (processName: string) => {
    setLogsLoading(true)
    try {
      const lines = await invoke<string[]>('get_process_logs', {
        processName,
        lines: 200,
      })
      setProcessLogs({ name: processName, lines })
    } catch (error) {
      console.error('Failed to fetch logs:', error)
      setProcessLogs({ name: processName, lines: [`Error: ${error}`] })
    } finally {
      setLogsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeSection === 'logs') {
      handleFetchLogs(selectedProcess)
    }
  }, [activeSection, selectedProcess, handleFetchLogs])

  const formatAda = (lovelaceAmount: string | undefined) => {
    if (!lovelaceAmount) return '...'
    const ada = parseInt(lovelaceAmount) / 1_000_000
    return ada.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const nodeStageLabel = (s: string) => {
    switch (s) {
      case 'synced': return 'Fully Synced'
      case 'syncing': return `Syncing (${syncProgress.toFixed(1)}%)`
      case 'starting': return 'Starting...'
      case 'bootstrapping': return 'Bootstrapping...'
      case 'stopped': return 'Stopped'
      case 'error': return 'Error'
      default: return s
    }
  }

  const stageColor = (s: string) => {
    switch (s) {
      case 'synced': return 'var(--success)'
      case 'syncing': return 'var(--warning)'
      case 'starting':
      case 'bootstrapping': return 'var(--accent)'
      case 'error': return 'var(--error)'
      default: return 'var(--text-muted)'
    }
  }

  const processStatusColor = (status: { type: string }) => {
    switch (status.type) {
      case 'Running':
      case 'Ready': return 'var(--success)'
      case 'Starting':
      case 'Syncing': return 'var(--warning)'
      case 'Error': return 'var(--error)'
      default: return 'var(--text-muted)'
    }
  }

  const sections = [
    { id: 'node', label: 'Node Status' },
    { id: 'wallet', label: 'Wallet' },
    { id: 'network', label: 'Network' },
    { id: 'datalayer', label: 'Data Layer' },
    { id: 'storage', label: 'Storage' },
    { id: 'logs', label: 'Logs' },
  ]

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

  return (
    <div className="min-h-screen">
      {/* Header */}
      <nav className="h-16 border-b border-[var(--border-subtle)] px-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <h1 className="text-lg font-semibold">Settings</h1>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Section Tabs */}
        <div className="border-b border-[var(--border-subtle)] mb-8">
          <div className="flex gap-6">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`pb-3 transition-all duration-150 cursor-pointer ${
                  activeSection === s.id
                    ? 'text-[var(--text-primary)] border-b-2 border-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Node Status Section */}
        {activeSection === 'node' && (
          <div className="space-y-6">
            {/* Overall Status */}
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <h2 className="text-lg font-medium mb-4">Node Infrastructure</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-[var(--text-muted)]">Status</span>
                  <p className="text-lg font-medium flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: stageColor(stage) }}
                    />
                    {nodeStageLabel(stage)}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-[var(--text-muted)]">Network</span>
                  <p className="text-lg font-medium capitalize">{network || currentNetwork || '...'}</p>
                </div>
                {tipSlot !== null && (
                  <div>
                    <span className="text-sm text-[var(--text-muted)]">Tip Slot</span>
                    <p className="text-lg font-mono">{tipSlot?.toLocaleString()}</p>
                  </div>
                )}
                {tipHeight !== null && (
                  <div>
                    <span className="text-sm text-[var(--text-muted)]">Tip Height</span>
                    <p className="text-lg font-mono">{tipHeight?.toLocaleString()}</p>
                  </div>
                )}
              </div>

              {(stage === 'syncing' || stage === 'starting') && (
                <div className="mt-4 space-y-3">
                  <div>
                    <div className="flex justify-between text-sm text-[var(--text-muted)] mb-1">
                      <span>Node Sync</span>
                      <span>{syncProgress >= 99.9 ? 'Synced' : `${syncProgress.toFixed(1)}%`}</span>
                    </div>
                    <div className="w-full h-3 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[var(--accent)] to-[var(--success)] transition-all duration-300"
                        style={{ width: `${Math.min(syncProgress, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm text-[var(--text-muted)] mb-1">
                      <span>Kupo Indexer</span>
                      <span>{kupoSyncProgress >= 99.9 ? 'Synced' : `${kupoSyncProgress.toFixed(1)}%`}</span>
                    </div>
                    <div className="w-full h-3 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[var(--accent)] to-[var(--success)] transition-all duration-300"
                        style={{ width: `${Math.min(kupoSyncProgress, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Process List */}
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <h2 className="text-lg font-medium mb-4">Processes</h2>
              <div className="space-y-3">
                {processes.length === 0 ? (
                  <p className="text-[var(--text-muted)]">No processes registered</p>
                ) : (
                  processes.map((proc) => (
                    <div
                      key={proc.name}
                      className="flex items-center justify-between py-2 border-b border-[var(--border-subtle)] last:border-b-0"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: processStatusColor(proc.status as unknown as { type: string }) }}
                        />
                        <span className="font-mono text-sm">{proc.name}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        {proc.pid && (
                          <span className="text-xs text-[var(--text-muted)] font-mono">PID {proc.pid}</span>
                        )}
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                          {(proc.status as unknown as { type: string }).type}
                        </span>
                        {proc.restart_count > 0 && (
                          <span className="text-xs text-[var(--warning)]">
                            {proc.restart_count} restart{proc.restart_count > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Wallet Section */}
        {activeSection === 'wallet' && (
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
                        className="px-3 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer shrink-0"
                      >
                        {addressCopied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}
                {lovelace && (
                  <div>
                    <span className="text-sm text-[var(--text-muted)]">Balance</span>
                    <p className="text-lg font-medium text-[var(--accent)]">{formatAda(lovelace)} ADA</p>
                  </div>
                )}
              </div>
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
                    className="px-4 py-2 text-sm bg-[var(--warning)] text-black rounded-[var(--radius-md)] hover:bg-[var(--warning)]/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
                  <button
                    onClick={handleHideMnemonic}
                    className="px-4 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer"
                  >
                    Hide Recovery Phrase
                  </button>
                </div>
              )}
            </div>

            {/* Auto-Lock */}
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <h2 className="text-lg font-medium mb-2">Auto-Lock</h2>
              <p className="text-sm text-[var(--text-muted)] mb-4">
                Automatically lock the wallet after a period of inactivity.
              </p>
              <select
                value={autolockValue}
                onChange={(e) => {
                  const mins = Number(e.target.value)
                  setAutolockValue(mins)
                  setAutolockMinutes(mins)
                }}
                className="px-4 py-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
              >
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
                <option value={0}>Never</option>
              </select>
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

            {/* Lock Wallet */}
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <h2 className="text-lg font-medium mb-2">Lock Wallet</h2>
              <p className="text-sm text-[var(--text-muted)] mb-4">
                Lock your wallet to require password entry before using it again.
              </p>
              <button
                onClick={() => { lock(); navigate('/') }}
                className="px-4 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer"
              >
                Lock Wallet
              </button>
            </div>
          </div>
        )}

        {/* Network Section */}
        {activeSection === 'network' && (
          <div className="space-y-6">
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <h2 className="text-lg font-medium mb-2">Network Selection</h2>
              <p className="text-sm text-[var(--text-muted)] mb-6">
                Switching networks requires a full restart. Each network uses a separate chain data directory.
              </p>

              <div className="grid grid-cols-2 gap-4">
                {['preprod', 'mainnet'].map((net) => (
                  <button
                    key={net}
                    onClick={() => handleNetworkSwitch(net)}
                    disabled={networkSwitching}
                    className={`p-4 rounded-[var(--radius-lg)] border-2 transition-all cursor-pointer ${
                      currentNetwork === net
                        ? 'border-[var(--accent)] bg-[var(--accent-muted)]'
                        : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)]'
                    } ${networkSwitching ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <div className="text-left">
                      <h3 className="text-lg font-medium capitalize">{net}</h3>
                      <p className="text-sm text-[var(--text-muted)] mt-1">
                        {net === 'preprod'
                          ? 'Test network (~4GB RAM, ~30GB disk)'
                          : 'Production network (~8GB RAM, ~300GB disk)'}
                      </p>
                      {currentNetwork === net && (
                        <span className="inline-block mt-2 text-xs text-[var(--accent)]">Current</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Storage Section */}
        {activeSection === 'datalayer' && (
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
                    className="px-4 py-2.5 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent)]/90 transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
                      className="px-4 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {iagonLoading ? 'Checking...' : 'Verify Connection'}
                    </button>
                    <button
                      onClick={handleDisconnectIagon}
                      disabled={iagonLoading}
                      className="px-4 py-2 text-sm text-[var(--error)] border border-[var(--error)]/30 rounded-[var(--radius-md)] hover:bg-[var(--error)]/10 transition-colors cursor-pointer disabled:opacity-50"
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
                    className="px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent)]/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {iagonLoading ? 'Saving...' : 'Save Key'}
                  </button>
                </div>
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
                    onClick={handleDeleteAllOrphans}
                    className="px-3 py-1.5 text-xs text-[var(--error)] border border-[var(--error)]/30 rounded-[var(--radius-md)] hover:bg-[var(--error)]/10 transition-colors cursor-pointer"
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
                        className="px-3 py-1.5 text-xs text-[var(--error)] border border-[var(--error)]/30 rounded-[var(--radius-md)] hover:bg-[var(--error)]/10 transition-colors cursor-pointer disabled:opacity-50"
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
        )}

        {activeSection === 'storage' && (
          <div className="space-y-6">
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <h2 className="text-lg font-medium mb-4">Disk Usage</h2>

              {diskUsage ? (
                <div className="space-y-4">
                  <div>
                    <span className="text-sm text-[var(--text-muted)]">Data Directory</span>
                    <code className="block text-sm font-mono mt-1 bg-[var(--bg-secondary)] px-3 py-2 rounded-[var(--radius-md)] break-all">
                      {diskUsage.data_dir}
                    </code>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <div className="p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
                      <span className="text-sm text-[var(--text-muted)]">Chain Data</span>
                      <p className="text-xl font-medium mt-1">{formatBytes(diskUsage.chain_data_bytes)}</p>
                    </div>
                    <div className="p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
                      <span className="text-sm text-[var(--text-muted)]">SNARK Setup</span>
                      <p className="text-xl font-medium mt-1">{formatBytes(diskUsage.snark_data_bytes)}</p>
                    </div>
                    <div className="p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
                      <span className="text-sm text-[var(--text-muted)]">Wallet</span>
                      <p className="text-xl font-medium mt-1">{formatBytes(diskUsage.wallet_bytes)}</p>
                    </div>
                    <div className="p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
                      <span className="text-sm text-[var(--text-muted)]">Total</span>
                      <p className="text-xl font-medium mt-1">{formatBytes(diskUsage.total_bytes)}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => invoke<DiskUsage>('get_disk_usage').then(setDiskUsage).catch(console.error)}
                    className="mt-2 px-4 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer"
                  >
                    Refresh
                  </button>
                </div>
              ) : (
                <p className="text-[var(--text-muted)]">Loading...</p>
              )}
            </div>

            {/* Image Cache */}
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium">Image Cache</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => listCachedImages().then(setImageCacheStatus).catch(console.error)}
                    className="px-3 py-1.5 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer"
                    aria-label="Refresh image cache status"
                  >
                    Refresh
                  </button>
                  {imageCacheStatus && imageCacheStatus.cached.length > 0 && (
                    <button
                      onClick={handleClearAllCache}
                      disabled={cacheClearingAll}
                      className="px-3 py-1.5 text-sm text-[var(--error)] border border-[var(--error)]/30 rounded-[var(--radius-md)] hover:bg-[var(--error)]/10 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {cacheClearingAll ? 'Clearing...' : 'Clear All'}
                    </button>
                  )}
                </div>
              </div>

              {imageCacheStatus ? (
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="p-3 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] flex-1">
                      <span className="text-sm text-[var(--text-muted)]">Cached</span>
                      <p className="text-lg font-medium">{imageCacheStatus.cached.length} image{imageCacheStatus.cached.length !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="p-3 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] flex-1">
                      <span className="text-sm text-[var(--text-muted)]">Banned</span>
                      <p className="text-lg font-medium">{imageCacheStatus.banned.length} image{imageCacheStatus.banned.length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>

                  {imageCacheStatus.cached.length > 0 ? (
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {imageCacheStatus.cached.map(tokenName => (
                        <div key={tokenName} className="flex items-center justify-between py-1.5 px-3 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
                          <code className="text-xs font-mono text-[var(--text-secondary)] truncate mr-3">
                            {tokenName.length > 24 ? `${tokenName.slice(0, 12)}...${tokenName.slice(-12)}` : tokenName}
                          </code>
                          <button
                            onClick={() => handleDeleteCachedImage(tokenName)}
                            disabled={cacheDeleting === tokenName}
                            className="px-2 py-1 text-xs text-[var(--error)] border border-[var(--error)]/30 rounded hover:bg-[var(--error)]/10 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                            aria-label={`Delete cached image ${tokenName}`}
                          >
                            {cacheDeleting === tokenName ? '...' : 'Delete'}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--text-muted)] text-center py-2">No cached images.</p>
                  )}
                </div>
              ) : (
                <p className="text-[var(--text-muted)]">Loading...</p>
              )}
            </div>

            {/* Transaction History */}
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <h2 className="text-lg font-medium mb-2">Transaction History</h2>
              <p className="text-sm text-[var(--text-muted)] mb-4">
                {txHistoryCount} transaction{txHistoryCount !== 1 ? 's' : ''} stored locally.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => {
                    if (!userPkh || !confirm('Clear all transaction history?')) return
                    clearHistory(userPkh)
                    setTxHistoryCount(0)
                  }}
                  disabled={!userPkh || txHistoryCount === 0}
                  className="px-4 py-2 text-sm text-[var(--error)] border border-[var(--error)]/30 rounded-[var(--radius-md)] hover:bg-[var(--error)]/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear All
                </button>
                <button
                  onClick={() => {
                    if (!userPkh) return
                    const removed = clearOlderThan(userPkh, 30)
                    setTxHistoryCount(prev => prev - removed)
                  }}
                  disabled={!userPkh || txHistoryCount === 0}
                  className="px-4 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear Older Than 30 Days
                </button>
                <button
                  onClick={() => {
                    if (!userPkh) return
                    const removed = clearFailed(userPkh)
                    setTxHistoryCount(prev => prev - removed)
                  }}
                  disabled={!userPkh || txHistoryCount === 0}
                  className="px-4 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear Failed Only
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Logs Section */}
        {activeSection === 'logs' && (
          <div className="space-y-6">
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium">Process Logs</h2>
                <button
                  onClick={() => handleFetchLogs(selectedProcess)}
                  disabled={logsLoading}
                  className="px-3 py-1.5 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer disabled:opacity-50"
                >
                  {logsLoading ? 'Loading...' : 'Refresh'}
                </button>
              </div>

              {/* Process Selector */}
              <div className="flex gap-2 mb-4">
                {['cardano-node', 'ogmios', 'kupo', 'express', 'mithril-client'].map((name) => (
                  <button
                    key={name}
                    onClick={() => setSelectedProcess(name)}
                    className={`px-3 py-1.5 text-xs font-mono rounded-[var(--radius-md)] transition-colors cursor-pointer ${
                      selectedProcess === name
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>

              {/* Log Output */}
              <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-4 font-mono text-xs max-h-96 overflow-y-auto">
                {processLogs?.lines.length ? (
                  processLogs.lines.map((line, i) => (
                    <div
                      key={i}
                      className={`py-0.5 break-all ${
                        line.startsWith('[stderr]')
                          ? 'text-[var(--warning)]'
                          : 'text-[var(--text-secondary)]'
                      }`}
                    >
                      {line}
                    </div>
                  ))
                ) : (
                  <p className="text-[var(--text-muted)]">
                    {logsLoading ? 'Loading logs...' : 'No logs available'}
                  </p>
                )}
              </div>
            </div>

            {/* Developer Mode */}
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-medium">Developer Mode</h2>
                  <p className="text-sm text-[var(--text-muted)]">
                    Show detailed runtime information for debugging.
                  </p>
                </div>
                <button
                  onClick={() => handleToggleDebug(!debugMode)}
                  className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer ${
                    debugMode ? 'bg-[var(--accent)]' : 'bg-[var(--bg-secondary)] border border-[var(--border-subtle)]'
                  }`}
                  role="switch"
                  aria-checked={debugMode}
                  aria-label="Toggle developer mode"
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    debugMode ? 'translate-x-6' : 'translate-x-0'
                  }`} />
                </button>
              </div>

              {debugMode && (
                <div className="space-y-4 mt-4 pt-4 border-t border-[var(--border-subtle)]">
                  {/* App Config */}
                  <div>
                    <h3 className="text-sm font-medium mb-2">App Configuration</h3>
                    <pre className="text-xs font-mono bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-3 max-h-48 overflow-auto text-[var(--text-secondary)]">
                      {appConfig ? JSON.stringify(appConfig, null, 2) : 'Loading...'}
                    </pre>
                  </div>

                  {/* Process PIDs */}
                  <div>
                    <h3 className="text-sm font-medium mb-2">Process PIDs</h3>
                    <div className="grid grid-cols-3 gap-2">
                      {processes.map(proc => (
                        <div key={proc.name} className="p-2 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
                          <span className="text-xs text-[var(--text-muted)]">{proc.name}</span>
                          <p className="text-sm font-mono">{proc.pid || 'N/A'}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* localStorage Keys */}
                  <div>
                    <h3 className="text-sm font-medium mb-2">LocalStorage Keys ({localStorageKeys.length})</h3>
                    <div className="max-h-48 overflow-y-auto bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-3">
                      {localStorageKeys.length > 0 ? (
                        localStorageKeys.map(key => (
                          <div key={key} className="text-xs font-mono text-[var(--text-secondary)] py-0.5">
                            {key}
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-[var(--text-muted)]">No keys found</p>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => window.location.reload()}
                      className="px-4 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer"
                    >
                      Force Refresh
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
