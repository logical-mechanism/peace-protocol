import { useTranslation } from 'react-i18next'
import { useWalletContext, useAddress, useLovelace } from '../contexts/WalletContext'
import { useState, useCallback, useEffect, useMemo, useRef, useReducer, lazy, Suspense, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useWasm } from '../contexts/WasmContext'
import { useNode } from '../contexts/NodeContext'
import { useModal } from '../contexts/ModalContext'
import { copyToClipboard } from '../utils/clipboard'
import { truncateHex } from '../utils/truncate'
import { formatAdaDisplay } from '../utils/formatAda'
const MarketplaceTab = lazy(() => import('../components/MarketplaceTab'))
const MySalesTab = lazy(() => import('../components/MySalesTab'))
const MyPurchasesTab = lazy(() => import('../components/MyPurchasesTab'))
const HistoryTab = lazy(() => import('../components/HistoryTab'))
const LibraryTab = lazy(() => import('../components/LibraryTab'))
import { SkeletonGrid } from '../components/SkeletonCard'
import LoadingSpinner from '../components/LoadingSpinner'
import ScrollToTop from '../components/ScrollToTop'
import KeyboardShortcutsOverlay from '../components/KeyboardShortcutsOverlay'
import CommandPalette from '../components/CommandPalette'
import { getTheme, setTheme, applyTheme, resolveTheme } from '../services/themeStorage'
import CreateListingModal from '../components/CreateListingModal'
import ImportListingModal from '../components/ImportListingModal'
import PlaceBidModal from '../components/PlaceBidModal'
import DecryptModal from '../components/DecryptModal'
import ConfirmModal from '../components/ConfirmModal'
import UpdatePriceModal from '../components/UpdatePriceModal'
import UpdateBidModal from '../components/UpdateBidModal'
import { useToast, ToastContainer } from '../components/Toast'
import { extractPaymentKeyHash } from '../services/transactionBuilder'
import { getLastActiveTab, setLastActiveTab, clearLastActiveTab } from '../services/tabStorage'
import { useDataRefresh } from '../hooks/useDataRefresh'
import { useUpdate } from '../contexts/UpdateContext'
import { useWalletHealth } from '../hooks/useWalletHealth'
import {
  marketplaceReducer, MARKETPLACE_INITIAL,
  mySalesReducer, MY_SALES_INITIAL,
  myPurchasesReducer, MY_PURCHASES_INITIAL,
  historyReducer, HISTORY_INITIAL,
  libraryReducer, LIBRARY_INITIAL,
} from '../hooks/useTabFilterState'
import { TABS, type TabId, type ConfirmAction } from './dashboard/dashboardTypes'
import { useSellerActions } from './dashboard/useSellerActions'
import { useBuyerActions } from './dashboard/useBuyerActions'
import { useDashboardEffects } from './dashboard/useDashboardEffects'
import { useAcceptBidQueue } from '../contexts/AcceptBidQueueContext'
import { useTutorial } from '../hooks/useTutorial'
import TutorialOverlay from '../components/TutorialOverlay'
import { LISTING_TUTORIAL_STEPS } from '../tutorials/listingTutorial'
import { BID_TUTORIAL_STEPS } from '../tutorials/bidTutorial'
import { DECRYPT_TUTORIAL_STEPS } from '../tutorials/decryptTutorial'
import { FIRST_BID_ACCEPTED_TUTORIAL_STEPS, queueStateToTourStep } from '../tutorials/firstBidAcceptedTutorial'
import {
  markFirstListingCompleted,
  markFirstBidCompleted,
  markFirstDecryptCompleted,
  markFirstBidAcceptedCompleted,
} from '../services/onboardingStorage'
import type { EncryptionDisplay } from '../services/api'
import type { DecryptTutorialTarget } from '../components/MyPurchasesTab'

export type { TabId } from './dashboard/dashboardTypes'

