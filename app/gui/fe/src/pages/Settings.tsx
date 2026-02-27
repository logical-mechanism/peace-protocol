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
import { getTransactions, addTransaction, clearHistory, clearOlderThan, clearFailed } from '../services/transactionHistory'
import { setLastActiveTab } from '../services/tabStorage'
import { extractPaymentKeyHash } from '../services/transactionBuilder'
import { listCachedImages, deleteCachedImage, type ImageCacheStatus } from '../services/imageCache'
import { getToastDurationMs, setToastDurationMs, TOAST_DURATION_OPTIONS } from '../services/toastSettings'
import { apiCache } from '../services/apiCache'
import { isSoundEnabled, setSoundEnabled, getSoundVolume, setSoundVolume, playNotificationSound } from '../services/notificationSound'
import { isDesktopNotificationsEnabled, setDesktopNotificationsEnabled, sendDesktopNotification } from '../services/desktopNotifications'
import { getTheme, setTheme, applyTheme, type Theme } from '../services/themeStorage'
import { getLogLineClass } from '../utils/logClassification'
import { formatBytes } from '../utils/formatBytes'
import { formatAdaDisplay } from '../utils/formatAda'
import ConfirmModal from '../components/ConfirmModal'
import InfoTooltip from '../components/InfoTooltip'
import { useToast, ToastContainer } from '../components/Toast'
import { useWalletHealth } from '../hooks/useWalletHealth'
import { createCollateral, defragWallet, previewDefrag, type DefragPreview } from '../services/walletManagement'

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