export default function Dashboard() {
  const { t } = useTranslation(['notifications', 'dashboard'])
  const { disconnect, wallet, refreshBalance } = useWalletContext()
  const address = useAddress()
  const lovelace = useLovelace()
  const { isReady: wasmReady, isLoading: wasmLoading, progress: wasmProgress } = useWasm()
  const { stage: nodeStage, syncProgress: nodeSyncProgress, kupoSyncProgress, tipSlot, tipHeight, expressReady } = useNode()
  const navigate = useNavigate()
  const location = useLocation()
  const { hasOpenModal } = useModal()
  const walletHealth = useWalletHealth(wallet, tipSlot, nodeStage)
  const [copied, setCopied] = useState(false)
  const [createListingDropdownOpen, setCreateListingDropdownOpen] = useState(false)
  const createListingDropdownRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTabRaw] = useState<TabId>(() => getLastActiveTab())
  const [visitedTabs, setVisitedTabs] = useState<Set<TabId>>(() => new Set([getLastActiveTab()]))
  const setActiveTab = useCallback((tab: TabId) => {
    setActiveTabRaw(tab)
    setLastActiveTab(tab)
    setVisitedTabs(prev => {
      if (prev.has(tab)) return prev
      return new Set(prev).add(tab)
    })
  }, [])
  // Preload all tab chunks after initial render to eliminate first-switch loading flash
  useEffect(() => {
    const timer = setTimeout(() => {
      const preload = () => {
        import('../components/MarketplaceTab')
        import('../components/MySalesTab')
        import('../components/MyPurchasesTab')
        import('../components/HistoryTab')
        import('../components/LibraryTab')
      }
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(preload)
      } else {
        preload()
      }
    }, 2000)
    return () => clearTimeout(timer)
  }, [])
  const tabListRef = useRef<HTMLDivElement>(null)
  const handleTabKeyDown = useCallback((e: ReactKeyboardEvent) => {
    const tabIds = TABS.map(t => t.id)
    const currentIndex = tabIds.indexOf(activeTab)
    let nextIndex: number | null = null
    if (e.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabIds.length
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabIds.length) % tabIds.length
    } else if (e.key === 'Home') {
      nextIndex = 0
    } else if (e.key === 'End') {
      nextIndex = tabIds.length - 1
    }
    if (nextIndex !== null) {
      e.preventDefault()
      setActiveTab(tabIds[nextIndex])
      const nextButton = tabListRef.current?.querySelector(`#tab-${tabIds[nextIndex]}`) as HTMLElement
      nextButton?.focus()
    }
  }, [activeTab, setActiveTab])
  // Tab filter state (persisted across tab switches via useReducer at Dashboard level)
  const [marketplaceFilters, marketplaceDispatch] = useReducer(marketplaceReducer, MARKETPLACE_INITIAL)
  const [mySalesFilters, mySalesDispatch] = useReducer(mySalesReducer, MY_SALES_INITIAL)
  const [myPurchasesFilters, myPurchasesDispatch] = useReducer(myPurchasesReducer, MY_PURCHASES_INITIAL)
  const [historyFilters, historyDispatch] = useReducer(historyReducer, HISTORY_INITIAL)
  const [libraryFilters, libraryDispatch] = useReducer(libraryReducer, LIBRARY_INITIAL)

  // ── Tutorial hook ─────────────────────────────────────────────────
  const tutorial = useTutorial()
  // Which tutorial is currently running — disambiguates the auto-open effects
  // so e.g. the listing-tutorial effect doesn't fire during a bid-tutorial run.
  const [activeTutorialKey, setActiveTutorialKey] = useState<'listing' | 'bid' | 'decrypt' | 'first-bid-accepted' | null>(null)
  // Encryption the bid tutorial should target; used by the auto-open effect below.
  const [bidTutorialTarget, setBidTutorialTarget] = useState<{ encryption: EncryptionDisplay; bidCount: number } | null>(null)
  // Target the decrypt tutorial should drive; used by the orchestration effect below.
  const [decryptTutorialTarget, setDecryptTutorialTarget] = useState<DecryptTutorialTarget | null>(null)
  // Auto-start signal sent to MyPurchasesTab — e.g. when the user hits "Replay"
  // in Settings. MyPurchasesTab picks the first eligible target and calls back
  // via onStartDecryptTutorial; we then clear this flag.
  const [autoStartDecryptTutorial, setAutoStartDecryptTutorial] = useState(false)

  const handleStartListingTutorial = useCallback(() => {
    setActiveTutorialKey('listing')
    tutorial.startTutorial(
      LISTING_TUTORIAL_STEPS.map(step => ({
        ...step,
        title: t(`common:${step.title}`),
        description: t(`common:${step.description}`),
      })),
      {
        onComplete: () => { markFirstListingCompleted(); setActiveTutorialKey(null) },
        onSkip: () => { markFirstListingCompleted(); setActiveTutorialKey(null) },
      },
    )
  }, [tutorial, t])

  const handleStartBidTutorial = useCallback((encryption: EncryptionDisplay, bidCount: number) => {
    setActiveTutorialKey('bid')
    setBidTutorialTarget({ encryption, bidCount })
    tutorial.startTutorial(
      BID_TUTORIAL_STEPS.map(step => ({
        ...step,
        title: t(`common:${step.title}`),
        description: t(`common:${step.description}`),
      })),
      {
        onComplete: () => {
          markFirstBidCompleted()
          setActiveTutorialKey(null)
          setBidTutorialTarget(null)
        },
        onSkip: () => {
          markFirstBidCompleted()
          setActiveTutorialKey(null)
          setBidTutorialTarget(null)
        },
      },
    )
  }, [tutorial, t])

  const handleStartDecryptTutorial = useCallback((target: DecryptTutorialTarget) => {
    setActiveTutorialKey('decrypt')
    setDecryptTutorialTarget(target)
    setActiveTab('my-purchases')
    tutorial.startTutorial(
      DECRYPT_TUTORIAL_STEPS.map(step => ({
        ...step,
        title: t(`common:${step.title}`),
        description: t(`common:${step.description}`),
      })),
      {
        onComplete: () => {
          markFirstDecryptCompleted()
          setActiveTutorialKey(null)
          setDecryptTutorialTarget(null)
        },
        onSkip: () => {
          markFirstDecryptCompleted()
          setActiveTutorialKey(null)
          setDecryptTutorialTarget(null)
        },
      },
    )
  }, [tutorial, t, setActiveTab])

  // First-bid-accepted (seller) tour — event-driven. Steps advance as the
  // accept-bid queue state machine transitions; users don't click Next.
  // `startStep` lets callers join mid-flow (e.g. the auto-trigger kicks in
  // after the user has already clicked Accept, so it skips the step-1 anchor).
  const handleStartFirstBidAcceptedTutorial = useCallback((options?: { startStep?: number }) => {
    setActiveTutorialKey('first-bid-accepted')
    tutorial.startTutorial(
      FIRST_BID_ACCEPTED_TUTORIAL_STEPS.map(step => ({
        ...step,
        title: t(`common:${step.title}`),
        description: t(`common:${step.description}`),
      })),
      {
        startStep: options?.startStep,
        onComplete: () => {
          markFirstBidAcceptedCompleted()
          setActiveTutorialKey(null)
        },
        onSkip: () => {
          markFirstBidAcceptedCompleted()
          setActiveTutorialKey(null)
        },
      },
    )
  }, [tutorial, t])

  const { refreshSignal, historySignal, triggerRefresh, triggerHistoryRefresh, triggerTransactionRefresh, triggerSoftRefresh } = useDataRefresh()
  const [lastRefreshTime, setLastRefreshTime] = useState(Date.now())
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [relativeTime, setRelativeTime] = useState(() => t('dashboard:shell.timeJustNow'))
  const toast = useToast()

  // ── Update check (auto-check happens in UpdateProvider) ────────
  const { state: updateState, downloadUpdate: downloadAppUpdate } = useUpdate()
  const updateToastShownRef = useRef(false)

  useEffect(() => {
    if (updateState.status === 'available' && !updateToastShownRef.current) {
      updateToastShownRef.current = true
      const info = updateState.info
      toast.info(
        t('toast.updateAvailableTitle', { version: info.latest_version }),
        t('toast.updateAvailableBody', { currentVersion: info.current_version }),
        0,
        {
          label: t('toast.updateDownload'),
          onClick: () => {
            // Kick off the download (visible in Settings → Updates via the
            // shared UpdateContext) and navigate the user to that section so
            // they can watch progress instead of staring at a toast that
            // appears to do nothing.
            downloadAppUpdate(info.download_url, info.download_size)
            navigate('/settings', { state: { section: 'update' } })
          },
        }
      )
    }
    if (updateState.status === 'downloaded') {
      toast.success(
        t('toast.updateDownloadedTitle'),
        t('toast.updateDownloadedBody', { path: updateState.filePath }),
        0
      )
    }
    if (updateState.status === 'error' && updateToastShownRef.current) {
      toast.error(t('toast.updateCheckFailedTitle'), updateState.message)
    }
  }, [updateState.status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Confirmation modal state for destructive actions
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [confirmLoading, setConfirmLoading] = useState(false)

  // Compute payment key hash from wallet address for PKH-based filtering
  const userPkh = useMemo(() => {
    if (!address) return undefined
    try {
      return extractPaymentKeyHash(address)
    } catch {
      return undefined
    }
  }, [address])

  // ── Effects hook ──────────────────────────────────────────────────
  const effects = useDashboardEffects({
    userPkh, tipSlot, tipHeight, nodeStage, expressReady,
    refreshSignal, historySignal, triggerSoftRefresh, refreshBalance,
    toast, wallet, address,
    marketplaceFilters, marketplaceDispatch,
  })

  // ── Shared actions bundle ─────────────────────────────────────────
  const dashboardActions = useMemo(() => ({
    wallet, address, userPkh, toast,
    recordTransaction: effects.recordTransaction,
    triggerTransactionRefresh, triggerRefresh,
    setConfirmAction, setActiveTab,
  }), [wallet, address, userPkh, toast, effects.recordTransaction, triggerTransactionRefresh, triggerRefresh, setActiveTab])

  // ── Seller actions hook ───────────────────────────────────────────
  // ── Accept-bid queue — supply optional UI handles ────────────────
  const queueCtx = useAcceptBidQueue()
  const {
    setToast: setQueueToast,
    setRefreshTrigger: setQueueRefresh,
    currentItem: queueCurrentItem,
    completedCount: queueCompletedCount,
  } = queueCtx
  useEffect(() => {
    setQueueToast(toast)
    setQueueRefresh(triggerTransactionRefresh)
    return () => { setQueueToast(null); setQueueRefresh(null) }
  }, [setQueueToast, setQueueRefresh, toast, triggerTransactionRefresh])

  const seller = useSellerActions({
    actions: dashboardActions,
    iagonConnected: effects.iagonConnected,
  })

  // Open CreateListingModal when listing tutorial advances past step 1 (the button)
  // into steps 2-5 (modal fields). Close is handled normally by the user.
  useEffect(() => {
    if (activeTutorialKey === 'listing' && tutorial.isTutorialActive && tutorial.currentStepIndex >= 1) {
      seller.setShowCreateListing(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTutorialKey, tutorial.isTutorialActive, tutorial.currentStepIndex])

  // ── Buyer actions hook ────────────────────────────────────────────
  const buyer = useBuyerActions({
    actions: dashboardActions,
    lovelace,
  })

  // Open PlaceBidModal when bid tutorial advances past step 1 (the button)
  // into steps 2-4 (modal fields). Uses the encryption captured at tutorial start.
  useEffect(() => {
    if (
      activeTutorialKey === 'bid' &&
      tutorial.isTutorialActive &&
      tutorial.currentStepIndex >= 1 &&
      bidTutorialTarget
    ) {
      buyer.handlePlaceBid(bidTutorialTarget.encryption, bidTutorialTarget.bidCount)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTutorialKey, tutorial.isTutorialActive, tutorial.currentStepIndex, bidTutorialTarget])

  // Settings "Replay" navigations arrive with `location.state.startTutorial`.
  // Both tours are one-shot — we clear the nav state immediately so a later tab
  // switch or refresh doesn't re-arm the flow. first-decrypt hands off to
  // MyPurchasesTab (which owns the list of eligible targets); first-bid-accepted
  // starts directly on Dashboard.
  useEffect(() => {
    const navState = location.state as { startTutorial?: string } | null
    if (navState?.startTutorial === 'first-decrypt') {
      setActiveTab('my-purchases')
      setAutoStartDecryptTutorial(true)
      navigate(location.pathname, { replace: true, state: null })
    } else if (navState?.startTutorial === 'first-bid-accepted') {
      if (activeTutorialKey) return
      setActiveTab('my-sales')
      handleStartFirstBidAcceptedTutorial({ startStep: 0 })
      navigate(location.pathname, { replace: true, state: null })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  // Decrypt tutorial orchestration — the flow spans MyPurchasesTab, DecryptModal,
  // Library tab, and LibraryContentModal. Each step advance opens/switches the
  // relevant surface so the spotlight target is mounted when TutorialOverlay
  // goes looking for it.
  useEffect(() => {
    if (activeTutorialKey !== 'decrypt' || !tutorial.isTutorialActive || !decryptTutorialTarget) return
    const { bid, encryption, ownerPkh } = decryptTutorialTarget
    switch (tutorial.currentStepIndex) {
      case 0:
        // Step 1: highlight the Decrypt button on MyPurchaseBidCard.
        setActiveTab('my-purchases')
        break
      case 1:
        // Step 2: open DecryptModal so the header id is in the DOM.
        // Prefer the bid path when available (richer context); fall back to
        // encryption-only for users who already decrypted everything.
        if (bid) {
          buyer.handleDecrypt(bid)
        } else {
          buyer.handleDecryptEncryption(encryption, ownerPkh)
        }
        break
      case 2:
        // Step 3: close DecryptModal and switch to the Library tab.
        buyer.closeDecryptModal()
        setActiveTab('library')
        break
      case 3:
        // Step 4: highlight the LibraryContentModal action row. The modal is
        // opened by LibraryTab when the user clicks an item, so the tutorial
        // relies on the tab being visited; the overlay polls for the target
        // until the user opens the item.
        setActiveTab('library')
        break
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTutorialKey, tutorial.isTutorialActive, tutorial.currentStepIndex, decryptTutorialTarget])


  // Event-driven step advancement: watch queue state transitions and move the
  // tour forward without user Next clicks. Completion (step 4) is detected via
  // completedCount increasing since the queue clears `currentItem` at that point.
  const prevCompletedCountRef = useRef(queueCompletedCount)
  const queueCurrentItemStatus = queueCurrentItem?.status
  useEffect(() => {
    if (activeTutorialKey !== 'first-bid-accepted') {
      prevCompletedCountRef.current = queueCompletedCount
      return
    }
    const didJustComplete = queueCompletedCount > prevCompletedCountRef.current
    const targetStep = queueStateToTourStep({
      currentItemStatus: queueCurrentItemStatus,
      didJustComplete,
    })
    if (targetStep !== null) tutorial.goToStep(targetStep)
    prevCompletedCountRef.current = queueCompletedCount
  }, [activeTutorialKey, queueCurrentItemStatus, queueCompletedCount, tutorial])

  // Refresh handler for manual data refresh
  const handleRefresh = useCallback(() => {
    if (isRefreshing) return
    setIsRefreshing(true)
    triggerRefresh()
    setLastRefreshTime(Date.now())
    setRelativeTime(t('dashboard:shell.timeJustNow'))
    setTimeout(() => setIsRefreshing(false), 2000)
  }, [isRefreshing, triggerRefresh, t])

  // Handler for tab-level refresh buttons to update the timestamp without triggering all tabs
  const handleLocalRefresh = useCallback(() => {
    setLastRefreshTime(Date.now())
    setRelativeTime(t('dashboard:shell.timeJustNow'))
  }, [t])

  // Update relative time display every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const seconds = Math.floor((Date.now() - lastRefreshTime) / 1000)
      if (seconds < 10) setRelativeTime(t('dashboard:shell.timeJustNow'))
      else if (seconds < 60) setRelativeTime(t('dashboard:shell.timeSecondsAgo', { count: seconds }))
      else if (seconds < 3600) setRelativeTime(t('dashboard:shell.timeMinutesAgo', { count: Math.floor(seconds / 60) }))
      else setRelativeTime(t('dashboard:shell.timeHoursAgo', { count: Math.floor(seconds / 3600) }))
    }, 5000)
    return () => clearInterval(interval)
  }, [lastRefreshTime, t])

  // Reset timestamp when data refreshes externally (e.g. after tx submission)
  useEffect(() => {
    setLastRefreshTime(Date.now())
    setRelativeTime(t('dashboard:shell.timeJustNow'))
  }, [refreshSignal, t])

  // Keyboard shortcuts: Ctrl+1-5 for tabs, Ctrl+R for refresh
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (hasOpenModal) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setShowShortcuts(true)
        return
      }

      if (!e.ctrlKey && !e.metaKey) return

      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault()
        setShowCommandPalette(true)
        return
      }

      const tabIds: TabId[] = ['marketplace', 'my-sales', 'my-purchases', 'history', 'library']
      const digit = parseInt(e.key, 10)

      if (digit >= 1 && digit <= 5) {
        e.preventDefault()
        setActiveTab(tabIds[digit - 1])
        const btn = document.getElementById(`tab-${tabIds[digit - 1]}`)
        btn?.focus()
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        handleRefresh()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [hasOpenModal, setActiveTab, handleRefresh])

  const handleCopy = useCallback(async () => {
    if (!address) return
    const success = await copyToClipboard(address)
    if (success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else {
      toast.warning(t('toast.copyFailedTitle'), t('toast.copyAddressFailedBody'))
    }
  }, [address, toast, t])

  const handleDisconnect = useCallback(() => {
    clearLastActiveTab()
    disconnect()
  }, [disconnect])

  const handleOpenCreateListing = useCallback(() => seller.setShowCreateListing(true), [seller])

  const handleCommandExecute = useCallback((commandId: string) => {
    switch (commandId) {
      case 'tab-marketplace': setActiveTab('marketplace'); break
      case 'tab-my-sales': setActiveTab('my-sales'); break
      case 'tab-my-purchases': setActiveTab('my-purchases'); break
      case 'tab-history': setActiveTab('history'); break
      case 'tab-library': setActiveTab('library'); break
      case 'nav-settings': navigate('/settings'); break
      case 'action-refresh': handleRefresh(); break
      case 'action-create-listing': seller.setShowCreateListing(true); break
      case 'action-toggle-theme': {
        const current = getTheme()
        const resolved = resolveTheme(current)
        const next = resolved === 'dark' ? 'light' : 'dark'
        setTheme(next)
        applyTheme(next)
        break
      }
      case 'action-copy-address': handleCopy(); break
      case 'action-lock-wallet': handleDisconnect(); break
      case 'settings-node':
      case 'settings-network':
      case 'settings-wallet':
      case 'settings-storage':
      case 'settings-automation':
      case 'settings-updates':
      case 'settings-logs':
      case 'settings-data-layer':
        navigate('/settings')
        break
    }
  }, [setActiveTab, navigate, handleRefresh, seller, handleCopy, handleDisconnect])

  // Close create-listing dropdown on outside click
  useEffect(() => {
    if (!createListingDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (createListingDropdownRef.current && !createListingDropdownRef.current.contains(e.target as Node)) {
        setCreateListingDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [createListingDropdownOpen])

  const tabPanelClass = (tabId: TabId) =>
    activeTab !== tabId ? 'hidden' : undefined

  // Collapse the four healthy-state pills into a single "All Systems Ready" pill
  // when node, prover, iagon, collateral are all good. The collapsed pill expands
  // on hover/focus to reveal each individual status.
  const allSystemsReady =
    nodeStage === 'synced' &&
    wasmReady &&
    effects.iagonConnected &&
    !walletHealth.isChecking &&
    walletHealth.hasCollateral

  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <nav className="h-16 border-b border-[var(--border-subtle)] px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold mr-1">{t('dashboard:shell.appName')}</h1>
          <span className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)]"></span>
            {t('dashboard:shell.networkPreprod')}
          </span>
          {/* Collapsed "All Systems Ready" pill — shown when all four are healthy */}
          {allSystemsReady && (
            <div className="relative group">
              <button
                type="button"
                className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--success)] bg-[var(--success-muted)] border border-[var(--success)]/30 rounded-full cursor-default"
                aria-label={t('dashboard:shell.allSystemsReady')}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
                {t('dashboard:shell.allSystemsReady')}
              </button>
              {/* Hover/focus popover reveals each individual system status */}
              <div
                className="absolute top-full left-0 mt-2 hidden group-hover:flex group-focus-within:flex flex-col gap-1.5 p-2 bg-[var(--bg-card)] border border-[var(--border-default)] rounded-[var(--radius-md)] shadow-lg z-50 whitespace-nowrap"
                role="tooltip"
              >
                <span className="inline-flex items-center gap-2 text-xs text-[var(--success)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
                  {t('dashboard:shell.nodeReady')}
                </span>
                <span className="inline-flex items-center gap-2 text-xs text-[var(--success)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
                  {t('dashboard:shell.proverReady')}
                </span>
                <span className="inline-flex items-center gap-2 text-xs text-[var(--success)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
                  {t('dashboard:shell.iagonReady')}
                </span>
                <span className="inline-flex items-center gap-2 text-xs text-[var(--success)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
                  {t('dashboard:shell.collateralSet')}
                </span>
              </div>
            </div>
          )}
          {/* Node Sync Indicator — hidden when allSystemsReady (collapsed pill takes over) */}
          {allSystemsReady ? null : nodeStage === 'synced' ? (
            <span className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--success)] bg-[var(--success-muted)] border border-[var(--success)]/30 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
              {t('dashboard:shell.nodeReady')}
            </span>
          ) : nodeStage === 'syncing' ? (
            <button
              onClick={() => navigate('/node-sync')}
              className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--warning)] bg-[var(--warning)]/10 border border-[var(--warning)]/30 rounded-full hover:bg-[var(--warning)]/20 transition-all cursor-pointer"
              title={t('dashboard:shell.nodeSyncingTitle')}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)] animate-pulse"></span>
              {t('dashboard:shell.nodeSyncing', { count: Math.round(Math.min(nodeSyncProgress, kupoSyncProgress)) })}
            </button>
          ) : nodeStage === 'error' ? (
            <button
              onClick={() => navigate('/node-sync')}
              className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--error)] bg-[var(--error)]/10 border border-[var(--error)]/30 rounded-full hover:bg-[var(--error)]/20 transition-all cursor-pointer"
              title={t('dashboard:shell.nodeErrorTitle')}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--error)]"></span>
              {t('dashboard:shell.nodeError')}
            </button>
          ) : nodeStage === 'starting' || nodeStage === 'bootstrapping' ? (
            <button
              onClick={() => navigate('/node-sync')}
              className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--accent)] bg-[var(--accent-muted)] border border-[var(--accent)]/30 rounded-full hover:bg-[var(--accent)]/20 transition-all cursor-pointer"
              title={t('dashboard:shell.nodeProgressTitle')}
            >
              <LoadingSpinner size="sm" />
              {nodeStage === 'bootstrapping' ? t('dashboard:shell.nodeBootstrapping') : t('dashboard:shell.nodeStarting')}
            </button>
          ) : (
            <button
              onClick={() => navigate('/node-sync')}
              className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-full hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all cursor-pointer"
              title={t('dashboard:shell.nodeOfflineTitle')}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)]"></span>
              {t('dashboard:shell.nodeOffline')}
            </button>
          )}
          {/* WASM Prover Indicator — hidden when allSystemsReady (collapsed pill takes over) */}
          {allSystemsReady ? null : wasmReady ? (
            <span className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--success)] bg-[var(--success-muted)] border border-[var(--success)]/30 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
              {t('dashboard:shell.proverReady')}
            </span>
          ) : wasmLoading ? (
            <button
              onClick={() => navigate('/loading')}
              className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--accent)] bg-[var(--accent-muted)] border border-[var(--accent)]/30 rounded-full hover:bg-[var(--accent)]/20 transition-all cursor-pointer"
              title={t('dashboard:shell.proverLoadingTitle')}
            >
              <LoadingSpinner size="sm" />
              {t('dashboard:shell.proverProgress', { count: Math.round(wasmProgress) })}
            </button>
          ) : null}
          {/* Iagon Connection Indicator — hidden when allSystemsReady (collapsed pill takes over) */}
          {allSystemsReady ? null : effects.iagonConnected ? (
            <span className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--success)] bg-[var(--success-muted)] border border-[var(--success)]/30 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
              {t('dashboard:shell.iagonReady')}
            </span>
          ) : (
            <button
              onClick={() => navigate('/settings')}
              className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-full hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all cursor-pointer"
              title={t('dashboard:shell.iagonOfflineTitle')}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)]"></span>
              {t('dashboard:shell.iagonOffline')}
            </button>
          )}
          {/* Collateral Indicator — hidden when allSystemsReady (collapsed pill takes over) */}
          {allSystemsReady ? null : nodeStage === 'synced' && !walletHealth.isChecking && (
            walletHealth.hasCollateral ? (
              <span className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--success)] bg-[var(--success-muted)] border border-[var(--success)]/30 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
                {t('dashboard:shell.collateralSet')}
              </span>
            ) : (
              <button
                onClick={() => navigate('/settings', { state: { section: 'wallet' } })}
                className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--warning)] bg-[var(--warning)]/10 border border-[var(--warning)]/30 rounded-full hover:bg-[var(--warning)]/20 transition-all cursor-pointer"
                title={t('dashboard:shell.noCollateralTitle')}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)] animate-pulse"></span>
                {t('dashboard:shell.noCollateral')}
              </button>
            )
          )}
        </div>
        <div className="flex items-center gap-4">
          {/* Create Listing Split Button */}
          <div className="relative" ref={createListingDropdownRef}>
            <div className="flex">
              <button
                id="tutorial-create-listing"
                onClick={() => seller.setShowCreateListing(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-l-[var(--radius-md)] btn-base btn-primary"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                {t('dashboard:shell.createListing')}
              </button>
              <button
                onClick={() => setCreateListingDropdownOpen((prev) => !prev)}
                className="flex items-center px-2 py-2 text-sm font-medium rounded-r-[var(--radius-md)] border-l border-black/20 btn-base btn-primary"
                aria-label={t('dashboard:shell.moreListingOptionsAria')}
                aria-expanded={createListingDropdownOpen}
                aria-haspopup="true"
              >
                <svg className={`w-3.5 h-3.5 transition-transform ${createListingDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            {createListingDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] shadow-lg overflow-hidden z-50">
                <button
                  onClick={() => { setCreateListingDropdownOpen(false); seller.setShowCreateListing(true); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors text-left"
                >
                  <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  {t('dashboard:shell.newListing')}
                </button>
                <button
                  onClick={() => { setCreateListingDropdownOpen(false); seller.setShowImportListing(true); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors text-left border-t border-[var(--border-subtle)]"
                >
                  <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  {t('dashboard:shell.importFromIagon')}
                </button>
              </div>
            )}
          </div>

          {/* ADA Balance */}
          {lovelace ? (
            <div className="px-3 py-1.5 text-sm font-medium tnum text-[var(--accent)] bg-[var(--accent-muted)] rounded-[var(--radius-md)]">
              {formatAdaDisplay(lovelace)} ADA
            </div>
          ) : (
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--text-muted)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)]"
              title={t('dashboard:shell.balanceUnavailableTitle')}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {t('dashboard:shell.balanceUnavailable')}
            </div>
          )}

          {/* Address with copy button */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] font-mono bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] btn-base btn-tertiary"
            title={address || t('dashboard:shell.addressLoading')}
          >
            <span>{address ? truncateHex(address, 12, 8) : '...'}</span>
            <svg
              className={`w-4 h-4${copied ? ' copy-check-animate' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {copied ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              )}
            </svg>
          </button>

          {/* Settings */}
          <button
            onClick={() => navigate('/settings')}
            className="p-2 rounded-[var(--radius-md)] btn-base btn-icon"
            title={t('dashboard:shell.settingsTitle')}
            aria-label={t('dashboard:shell.settingsAria')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {/* Disconnect button */}
          <button
            onClick={handleDisconnect}
            className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
          >
            {t('dashboard:shell.disconnect')}
          </button>
        </div>
      </nav>

      {/* Draft Recovery Banner — sticky below nav, persists across scrolling/tab switches */}
      {seller.recoverableDraft && (
        <div className="sticky top-16 z-40 animate-[slideDown_300ms_ease-out]">
          <div className="max-w-7xl mx-auto px-6 pt-3">
            <div className="p-4 bg-[var(--warning)]/10 border border-[var(--warning)]/30 rounded-[var(--radius-lg)] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-[var(--text-primary)]">
                  {t('dashboard:shell.unfinishedListingTitle')}
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {t('dashboard:shell.unfinishedListingBody', { filename: seller.recoverableDraft.originalFilename })}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                <button
                  onClick={() => seller.handleDraftRecovery('discard')}
                  className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] btn-base btn-tertiary"
                >
                  {t('dashboard:shell.discard')}
                </button>
                <button
                  onClick={() => seller.handleDraftRecovery('resume')}
                  className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] btn-base btn-primary"
                >
                  {t('dashboard:shell.resumeListing')}
                </button>
                <button
                  onClick={() => seller.setRecoverableDraft(null)}
                  className="p-1 btn-base btn-icon"
                  title={t('dashboard:shell.dismissTitle')}
                  aria-label={t('dashboard:shell.dismissDraftRecoveryAria')}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main id="main-content" className="max-w-7xl mx-auto px-6 py-8">

        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <button
            onClick={() => setActiveTab('my-sales')}
            className={`h-full bg-[var(--bg-card)] border rounded-[var(--radius-lg)] p-6 text-left transition-all duration-[var(--transition-fast)] cursor-pointer ${
              activeTab === 'my-sales'
                ? 'border-[var(--accent)] shadow-[var(--shadow-glow)]'
                : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)] hover:shadow-[var(--shadow-md)] hover:-translate-y-0.5'
            }`}
          >
            <h2 className="text-lg font-medium mb-2">{t('dashboard:shell.statMyListings')}</h2>
            <p className="text-2xl font-semibold tracking-tight tnum text-[var(--text-primary)]">
              {effects.myListingsCount === null ? '...' : t('dashboard:shell.statActiveCount', { count: effects.myListingsCount })}
            </p>
            {effects.bidNotifications.unseenBidCount > 0 && (
              <p className="text-sm text-[var(--success)] mt-1" aria-live="polite">
                {t('newBidCount', { count: effects.bidNotifications.unseenBidCount })}
              </p>
            )}
          </button>
          <button
            onClick={() => setActiveTab('my-purchases')}
            className={`h-full bg-[var(--bg-card)] border rounded-[var(--radius-lg)] p-6 text-left transition-all duration-[var(--transition-fast)] cursor-pointer ${
              activeTab === 'my-purchases'
                ? 'border-[var(--accent)] shadow-[var(--shadow-glow)]'
                : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)] hover:shadow-[var(--shadow-md)] hover:-translate-y-0.5'
            }`}
          >
            <h2 className="text-lg font-medium mb-2">{t('dashboard:shell.statMyBids')}</h2>
            <p className="text-2xl font-semibold tracking-tight tnum text-[var(--text-primary)]">
              {effects.myBidsCount === null ? '...' : t('dashboard:shell.statPendingCount', { count: effects.myBidsCount })}
            </p>
          </button>
          <button
            onClick={() => setActiveTab('library')}
            className={`h-full bg-[var(--bg-card)] border rounded-[var(--radius-lg)] p-6 text-left transition-all duration-[var(--transition-fast)] cursor-pointer ${
              activeTab === 'library'
                ? 'border-[var(--accent)] shadow-[var(--shadow-glow)]'
                : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)] hover:shadow-[var(--shadow-md)] hover:-translate-y-0.5'
            }`}
          >
            <h2 className="text-lg font-medium mb-2">{t('dashboard:shell.statLibrary')}</h2>
            <p className="text-2xl font-semibold tracking-tight tnum text-[var(--text-primary)]">
              {effects.libraryCount === null ? '...' : t('dashboard:library.totalCount', { count: effects.libraryCount })}
            </p>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`h-full bg-[var(--bg-card)] border rounded-[var(--radius-lg)] p-6 text-left transition-all duration-[var(--transition-fast)] cursor-pointer ${
              activeTab === 'history'
                ? 'border-[var(--accent)] shadow-[var(--shadow-glow)]'
                : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)] hover:shadow-[var(--shadow-md)] hover:-translate-y-0.5'
            }`}
          >
            <h2 className="text-lg font-medium mb-2">{t('dashboard:shell.statTransactions')}</h2>
            <p className="text-2xl font-semibold tracking-tight tnum text-[var(--text-primary)]">
              {effects.pendingTxCount > 0 ? t('dashboard:shell.statPendingCount', { count: effects.pendingTxCount }) : t('dashboard:shell.statNonePending')}
            </p>
          </button>
        </div>

        {/* Tabs */}
        <nav className="border-b border-[var(--border-subtle)] mb-6" aria-label={t('dashboard:shell.tabsAria')}>
          <div className="flex items-center justify-between">
          <div className="flex gap-6" role="tablist" ref={tabListRef} onKeyDown={handleTabKeyDown}>
            {TABS.map((tab, index) => (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`tabpanel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                title={t('dashboard:shell.tabShortcutTitle', { label: t(`dashboard:${tab.labelKey}`), number: index + 1 })}
                /* border-b-2 always present so tab height does not jump on
                 * activation. Only the border color animates between
                 * accent (active) and transparent (inactive). */
                className={`pb-3 border-b-2 transition-colors duration-[var(--transition-base)] cursor-pointer flex items-center gap-2 ${
                  activeTab === tab.id
                    ? 'text-[var(--text-primary)] border-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] border-transparent'
                }`}
              >
                {t(`dashboard:${tab.labelKey}`)}
                {/* Tab badge color rule:
                 *   warning (amber) — "needs your action": pending tx, new bids on your listings
                 *   success (green) — "ready / done": accepted bids ready to decrypt
                 *   accent / neutral — count-only, no implied urgency */}
                {tab.id === 'my-sales' && effects.bidNotifications.unseenBidCount > 0 && (
                  <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-medium bg-[var(--warning)] text-white rounded-full animate-pulse" aria-label={`${effects.bidNotifications.unseenBidCount} new bids`}>
                    {effects.bidNotifications.unseenBidCount}
                  </span>
                )}
                {tab.id === 'my-purchases' && effects.acceptedBidCount > 0 && (
                  <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-medium bg-[var(--success)] text-white rounded-full" aria-label={`${effects.acceptedBidCount} accepted bids ready to decrypt`}>
                    {effects.acceptedBidCount}
                  </span>
                )}
                {tab.id === 'history' && effects.pendingTxCount > 0 && (
                  <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-medium bg-[var(--warning)] text-white rounded-full" aria-label={`${effects.pendingTxCount} pending transactions`}>
                    {effects.pendingTxCount}
                  </span>
                )}
              </button>
            ))}
          </div>
          {/* Refresh button + timestamp */}
          <div className="flex items-center gap-3 pb-3">
            <span className="text-xs text-[var(--text-muted)]">
              {t('dashboard:shell.updatedRelative', { time: relativeTime })}
            </span>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title={t('dashboard:shell.refreshTitle')}
              aria-label={t('dashboard:shell.refreshAria')}
            >
              <svg
                className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          </div>
          </div>
        </nav>

        {/* Tab Content — tabs stay mounted once visited for instant switching */}
        {visitedTabs.has('marketplace') && (
          <div
            id="tabpanel-marketplace"
            role="tabpanel"
            aria-labelledby="tab-marketplace"
            aria-hidden={activeTab !== 'marketplace'}
            aria-busy={activeTab === 'marketplace' && isRefreshing}
            tabIndex={activeTab === 'marketplace' ? 0 : -1}
            className={tabPanelClass('marketplace')}
          >
            <Suspense fallback={<SkeletonGrid />}>
              <MarketplaceTab
                refreshSignal={refreshSignal}
                userPkh={userPkh}
                lovelace={lovelace}
                onPlaceBid={buyer.handlePlaceBid}
                onCreateListing={handleOpenCreateListing}
                onStartTutorial={handleStartListingTutorial}
                onStartBidTutorial={handleStartBidTutorial}
                onLocalRefresh={handleLocalRefresh}
                filters={marketplaceFilters}
                dispatch={marketplaceDispatch}
              />
            </Suspense>
          </div>
        )}
        {visitedTabs.has('my-sales') && (
          <div
            id="tabpanel-my-sales"
            role="tabpanel"
            aria-labelledby="tab-my-sales"
            aria-hidden={activeTab !== 'my-sales'}
            aria-busy={activeTab === 'my-sales' && isRefreshing}
            tabIndex={activeTab === 'my-sales' ? 0 : -1}
            className={tabPanelClass('my-sales')}
          >
            <Suspense fallback={<SkeletonGrid />}>
              <MySalesTab
                refreshSignal={refreshSignal}
                userPkh={userPkh}
                onRemoveListing={seller.handleRemoveListing}
                onUpdatePrice={seller.handleOpenUpdatePrice}
                onAcceptBid={seller.handleAcceptBid}
                onCancelPending={seller.handleCancelPending}
                onCompleteSale={seller.handleCompleteSale}
                onCreateListing={handleOpenCreateListing}
                onBidsViewed={effects.bidNotifications.markListingSeen}
                onStartAcceptBidTutorial={() => handleStartFirstBidAcceptedTutorial({ startStep: 0 })}
                onLocalRefresh={handleLocalRefresh}
                filters={mySalesFilters}
                dispatch={mySalesDispatch}
              />
            </Suspense>
          </div>
        )}
        {visitedTabs.has('my-purchases') && (
          <div
            id="tabpanel-my-purchases"
            role="tabpanel"
            aria-labelledby="tab-my-purchases"
            aria-hidden={activeTab !== 'my-purchases'}
            aria-busy={activeTab === 'my-purchases' && isRefreshing}
            tabIndex={activeTab === 'my-purchases' ? 0 : -1}
            className={tabPanelClass('my-purchases')}
          >
            <Suspense fallback={<SkeletonGrid />}>
              <MyPurchasesTab
                refreshSignal={refreshSignal}
                userPkh={userPkh}
                onCancelBid={buyer.handleCancelBid}
                onUpdateBid={buyer.handleOpenUpdateBid}
                onDecrypt={buyer.handleDecrypt}
                onDecryptEncryption={buyer.handleDecryptEncryption}
                onSwitchTab={setActiveTab}
                onLocalRefresh={handleLocalRefresh}
                onStartDecryptTutorial={handleStartDecryptTutorial}
                autoStartDecryptTutorial={autoStartDecryptTutorial}
                onAutoStartConsumed={() => setAutoStartDecryptTutorial(false)}
                filters={myPurchasesFilters}
                dispatch={myPurchasesDispatch}
                failedDecryptTokens={buyer.failedDecryptTokens}
              />
            </Suspense>
          </div>
        )}
        {visitedTabs.has('history') && (
          <div
            id="tabpanel-history"
            role="tabpanel"
            aria-labelledby="tab-history"
            aria-hidden={activeTab !== 'history'}
            aria-busy={activeTab === 'history' && isRefreshing}
            tabIndex={activeTab === 'history' ? 0 : -1}
            className={tabPanelClass('history')}
          >
            <Suspense fallback={<SkeletonGrid />}>
              <HistoryTab
                historySignal={historySignal}
                userPkh={userPkh}
                transactions={effects.txHistory}
                onClearHistory={triggerHistoryRefresh}
                onHistoryUpdated={effects.setTxHistory}
                onRetryListing={seller.handleRetryListing}
                onLocalRefresh={handleLocalRefresh}
                filters={historyFilters}
                dispatch={historyDispatch}
              />
            </Suspense>
          </div>
        )}
        {visitedTabs.has('library') && (
          <div
            id="tabpanel-library"
            role="tabpanel"
            aria-labelledby="tab-library"
            aria-hidden={activeTab !== 'library'}
            aria-busy={activeTab === 'library' && isRefreshing}
            tabIndex={activeTab === 'library' ? 0 : -1}
            className={tabPanelClass('library')}
          >
            <Suspense fallback={<SkeletonGrid />}>
              <LibraryTab
                refreshSignal={refreshSignal}
                onSwitchTab={setActiveTab}
                onLocalRefresh={handleLocalRefresh}
                filters={libraryFilters}
                dispatch={libraryDispatch}
                onBulkDeleteResult={(message, hadErrors) =>
                  hadErrors ? toast.warning(t('toast.bulkDeleteTitle'), message) : toast.success(t('toast.bulkDeleteTitle'), message)
                }
                onRelist={seller.handleRelistFromLibrary}
              />
            </Suspense>
          </div>
        )}
      </main>

      {/* Scroll to Top Button */}
      <ScrollToTop />

      {/* Create Listing Modal */}
      <CreateListingModal
        isOpen={seller.showCreateListing}
        onClose={() => {
          seller.setShowCreateListing(false)
          seller.setRelistPrefill(null)
        }}
        onSubmit={seller.handleCreateListing}
        isIagonConnected={effects.iagonConnected}
        prefill={seller.relistPrefill}
        title={seller.relistPrefill ? t('dashboard:shell.relistFromLibraryTitle') : undefined}
        wallet={wallet}
        address={address}
        onIagonConnected={() => effects.setIagonConnected(true)}
      />

      {/* Import Listing Modal */}
      <ImportListingModal
        isOpen={seller.showImportListing}
        onClose={() => seller.setShowImportListing(false)}
        onSubmit={seller.handleImportListing}
      />

      {/* Update Price Modal */}
      <UpdatePriceModal
        isOpen={seller.showUpdatePriceModal}
        onClose={() => {
          seller.setShowUpdatePriceModal(false)
          // Keep encryption reference for animation exit
        }}
        onSubmit={seller.handleSubmitUpdatePrice}
        encryption={seller.updatePriceEncryption}
      />

      {/* Update Bid Modal */}
      <UpdateBidModal
        isOpen={buyer.showUpdateBid}
        onClose={buyer.closeUpdateBidModal}
        onSubmit={buyer.handleSubmitUpdateBid}
        bid={buyer.updateBidTarget}
      />

      {/* Place Bid Modal */}
      <PlaceBidModal
        isOpen={buyer.showPlaceBid}
        onClose={buyer.closePlaceBidModal}
        onSubmit={buyer.handlePlaceBidSubmit}
        encryption={buyer.selectedEncryption}
        bidCount={buyer.selectedBidCount}
        balanceLovelace={lovelace ?? undefined}
      />

      {/* Decrypt Modal */}
      <DecryptModal
        isOpen={buyer.showDecrypt}
        onClose={buyer.closeDecryptModal}
        bid={buyer.selectedBid}
        encryption={buyer.selectedEncryption}
        isIagonConnected={effects.iagonConnected}
        onDecryptResult={buyer.handleDecryptResult}
        onSaveWarning={(msg) => toast.warning(t('toast.saveFailedTitle'), msg)}
        ownerPkh={buyer.decryptOwnerPkh}
      />

      {/* Confirmation Modal (destructive actions) */}
      <ConfirmModal
        isOpen={confirmAction !== null}
        onClose={() => {
          if (!confirmLoading) {
            setConfirmAction(null)
          }
        }}
        onConfirm={async () => {
          if (!confirmAction) return
          setConfirmLoading(true)
          try {
            await confirmAction.onConfirm()
          } finally {
            setConfirmLoading(false)
            setConfirmAction(null)
          }
        }}
        title={confirmAction?.title ?? ''}
        message={confirmAction?.message ?? ''}
        description={confirmAction?.description}
        confirmLabel={confirmAction?.confirmLabel ?? t('dashboard:shell.confirmFallback')}
        confirmVariant="danger"
        loading={confirmLoading}
      />

      {/* Tutorial Overlay */}
      <TutorialOverlay
        step={tutorial.currentStep}
        stepIndex={tutorial.currentStepIndex}
        totalSteps={tutorial.totalSteps}
        onNext={tutorial.nextStep}
        onSkip={tutorial.skipTutorial}
      />

      {/* Toast Notifications */}
      <KeyboardShortcutsOverlay isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onExecute={handleCommandExecute}
      />
      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} queuedCount={toast.queuedCount} onDismissAll={toast.dismissAll} />
    </div>
  )
}