export default function Settings() {
  const navigate = useNavigate()
  const { walletState, lock, wallet } = useWalletContext()
  const address = useAddress()
  const lovelace = useLovelace()
  const { stage, syncProgress, kupoSyncProgress, tipSlot, tipHeight, network, processes, stopNode } = useNode()

  // Settings state
  const [currentNetwork, setCurrentNetwork] = useState<string>('')
  const [diskUsage, setDiskUsage] = useState<DiskUsage | null>(null)
  const [showMnemonic, setShowMnemonic] = useState(false)
  const [mnemonicWords, setMnemonicWords] = useState<string[]>([])
  const [mnemonicPassword, setMnemonicPassword] = useState('')
  const [mnemonicError, setMnemonicError] = useState('')
  const [mnemonicLoading, setMnemonicLoading] = useState(false)
  const [mnemonicCopied, setMnemonicCopied] = useState(false)
  const [networkSwitching, setNetworkSwitching] = useState(false)
  const [networkConfirmTarget, setNetworkConfirmTarget] = useState<string | null>(null)
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => getTheme())
  const [autolockValue, setAutolockValue] = useState(() => getAutolockMinutes())
  const [toastDuration, setToastDuration] = useState(() => getToastDurationMs())
  const [soundEnabled, setSoundEnabledState] = useState(() => isSoundEnabled())
  const [soundVolume, setSoundVolumeState] = useState(() => getSoundVolume())
  const [desktopNotifEnabled, setDesktopNotifEnabledState] = useState(() => isDesktopNotificationsEnabled())
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
  const [cacheConfirmClearAll, setCacheConfirmClearAll] = useState(false)

  // Transaction history cleanup
  const [txHistoryCount, setTxHistoryCount] = useState(0)

  // API response cache
  const [apiCacheSize, setApiCacheSize] = useState(0)

  // Wallet management (collateral / defrag)
  const toast = useToast()
  const walletHealth = useWalletHealth(wallet, tipSlot, stage)
  const [collateralLoading, setCollateralLoading] = useState(false)
  const [defragLoading, setDefragLoading] = useState(false)
  const [defragPreview, setDefragPreview] = useState<DefragPreview | null>(null)
  const [defragPreviewLoading, setDefragPreviewLoading] = useState(false)
  const [walletConfirmAction, setWalletConfirmAction] = useState<'collateral' | 'defrag' | null>(null)

  // Derived user PKH for transaction history operations
  const userPkh = useMemo(() => {
    if (!address) return undefined
    try { return extractPaymentKeyHash(address) } catch { return undefined }
  }, [address])

  // Process logs
  const [selectedProcess, setSelectedProcess] = useState<string>('cardano-node')
  const [processLogs, setProcessLogs] = useState<ProcessLog | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)
  const [logSearchQuery, setLogSearchQuery] = useState('')

  const filteredLogLines = useMemo(() => {
    if (!processLogs?.lines.length) return []
    if (!logSearchQuery.trim()) return processLogs.lines
    const query = logSearchQuery.toLowerCase()
    return processLogs.lines.filter(line => line.toLowerCase().includes(query))
  }, [processLogs, logSearchQuery])

  // Developer debug mode
  const [debugMode, setDebugMode] = useState(() => localStorage.getItem('veiled_debug_mode') === 'true')
  const [appConfig, setAppConfig] = useState<Record<string, unknown> | null>(null)
  const [localStorageKeys, setLocalStorageKeys] = useState<string[]>([])

  // Settings search
  const [searchQuery, setSearchQuery] = useState('')

  // Load network, disk usage, and Iagon status on mount
  useEffect(() => {
    invoke<string>('get_network').then(setCurrentNetwork).catch(console.error)
    invoke<DiskUsage>('get_disk_usage').then(setDiskUsage).catch(console.error)
    isIagonConnected().then(setIagonConnected).catch(console.error)
  }, [])

  // Load orphaned drafts when datalayer section is active
  useEffect(() => {
    if (activeSection !== 'datalayer') return
    getOrphanedDrafts().then(setOrphanedDrafts).catch((err) => console.warn('Failed to load orphaned drafts:', err))
  }, [activeSection])

  // Load image cache status, API cache size, and transaction history count when storage section is active
  useEffect(() => {
    if (activeSection === 'storage') {
      listCachedImages().then(setImageCacheStatus).catch(console.error)
      setApiCacheSize(apiCache.size)
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

  const handleDeleteCachedImage = useCallback(async (tokenName: string) => {
    setCacheDeleting(tokenName)
    try {
      await deleteCachedImage(tokenName)
      const updated = await listCachedImages()
      setImageCacheStatus(updated)
    } catch (err) {
      console.error('Failed to delete cached image:', err)
    } finally {
      setCacheDeleting(null)
    }
  }, [])

  const handleClearAllCache = useCallback(async () => {
    if (!imageCacheStatus) return
    setCacheConfirmClearAll(false)
    setCacheClearingAll(true)
    try {
      for (const tokenName of imageCacheStatus.cached) {
        await deleteCachedImage(tokenName)
      }
      setImageCacheStatus(prev => prev ? { ...prev, cached: [], total_bytes: 0 } : prev)
    } catch (err) {
      console.error('Failed to clear image cache:', err)
    } finally {
      setCacheClearingAll(false)
    }
  }, [imageCacheStatus])

  const handleNetworkSwitch = useCallback(async () => {
    if (!networkConfirmTarget || networkConfirmTarget === currentNetwork) return

    setNetworkSwitching(true)
    try {
      await invoke('set_network', { network: networkConfirmTarget })
      setCurrentNetwork(networkConfirmTarget)
      setNetworkConfirmTarget(null)
      toast.success(
        `Network switched to ${networkConfirmTarget}`,
        'Please restart the application for changes to take effect.',
        0,
        { label: 'Stop Node', onClick: () => { stopNode() } }
      )
    } catch (error) {
      console.error('Failed to switch network:', error)
      toast.error('Network switch failed', `${error}`)
    } finally {
      setNetworkSwitching(false)
    }
  }, [currentNetwork, networkConfirmTarget, toast, stopNode])

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

  const sectionGroups = [
    { label: 'Node & Network', sections: [
      { id: 'node', label: 'Node Status', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
        </svg>
      )},
      { id: 'network', label: 'Network', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A9 9 0 013 12c0-1.605.42-3.113 1.157-4.418" />
        </svg>
      )},
      { id: 'logs', label: 'Logs', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
        </svg>
      )},
    ]},
    { label: 'Wallet & Security', sections: [
      { id: 'wallet', label: 'Wallet', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 110-6h5.25A2.25 2.25 0 0121 6v6zm0 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18V6a2.25 2.25 0 012.25-2.25h13.5" />
        </svg>
      )},
    ]},
    { label: 'Storage & Data', sections: [
      { id: 'datalayer', label: 'Data Layer', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
        </svg>
      )},
      { id: 'storage', label: 'Storage', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
        </svg>
      )},
    ]},
  ]

  const searchableSections = useMemo(() => [
    { tab: 'node', title: 'Node Infrastructure', keywords: ['node', 'sync', 'status', 'tip', 'slot', 'height', 'infrastructure'] },
    { tab: 'node', title: 'Processes', keywords: ['process', 'pid', 'restart', 'ogmios', 'kupo', 'express', 'cardano', 'mithril'] },
    { tab: 'wallet', title: 'Wallet Info', keywords: ['wallet', 'address', 'balance', 'ada'] },
    { tab: 'wallet', title: 'Wallet Management', keywords: ['wallet', 'collateral', 'defrag', 'optimize', 'utxo', 'fragment', 'consolidate'] },
    { tab: 'wallet', title: 'Recovery Phrase', keywords: ['recovery', 'phrase', 'mnemonic', 'seed', 'backup'] },
    { tab: 'wallet', title: 'Theme', keywords: ['theme', 'dark', 'light', 'mode', 'appearance', 'color'] },
    { tab: 'wallet', title: 'Auto-Lock', keywords: ['auto', 'lock', 'timeout', 'inactivity', 'security'] },
    { tab: 'wallet', title: 'Notification Duration', keywords: ['toast', 'notification', 'duration', 'dismiss', 'alert'] },
    { tab: 'wallet', title: 'Desktop Notifications', keywords: ['desktop', 'notification', 'system', 'os', 'bid', 'alert'] },
    { tab: 'wallet', title: 'Notification Sound', keywords: ['sound', 'notification', 'audio', 'volume', 'alert', 'ping'] },
    { tab: 'wallet', title: 'Lock Wallet', keywords: ['lock', 'wallet', 'password'] },
    { tab: 'network', title: 'Network Selection', keywords: ['network', 'preprod', 'mainnet', 'switch', 'restart'] },
    { tab: 'datalayer', title: 'Iagon Decentralized Storage', keywords: ['iagon', 'storage', 'decentralized', 'api', 'key', 'upload', 'download', 'file', 'connect'] },
    { tab: 'datalayer', title: 'Orphaned Files', keywords: ['orphan', 'draft', 'cleanup', 'iagon', 'abandoned'] },
    { tab: 'storage', title: 'Disk Usage', keywords: ['disk', 'storage', 'space', 'chain', 'data', 'snark', 'size'] },
    { tab: 'storage', title: 'Image Cache', keywords: ['image', 'cache', 'clear', 'cached', 'thumbnail'] },
    { tab: 'storage', title: 'API Response Cache', keywords: ['api', 'cache', 'response', 'clear', 'memory'] },
    { tab: 'storage', title: 'Transaction History', keywords: ['transaction', 'history', 'clear', 'cleanup', 'failed'] },
    { tab: 'logs', title: 'Process Logs', keywords: ['log', 'logs', 'process', 'stdout', 'stderr'] },
    { tab: 'logs', title: 'Developer Mode', keywords: ['debug', 'developer', 'config', 'localstorage', 'advanced'] },
  ], [])

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null
    const q = searchQuery.toLowerCase()
    return searchableSections.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.keywords.some(k => k.includes(q))
    )
  }, [searchQuery, searchableSections])

  // Load defrag preview when wallet section is active
  useEffect(() => {
    if (activeSection !== 'wallet' || stage !== 'synced' || !wallet) return
    let cancelled = false
    setDefragPreviewLoading(true)
    previewDefrag(wallet)
      .then((preview) => { if (!cancelled) setDefragPreview(preview) })
      .catch((err) => console.warn('Defrag preview failed:', err))
      .finally(() => { if (!cancelled) setDefragPreviewLoading(false) })
    return () => { cancelled = true }
  }, [activeSection, stage, wallet])

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
            className="flex items-center gap-2 btn-base btn-icon"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <h1 className="text-lg font-semibold">Settings</h1>
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search settings..."
          className="px-3 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] w-48"
          aria-label="Search settings"
        />
      </nav>

      <div className="flex min-h-[calc(100vh-4rem)]">
        {/* Sidebar */}
        <aside className="w-52 shrink-0 border-r border-[var(--border-subtle)] px-3 py-6 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto">
          <nav>
            {sectionGroups.map((group, groupIndex) => (
              <div key={group.label} className={groupIndex > 0 ? 'mt-6' : ''}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2 px-3">
                  {group.label}
                </h3>
                <div className="space-y-1">
                  {group.sections.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setActiveSection(s.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer ${
                        activeSection === s.id
                          ? 'bg-[var(--accent-muted)] text-[var(--text-primary)] border-l-2 border-[var(--accent)] ml-[-1px]'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
                      }`}
                    >
                      {s.icon}
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main id="main-content" className="flex-1 max-w-4xl px-8 py-8">

        {/* Search Results */}
        {searchResults && (
          <div className="mb-8 space-y-2">
            <p className="text-sm text-[var(--text-muted)] mb-3">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for &ldquo;{searchQuery}&rdquo;
            </p>
            {searchResults.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] text-center py-4">No matching settings found.</p>
            ) : (
              searchResults.map(s => (
                <button
                  key={`${s.tab}-${s.title}`}
                  onClick={() => { setActiveSection(s.tab); setSearchQuery('') }}
                  className="block w-full text-left px-4 py-3 bg-[var(--bg-card)] rounded-[var(--radius-md)] btn-base btn-tertiary"
                >
                  <span className="text-sm font-medium">{s.title}</span>
                  <span className="text-xs text-[var(--text-muted)] ml-2">
                    in {sections.find(sec => sec.id === s.tab)?.label}
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        {/* Node Status Section */}
        {!searchResults && activeSection === 'node' && (
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
        {!searchResults && activeSection === 'wallet' && (
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
        )}

        {/* Network Section */}
        {!searchResults && activeSection === 'network' && (
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
                    onClick={() => net !== currentNetwork && setNetworkConfirmTarget(net)}
                    disabled={networkSwitching || net === currentNetwork}
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
        {!searchResults && activeSection === 'datalayer' && (
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
                      onClick={handleDisconnectIagon}
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
        )}

        {!searchResults && activeSection === 'storage' && (
          <div className="space-y-6">
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <h2 className="text-lg font-medium mb-4">Disk Usage</h2>

              {diskUsage ? (
                (() => {
                  const otherBytes = Math.max(0, diskUsage.total_bytes - diskUsage.chain_data_bytes - diskUsage.snark_data_bytes - diskUsage.wallet_bytes)
                  const segments = [
                    { label: 'Chain Data', bytes: diskUsage.chain_data_bytes, color: 'var(--accent)' },
                    { label: 'SNARK Setup', bytes: diskUsage.snark_data_bytes, color: 'var(--warning)' },
                    { label: 'Wallet', bytes: diskUsage.wallet_bytes, color: 'var(--success)' },
                    ...(otherBytes > 0 ? [{ label: 'Other', bytes: otherBytes, color: 'var(--text-muted)' }] : []),
                  ]
                  const total = diskUsage.total_bytes || 1
                  return (
                    <div className="space-y-4">
                      <div>
                        <span className="text-sm text-[var(--text-muted)]">Data Directory</span>
                        <code className="block text-sm font-mono mt-1 bg-[var(--bg-secondary)] px-3 py-2 rounded-[var(--radius-md)] break-all">
                          {diskUsage.data_dir}
                        </code>
                      </div>

                      {/* Stacked bar chart */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-[var(--text-muted)]">Usage Breakdown</span>
                          <span className="text-sm font-medium">{formatBytes(diskUsage.total_bytes)}</span>
                        </div>
                        <div className="h-6 rounded-full overflow-hidden flex bg-[var(--bg-secondary)]">
                          {segments.map((seg) => {
                            const pct = (seg.bytes / total) * 100
                            if (pct < 0.5) return null
                            return (
                              <div
                                key={seg.label}
                                className="h-full transition-all duration-300"
                                style={{ width: `${pct}%`, backgroundColor: seg.color }}
                                title={`${seg.label}: ${formatBytes(seg.bytes)} (${pct.toFixed(1)}%)`}
                              />
                            )
                          })}
                        </div>
                      </div>

                      {/* Legend */}
                      <div className="grid grid-cols-2 gap-3">
                        {segments.map((seg) => (
                          <div key={seg.label} className="flex items-center gap-2">
                            <span
                              className="w-3 h-3 rounded-sm shrink-0"
                              style={{ backgroundColor: seg.color }}
                            />
                            <span className="text-sm text-[var(--text-muted)]">{seg.label}</span>
                            <span className="text-sm font-medium ml-auto">{formatBytes(seg.bytes)}</span>
                          </div>
                        ))}
                      </div>

                      <button
                        onClick={() => invoke<DiskUsage>('get_disk_usage').then(setDiskUsage).catch(console.error)}
                        className="mt-2 px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
                      >
                        Refresh
                      </button>
                    </div>
                  )
                })()
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
                    className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
                    aria-label="Refresh image cache status"
                  >
                    Refresh
                  </button>
                  {imageCacheStatus && imageCacheStatus.cached.length > 0 && (
                    <button
                      onClick={() => setCacheConfirmClearAll(true)}
                      disabled={cacheClearingAll}
                      className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] btn-base btn-destructive"
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
                      {imageCacheStatus.total_bytes > 0 && (
                        <p className="text-sm text-[var(--text-muted)]">{formatBytes(imageCacheStatus.total_bytes)}</p>
                      )}
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
                            className="px-2 py-1 text-xs rounded shrink-0 btn-base btn-destructive"
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

            {/* API Response Cache */}
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-medium">API Response Cache</h2>
                <button
                  onClick={() => {
                    apiCache.clear()
                    setApiCacheSize(0)
                  }}
                  disabled={apiCacheSize === 0}
                  className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] btn-base btn-destructive"
                >
                  Clear
                </button>
              </div>
              <p className="text-sm text-[var(--text-muted)]">
                {apiCacheSize} cached response{apiCacheSize !== 1 ? 's' : ''} (in-memory, auto-expires after 15s).
              </p>
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
                  className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-destructive"
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
                  className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
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
                  className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
                >
                  Clear Failed Only
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Logs Section */}
        {!searchResults && activeSection === 'logs' && (
          <div className="space-y-6">
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium">Process Logs</h2>
                <button
                  onClick={() => handleFetchLogs(selectedProcess)}
                  disabled={logsLoading}
                  className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
                >
                  {logsLoading ? 'Loading...' : 'Refresh'}
                </button>
              </div>

              {/* Process Selector */}
              <div className="flex gap-2 mb-4">
                {['cardano-node', 'ogmios', 'kupo', 'express', 'mithril-client'].map((name) => (
                  <button
                    key={name}
                    onClick={() => { setSelectedProcess(name); setLogSearchQuery('') }}
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

              {/* Log Search */}
              <div className="mb-4">
                <input
                  type="text"
                  value={logSearchQuery}
                  onChange={(e) => setLogSearchQuery(e.target.value)}
                  placeholder="Search logs..."
                  className="w-full px-3 py-2 text-sm font-mono bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                />
                {logSearchQuery && (
                  <div className="mt-1 text-xs text-[var(--text-muted)]">
                    {filteredLogLines.length} of {processLogs?.lines.length ?? 0} lines match
                  </div>
                )}
              </div>

              {/* Log Output */}
              <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-4 font-mono text-xs max-h-96 overflow-y-auto">
                {filteredLogLines.length ? (
                  filteredLogLines.map((line, i) => (
                    <div
                      key={i}
                      className={`py-0.5 break-all ${getLogLineClass(line)}`}
                    >
                      {line}
                    </div>
                  ))
                ) : logsLoading ? (
                  <div className="space-y-2">
                    <div className="h-3 w-4/5 rounded skeleton-shimmer" />
                    <div className="h-3 w-3/5 rounded skeleton-shimmer" />
                    <div className="h-3 w-full rounded skeleton-shimmer" />
                    <div className="h-3 w-2/3 rounded skeleton-shimmer" />
                    <div className="h-3 w-3/4 rounded skeleton-shimmer" />
                  </div>
                ) : (
                  <p className="text-[var(--text-muted)]">
                    {logSearchQuery ? 'No matching lines' : 'No logs available'}
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
                      className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
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

      {/* Network Switch Confirmation */}
      <ConfirmModal
        isOpen={networkConfirmTarget !== null}
        onClose={() => setNetworkConfirmTarget(null)}
        onConfirm={handleNetworkSwitch}
        title="Switch Network"
        message={`Switching to ${networkConfirmTarget} will restart all node services. This may take several minutes to sync. Any pending operations will be interrupted.`}
        description="Each network uses its own chain data directory. Your wallet and settings are preserved."
        confirmLabel="Switch Network"
        confirmVariant="default"
        loading={networkSwitching}
      />

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

      {/* Image Cache Clear Confirmation */}
      <ConfirmModal
        isOpen={cacheConfirmClearAll}
        onClose={() => setCacheConfirmClearAll(false)}
        onConfirm={handleClearAllCache}
        title="Clear Image Cache"
        message={`Delete all ${imageCacheStatus?.cached.length ?? 0} cached image${(imageCacheStatus?.cached.length ?? 0) !== 1 ? 's' : ''}${imageCacheStatus?.total_bytes ? ` (${formatBytes(imageCacheStatus.total_bytes)})` : ''}? They will be re-downloaded when needed.`}
        confirmLabel="Clear Cache"
        confirmVariant="danger"
        loading={cacheClearingAll}
      />

      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} queuedCount={toast.queuedCount} onDismissAll={toast.dismissAll} />
    </div>
  )
}
