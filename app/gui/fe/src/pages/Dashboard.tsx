import { useWalletContext, useAddress, useLovelace } from '../contexts/WalletContext'
import { useState, useCallback, useEffect, useMemo, useRef, useReducer, lazy, Suspense, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
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
import ScrollToTop from '../components/ScrollToTop'
import KeyboardShortcutsOverlay from '../components/KeyboardShortcutsOverlay'
import CreateListingModal from '../components/CreateListingModal'
import PlaceBidModal from '../components/PlaceBidModal'
import DecryptModal from '../components/DecryptModal'
const SnarkProvingModal = lazy(() => import('../components/SnarkProvingModal'))
import ConfirmModal from '../components/ConfirmModal'
import { useToast, ToastContainer } from '../components/Toast'
import { encryptionsApi, bidsApi } from '../services/api'
import { cleanupStaleSecrets } from '../services/secretCleanup'
import { isIagonConnected, connectIagon } from '../services/iagonAuth'
import { useBidNotifications } from '../hooks/useBidNotifications'
import { playNotificationSound } from '../services/notificationSound'
import { sendDesktopNotification } from '../services/desktopNotifications'
import {
  createListing, retryListingFromDraft, removeListing, placeBid, cancelBid,
  cancelPendingListing, acceptBidSnark, prepareSnarkInputs, completeReEncryption,
  getTransactionStubWarning, extractPaymentKeyHash,
  type ListingCreationStep,
} from '../services/transactionBuilder'
import { getAcceptBidSecrets } from '../services/acceptBidStorage'
import { saveDecryptedContent, saveContentMetadata } from '../services/contentStorage'
import { getRecoverableDrafts, updateListingDraft, type ListingDraft } from '../services/listingDraftStorage'
import { getTransactions, addTransaction } from '../services/transactionHistory'
import { getLastActiveTab, setLastActiveTab, clearLastActiveTab } from '../services/tabStorage'
import { getPersistedFilters, persistFilters } from '../services/filterStorage'
import { listLibraryItems } from '../services/libraryService'
import { useDataRefresh } from '../hooks/useDataRefresh'
import { useWalletHealth } from '../hooks/useWalletHealth'
import {
  marketplaceReducer, MARKETPLACE_INITIAL,
  mySalesReducer, MY_SALES_INITIAL,
  myPurchasesReducer, MY_PURCHASES_INITIAL,
  historyReducer, HISTORY_INITIAL,
  libraryReducer, LIBRARY_INITIAL,
} from '../hooks/useTabFilterState'
import type { TransactionRecord } from '../services/transactionHistory'
import type { EncryptionDisplay, BidDisplay } from '../services/api'
import type { SnarkProofInputs, SnarkProof } from '../services/snark'
import type { CreateListingFormData } from '../components/CreateListingModal'

type TabId = 'marketplace' | 'my-sales' | 'my-purchases' | 'history' | 'library';

interface Tab {
  id: TabId;
  label: string;
}

const TABS: Tab[] = [
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'my-sales', label: 'My Sales' },
  { id: 'my-purchases', label: 'My Purchases' },
  { id: 'history', label: 'History' },
  { id: 'library', label: 'Library' },
];

export default function Dashboard() {
  const { disconnect, wallet, refreshBalance } = useWalletContext()
  const address = useAddress()
  const lovelace = useLovelace()
  const { isReady: wasmReady, isLoading: wasmLoading, progress: wasmProgress } = useWasm()
  const { stage: nodeStage, syncProgress: nodeSyncProgress, kupoSyncProgress, tipSlot } = useNode()
  const navigate = useNavigate()
  const { hasOpenModal } = useModal()
  const walletHealth = useWalletHealth(wallet, tipSlot, nodeStage)
  const [copied, setCopied] = useState(false)
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

  const [myListingsCount, setMyListingsCount] = useState<number | null>(null)
  const [myBidsCount, setMyBidsCount] = useState<number | null>(null)
  const [acceptedBidCount, setAcceptedBidCount] = useState(0)
  const [libraryCount, setLibraryCount] = useState<number | null>(null)
  const [showCreateListing, setShowCreateListing] = useState(false)
  const [showPlaceBid, setShowPlaceBid] = useState(false)
  const [showDecrypt, setShowDecrypt] = useState(false)
  const [selectedEncryption, setSelectedEncryption] = useState<EncryptionDisplay | null>(null)
  const [selectedBidCount, setSelectedBidCount] = useState(0)
  const [selectedBid, setSelectedBid] = useState<BidDisplay | null>(null)
  const [failedDecryptTokens, setFailedDecryptTokens] = useState<Set<string>>(new Set())
  const { refreshSignal, historySignal, triggerRefresh, triggerHistoryRefresh, triggerTransactionRefresh } = useDataRefresh()
  const [lastRefreshTime, setLastRefreshTime] = useState(Date.now())
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [relativeTime, setRelativeTime] = useState('just now')
  const [txHistory, setTxHistory] = useState<TransactionRecord[]>([])
  // Accept bid flow state
  const [showSnarkModal, setShowSnarkModal] = useState(false)
  const [snarkInputs, setSnarkInputs] = useState<SnarkProofInputs | null>(null)
  const [acceptBidEncryption, setAcceptBidEncryption] = useState<EncryptionDisplay | null>(null)
  const [acceptBidBid, setAcceptBidBid] = useState<BidDisplay | null>(null)
  const [acceptBidA0, setAcceptBidA0] = useState<bigint | null>(null)
  const [acceptBidR0, setAcceptBidR0] = useState<bigint | null>(null)
  const [acceptBidHk, setAcceptBidHk] = useState<bigint | null>(null)
  const toast = useToast()
  const [iagonConnected, setIagonConnected] = useState(false)

  // Refresh handler for manual data refresh
  const handleRefresh = useCallback(() => {
    if (isRefreshing) return
    setIsRefreshing(true)
    triggerRefresh()
    setLastRefreshTime(Date.now())
    setRelativeTime('just now')
    setTimeout(() => setIsRefreshing(false), 2000)
  }, [isRefreshing, triggerRefresh])

  // Update relative time display every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const seconds = Math.floor((Date.now() - lastRefreshTime) / 1000)
      if (seconds < 10) setRelativeTime('just now')
      else if (seconds < 60) setRelativeTime(`${seconds}s ago`)
      else if (seconds < 3600) setRelativeTime(`${Math.floor(seconds / 60)}m ago`)
      else setRelativeTime(`${Math.floor(seconds / 3600)}h ago`)
    }, 5000)
    return () => clearInterval(interval)
  }, [lastRefreshTime])

  // Reset timestamp when data refreshes externally (e.g. after tx submission)
  useEffect(() => {
    setLastRefreshTime(Date.now())
    setRelativeTime('just now')
  }, [refreshSignal])

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

  // Check Iagon connection status; silently auto-connect if not yet connected
  useEffect(() => {
    let cancelled = false
    isIagonConnected()
      .then(connected => {
        if (cancelled) return
        if (connected) {
          setIagonConnected(true)
        } else if (wallet && address) {
          // Silently attempt CIP-8 auth — succeeds if wallet has an Iagon account
          connectIagon(wallet, address)
            .then(() => { if (!cancelled) setIagonConnected(true) })
            .catch(() => { if (!cancelled) setIagonConnected(false) })
        } else {
          setIagonConnected(false)
        }
      })
      .catch(() => { if (!cancelled) setIagonConnected(false) })
    return () => { cancelled = true }
  }, [wallet, address])

  // ── Draft recovery: check for unfinished file listings on startup ─────
  const [recoverableDraft, setRecoverableDraft] = useState<ListingDraft | null>(null)

  useEffect(() => {
    let cancelled = false
    getRecoverableDrafts()
      .then(drafts => {
        if (cancelled || drafts.length === 0) return
        // Show the most recent recoverable draft
        setRecoverableDraft(drafts[0])
      })
      .catch((err) => console.warn('Draft recovery check failed:', err))
    return () => { cancelled = true }
  }, [])

  // Confirmation modal state for destructive actions
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    message: string
    description?: string
    confirmLabel: string
    onConfirm: () => Promise<void>
  } | null>(null)
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

  // Hydrate marketplace filters from localStorage once PKH is known
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (!userPkh || hydratedRef.current) return
    hydratedRef.current = true
    const saved = getPersistedFilters(userPkh)
    if (saved) {
      marketplaceDispatch({ type: 'HYDRATE', payload: saved })
    }
  }, [userPkh])

  // Debounced persistence of marketplace filters to localStorage
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    if (!userPkh || !hydratedRef.current) return
    clearTimeout(persistTimeoutRef.current)
    persistTimeoutRef.current = setTimeout(() => {
      persistFilters(userPkh, marketplaceFilters)
    }, 300)
    return () => clearTimeout(persistTimeoutRef.current)
  }, [userPkh, marketplaceFilters])

  // Bid notification system — watches tipSlot for new bids on seller's listings
  const bidNotifications = useBidNotifications(userPkh, tipSlot, nodeStage)

  // Fire toast when new bids arrive mid-session (not on initial load).
  // Groups multiple bid arrivals within a 5-second window into a single notification.
  // toast is excluded from deps: its methods are stable useCallbacks but the
  // object reference is recreated each render (no useMemo in useToast).
  const isInitialBidCheck = useRef(true)
  const lastNotifiedCountRef = useRef(0)
  const notificationTimerRef = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    if (!bidNotifications.isReady) return
    if (isInitialBidCheck.current) {
      isInitialBidCheck.current = false
      lastNotifiedCountRef.current = bidNotifications.unseenBidCount
      return
    }

    const newCount = bidNotifications.unseenBidCount

    // Count dropped (user viewed My Sales) or unchanged — sync ref, skip notification
    if (newCount <= lastNotifiedCountRef.current) {
      lastNotifiedCountRef.current = newCount
      return
    }

    // Debounce: clear any pending timer and wait 5s for more bids to arrive
    if (notificationTimerRef.current) {
      clearTimeout(notificationTimerRef.current)
    }

    notificationTimerRef.current = setTimeout(() => {
      const delta = newCount - lastNotifiedCountRef.current
      lastNotifiedCountRef.current = newCount
      if (delta <= 0) return

      const label = delta === 1 ? 'bid' : 'bids'
      toast.info(
        'New Bids Received',
        `You have ${delta} new ${label} on your listings`,
        8000
      )
      playNotificationSound()
      sendDesktopNotification('New Bids Received', `You have ${delta} new ${label} on your listings`)
    }, 5000)

    return () => {
      if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidNotifications.unseenBidCount, bidNotifications.isReady])

  // Mark bids as seen when user switches to My Sales tab
  const { markAllSeen } = bidNotifications
  useEffect(() => {
    if (activeTab === 'my-sales') {
      markAllSeen()
    }
  }, [activeTab, markAllSeen])

  // Load transaction history when PKH changes
  useEffect(() => {
    if (userPkh) {
      setTxHistory(getTransactions(userPkh))
    } else {
      setTxHistory([])
    }
  }, [userPkh, historySignal])

  // Eagerly refresh balance when Dashboard mounts and node is synced.
  // Covers the gap between wallet unlock (lovelace=null) and the first
  // tipSlot change (~20s). Only fires once via ref guard.
  const initialBalanceFetched = useRef(false)
  useEffect(() => {
    if (nodeStage === 'synced' && !initialBalanceFetched.current) {
      initialBalanceFetched.current = true
      refreshBalance()
    }
  }, [nodeStage, refreshBalance])

  // Record a transaction in local history (escalating retries are handled
  // by triggerTransactionRefresh at each call site).
  const recordTransaction = useCallback((record: TransactionRecord) => {
    if (!userPkh) return
    addTransaction(userPkh, record)
    setTxHistory(getTransactions(userPkh))
  }, [userPkh])

  const handleDraftRecovery = useCallback(async (action: 'resume' | 'discard') => {
    if (!recoverableDraft) return
    if (action === 'discard') {
      try {
        await updateListingDraft(recoverableDraft.id, { status: 'abandoned' })
      } catch {
        // best-effort
      }
      setRecoverableDraft(null)
      return
    }

    // Resume: retry from draft
    if (!wallet) {
      toast.error('Wallet Required', 'Connect your wallet to resume the listing.')
      return
    }

    try {
      const result = await retryListingFromDraft(wallet, recoverableDraft)
      if (!result.success) {
        toast.error('Retry Failed', result.error || 'Failed to retry listing')
        return
      }

      if (result.txHash) {
        toast.transactionSuccess('Listing Resumed!', result.txHash, { type: 'create-listing' })
        recordTransaction({
          txHash: result.txHash,
          type: 'create-listing',
          tokenName: result.tokenName,
          timestamp: Date.now(),
          status: 'pending',
          description: recoverableDraft.description,
        })
      }
      setRecoverableDraft(null)
      triggerTransactionRefresh()
      setActiveTab('history')
    } catch (error) {
      toast.error(
        'Retry Failed',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  }, [recoverableDraft, wallet, toast, recordTransaction, setActiveTab, triggerTransactionRefresh])

  // Retry a listing from History tab (failed tx with a draft)
  const handleRetryListing = useCallback(async (draftId: string) => {
    if (!wallet) {
      toast.error('Wallet Required', 'Connect your wallet to retry the listing.')
      return
    }

    try {
      const { getListingDraft } = await import('../services/listingDraftStorage')
      const draft = await getListingDraft(draftId)
      if (!draft) {
        toast.error('Draft Not Found', 'The listing draft could not be found. It may have been cleaned up.')
        return
      }

      const result = await retryListingFromDraft(wallet, draft)
      if (!result.success) {
        toast.error('Retry Failed', result.error || 'Failed to retry listing')
        return
      }

      if (result.txHash) {
        toast.transactionSuccess('Listing Retried!', result.txHash, { type: 'create-listing' })
        recordTransaction({
          txHash: result.txHash,
          type: 'create-listing',
          tokenName: result.tokenName,
          timestamp: Date.now(),
          status: 'pending',
          description: draft.description,
          draftId,
        })
      }
      triggerTransactionRefresh()
    } catch (error) {
      toast.error(
        'Retry Failed',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  }, [wallet, toast, recordTransaction, triggerTransactionRefresh])

  const pendingTxCount = useMemo(
    () => txHistory.filter(tx => tx.status === 'pending').length,
    [txHistory]
  )

  const handleCopy = useCallback(async () => {
    if (!address) return
    const success = await copyToClipboard(address)
    if (success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else {
      toast.warning('Copy failed', 'Could not copy address to clipboard.')
    }
  }, [address, toast])

  const handleDisconnect = useCallback(() => {
    clearLastActiveTab()
    disconnect()
  }, [disconnect])

  const handlePlaceBid = useCallback((encryption: EncryptionDisplay, bidCount: number) => {
    if (!navigator.onLine) {
      toast.warning('You\'re offline', 'Bids require a network connection. Please reconnect and try again.')
      return
    }
    setSelectedEncryption(encryption)
    setSelectedBidCount(bidCount)
    setShowPlaceBid(true)
  }, [toast])

  const handlePlaceBidSubmit = useCallback(async (
    encryptionTokenName: string,
    bidAmountAda: number,
    encryptionUtxo: { txHash: string; outputIndex: number },
    futurePrice: number
  ) => {
    if (!wallet) {
      throw new Error('Wallet not connected')
    }

    // Show stub warning if applicable
    const stubWarning = getTransactionStubWarning()
    if (stubWarning) {
      console.warn(stubWarning)
    }

    const result = await placeBid(wallet, encryptionTokenName, bidAmountAda, encryptionUtxo, {
      futurePrice,
    })

    if (!result.success) {
      throw new Error(result.error || 'Failed to place bid')
    }

    // Show success message
    if (result.isStub) {
      toast.warning(
        'Bid Placed (Stub Mode)',
        `Bid placed in stub mode. No real transaction submitted. Amount: ${bidAmountAda} ADA`,
        8000
      )
    } else if (result.txHash) {
      toast.transactionSuccess('Bid Placed!', result.txHash, { type: 'place-bid', amountLovelace: Math.round(bidAmountAda * 1_000_000) })
    } else {
      toast.success('Bid Placed!', 'Transaction submitted successfully')
    }

    // Record in history
    if (result.txHash) {
      recordTransaction({
        txHash: result.txHash,
        type: 'place-bid',
        tokenName: result.tokenName,
        timestamp: Date.now(),
        status: result.isStub ? 'confirmed' : 'pending',
        description: `Bid ${bidAmountAda} ADA on ${encryptionTokenName.slice(0, 12)}...`,
        amountLovelace: Math.round(bidAmountAda * 1_000_000),
        counterparty: selectedEncryption?.sellerPkh,
      })
    }

    // Refresh and switch to History tab to show pending tx
    triggerTransactionRefresh()
    setActiveTab('history')
  }, [wallet, toast, recordTransaction, setActiveTab, triggerTransactionRefresh, selectedEncryption])

  const handleRemoveListing = useCallback((encryption: EncryptionDisplay) => {
    if (!wallet) {
      toast.error('Error', 'Wallet not connected')
      return
    }

    const label = encryption.tokenName.slice(0, 16) + '...'
    setConfirmAction({
      title: 'Remove Listing?',
      message: `This will permanently remove "${label}" from the marketplace and burn the encryption token. This action submits an on-chain transaction and cannot be undone.`,
      description: encryption.description,
      confirmLabel: 'Remove Listing',
      onConfirm: async () => {
        try {
          const result = await removeListing(wallet, {
            tokenName: encryption.tokenName,
            utxo: encryption.utxo,
            datum: encryption.datum,
          })

          if (!result.success) {
            throw new Error(result.error || 'Failed to remove listing')
          }

          if (result.isStub) {
            toast.warning(
              'Listing Removed (Stub Mode)',
              `Listing removed in stub mode. No real transaction submitted.`,
              8000
            )
          } else if (result.txHash) {
            toast.transactionSuccess('Listing Removed!', result.txHash, { type: 'remove-listing' })
          } else {
            toast.success('Listing Removed!', 'Transaction submitted successfully')
          }

          if (result.txHash) {
            recordTransaction({
              txHash: result.txHash,
              type: 'remove-listing',
              tokenName: encryption.tokenName,
              timestamp: Date.now(),
              status: result.isStub ? 'confirmed' : 'pending',
              description: encryption.description || `Remove ${encryption.tokenName.slice(0, 12)}...`,
            })
          }

          triggerTransactionRefresh()
          setActiveTab('history')
        } catch (error) {
          console.error('Failed to remove listing:', error)
          toast.error(
            'Failed to Remove Listing',
            error instanceof Error ? error.message : 'Unknown error occurred',
            0,
            { label: 'Retry', onClick: () => handleRemoveListing(encryption) }
          )
        }
      },
    })
  }, [wallet, toast, recordTransaction, setActiveTab, triggerTransactionRefresh])

  const handleAcceptBid = useCallback((encryption: EncryptionDisplay, bid: BidDisplay) => {
    // Check if WASM prover is ready
    if (!wasmReady) {
      toast.warning(
        'Prover Not Ready',
        'Accepting bids requires the zero-knowledge prover. Click the loading indicator in the header to start loading.',
        8000
      )
      if (!wasmLoading) {
        navigate('/loading')
      }
      return
    }

    if (!wallet) {
      toast.error('Error', 'Wallet not connected')
      return
    }

    const label = encryption.tokenName.slice(0, 16) + '...'
    const bidAda = (bid.amount / 1_000_000).toFixed(1)
    setConfirmAction({
      title: 'Accept Bid?',
      message: `Accept bid of ${bidAda} ADA on "${label}"? The buyer will receive the decryption key and your listing will close. This cannot be undone.`,
      description: encryption.description,
      confirmLabel: 'Accept Bid',
      onConfirm: async () => {
        try {
          // Step 1: Prepare SNARK inputs (computes V, W0, W1 for the circuit)
          toast.info('Preparing', 'Computing SNARK proof inputs...')
          const { inputs, a0, r0, hk } = await prepareSnarkInputs(bid)

          // Store state for after proof generation
          setAcceptBidEncryption(encryption)
          setAcceptBidBid(bid)
          setAcceptBidA0(a0)
          setAcceptBidR0(r0)
          setAcceptBidHk(hk)
          setSnarkInputs(inputs)

          // Step 2: Open SNARK proving modal
          setShowSnarkModal(true)
        } catch (error) {
          console.error('Failed to prepare SNARK inputs:', error)
          toast.error(
            'Failed to Prepare Proof',
            error instanceof Error ? error.message : 'Unknown error occurred',
            0,
            { label: 'Retry', onClick: () => handleAcceptBid(encryption, bid) }
          )
        }
      },
    })
  }, [toast, wasmReady, wasmLoading, navigate, wallet])

  // Called when the SNARK proof is generated (from SnarkProvingModal)
  const handleProofGenerated = useCallback(async (proof: SnarkProof) => {
    if (!wallet || !acceptBidEncryption || !acceptBidBid) {
      toast.error('Error', 'Missing accept-bid state')
      return
    }

    // Capture state before finally clears it, so the retry closure can reference them
    const savedEncryption = acceptBidEncryption
    const savedBid = acceptBidBid

    try {
      // Step 3: Submit SNARK transaction (Phase 12e)
      toast.info('Submitting', 'Submitting SNARK proof transaction...')
      if (!acceptBidA0 || !acceptBidR0 || !acceptBidHk) {
        throw new Error('Missing fresh secrets (a0, r0, hk) for SNARK transaction')
      }
      const result = await acceptBidSnark(wallet, acceptBidEncryption, acceptBidBid, proof, acceptBidA0, acceptBidR0, acceptBidHk)

      if (!result.success) {
        throw new Error(result.error || 'Failed to submit SNARK transaction')
      }

      if (result.isStub) {
        toast.warning(
          'Bid Accepted (Stub Mode)',
          `SNARK proof submitted in stub mode. No real transaction submitted.`,
          8000
        )
      } else if (result.txHash) {
        toast.transactionSuccess('SNARK Proof Submitted!', result.txHash, { type: 'accept-bid', amountLovelace: acceptBidBid.amount })
      }

      // Record in history
      if (result.txHash) {
        recordTransaction({
          txHash: result.txHash,
          type: 'accept-bid',
          tokenName: acceptBidEncryption.tokenName,
          timestamp: Date.now(),
          status: result.isStub ? 'confirmed' : 'pending',
          description: `Accept bid of ${(acceptBidBid.amount / 1_000_000).toLocaleString()} ADA (SNARK proof)`,
          amountLovelace: acceptBidBid.amount,
          counterparty: acceptBidBid.bidderPkh,
        })
      }

      // Refresh and switch to history
      triggerTransactionRefresh()
      setActiveTab('history')

      toast.warning(
        'Next Step',
        'Once the SNARK transaction confirms on-chain, return to My Sales to complete the re-encryption step.',
        10000
      )
    } catch (error) {
      console.error('Failed to submit SNARK transaction:', error)
      toast.error(
        'Failed to Accept Bid',
        error instanceof Error ? error.message : 'Unknown error occurred',
        0,
        { label: 'Retry', onClick: () => handleAcceptBid(savedEncryption, savedBid) }
      )
    } finally {
      // Clean up state
      setAcceptBidEncryption(null)
      setAcceptBidBid(null)
      setAcceptBidA0(null)
      setAcceptBidR0(null)
      setAcceptBidHk(null)
      setSnarkInputs(null)
      setShowSnarkModal(false)
    }
  }, [wallet, acceptBidEncryption, acceptBidBid, acceptBidA0, acceptBidR0, acceptBidHk, toast, recordTransaction, setActiveTab, triggerTransactionRefresh, handleAcceptBid])

  const handleCancelPending = useCallback((encryption: EncryptionDisplay) => {
    if (!wallet) {
      toast.error('Error', 'Wallet not connected')
      return
    }

    const label = encryption.description || encryption.tokenName.slice(0, 16) + '...'
    setConfirmAction({
      title: 'Cancel Pending Sale?',
      message: `This will cancel the pending sale for "${label}" and return the listing to active status. This submits an on-chain transaction.`,
      confirmLabel: 'Cancel Sale',
      onConfirm: async () => {
        try {
          const result = await cancelPendingListing(wallet, encryption)

          if (!result.success) {
            throw new Error(result.error || 'Failed to cancel pending listing')
          }

          if (result.isStub) {
            toast.warning(
              'Pending Cancelled (Stub Mode)',
              `Pending listing cancelled in stub mode. No real transaction submitted.`,
              8000
            )
          } else if (result.txHash) {
            toast.transactionSuccess('Pending Listing Cancelled!', result.txHash, { type: 'cancel-pending' })
          }

          if (result.txHash) {
            recordTransaction({
              txHash: result.txHash,
              type: 'cancel-pending',
              tokenName: encryption.tokenName,
              timestamp: Date.now(),
              status: result.isStub ? 'confirmed' : 'pending',
              description: `Cancel pending sale for ${encryption.tokenName.slice(0, 12)}...`,
            })
          }

          triggerTransactionRefresh()
          setActiveTab('history')
        } catch (error) {
          console.error('Failed to cancel pending listing:', error)
          toast.error(
            'Failed to Cancel Pending',
            error instanceof Error ? error.message : 'Unknown error occurred',
            0,
            { label: 'Retry', onClick: () => handleCancelPending(encryption) }
          )
        }
      },
    })
  }, [wallet, toast, recordTransaction, setActiveTab, triggerTransactionRefresh])

  const handleCompleteSale = useCallback(async (encryption: EncryptionDisplay) => {
    if (!wallet) {
      toast.error('Error', 'Wallet not connected')
      return
    }

    try {
      // Check if accept-bid secrets exist (indicates 12e was done from this browser)
      const secrets = await getAcceptBidSecrets(encryption.tokenName)
      if (!secrets) {
        toast.error(
          'Cannot Complete Sale',
          'Accept-bid secrets not found. The SNARK transaction may have been submitted from another browser, or browser data was cleared.'
        )
        return
      }

      // Find the bid that was accepted (using stored bid token name)
      const allBids = await bidsApi.getAll()
      const acceptedBid = allBids.find(b => b.tokenName === secrets.bidTokenName)
      if (!acceptedBid) {
        toast.error(
          'Bid Not Found',
          'The accepted bid could not be found on-chain. It may have been cancelled.'
        )
        return
      }

      console.log('[handleCompleteSale] acceptedBid:', JSON.stringify({ tokenName: acceptedBid.tokenName, futurePrice: acceptedBid.futurePrice, amount: acceptedBid.amount }))

      toast.info('Submitting', 'Submitting re-encryption transaction...')
      const result = await completeReEncryption(wallet, encryption, acceptedBid)

      if (!result.success) {
        throw new Error(result.error || 'Failed to complete re-encryption')
      }

      if (result.isStub) {
        toast.warning(
          'Sale Completed (Stub Mode)',
          'Re-encryption submitted in stub mode. No real transaction submitted.',
          8000
        )
      } else if (result.txHash) {
        toast.transactionSuccess('Sale Completed!', result.txHash, { type: 'complete-sale', amountLovelace: acceptedBid.amount })
      }

      // Record in history
      if (result.txHash) {
        recordTransaction({
          txHash: result.txHash,
          type: 'complete-sale',
          tokenName: encryption.tokenName,
          timestamp: Date.now(),
          status: result.isStub ? 'confirmed' : 'pending',
          description: `Complete sale of ${encryption.tokenName.slice(0, 12)}... (re-encryption)`,
          amountLovelace: acceptedBid.amount,
          counterparty: acceptedBid.bidderPkh,
        })
      }

      triggerTransactionRefresh()
      setActiveTab('history')
    } catch (error) {
      console.error('Failed to complete sale:', error)
      toast.error(
        'Failed to Complete Sale',
        error instanceof Error ? error.message : 'Unknown error occurred',
        0,
        { label: 'Retry', onClick: () => handleCompleteSale(encryption) }
      )
    }
  }, [wallet, toast, recordTransaction, setActiveTab, triggerTransactionRefresh])

  const handleCancelBid = useCallback((bid: BidDisplay) => {
    if (!wallet) {
      toast.error('Error', 'Wallet not connected')
      return
    }

    const amountAda = (bid.amount / 1_000_000).toLocaleString()
    setConfirmAction({
      title: 'Cancel Bid?',
      message: `This will cancel your bid of ${amountAda} ADA and return the funds to your wallet. This submits an on-chain transaction.`,
      confirmLabel: 'Cancel Bid',
      onConfirm: async () => {
        const stubWarning = getTransactionStubWarning()
        if (stubWarning) {
          console.warn(stubWarning)
        }

        try {
          const result = await cancelBid(wallet, {
            tokenName: bid.tokenName,
            utxo: bid.utxo,
            datum: bid.datum,
          })

          if (!result.success) {
            throw new Error(result.error || 'Failed to cancel bid')
          }

          if (result.isStub) {
            toast.warning(
              'Bid Cancelled (Stub Mode)',
              `Bid cancelled in stub mode. No real transaction submitted. Amount: ${amountAda} ADA`,
              8000
            )
          } else if (result.txHash) {
            toast.transactionSuccess('Bid Cancelled!', result.txHash, { type: 'cancel-bid', amountLovelace: bid.amount })
          } else {
            toast.success('Bid Cancelled!', 'Transaction submitted successfully')
          }

          if (result.txHash) {
            recordTransaction({
              txHash: result.txHash,
              type: 'cancel-bid',
              tokenName: bid.tokenName,
              timestamp: Date.now(),
              status: result.isStub ? 'confirmed' : 'pending',
              description: `Cancel bid of ${amountAda} ADA`,
              amountLovelace: bid.amount,
            })
          }

          triggerTransactionRefresh()
          setActiveTab('history')
        } catch (error) {
          console.error('Failed to cancel bid:', error)
          toast.error(
            'Failed to Cancel Bid',
            error instanceof Error ? error.message : 'Unknown error occurred',
            0,
            { label: 'Retry', onClick: () => handleCancelBid(bid) }
          )
        }
      },
    })
  }, [wallet, toast, recordTransaction, setActiveTab, triggerTransactionRefresh])

  const handleDecrypt = useCallback(async (bid: BidDisplay) => {
    // Find the encryption associated with this bid
    try {
      const encryptions = await encryptionsApi.getAll()
      const encryption = encryptions.find(e => e.tokenName === bid.encryptionToken)

      setSelectedBid(bid)
      setSelectedEncryption(encryption || null)
      setShowDecrypt(true)
    } catch (error) {
      console.error('Failed to fetch encryption details:', error)
      toast.error('Error', 'Failed to load encryption details')
    }
  }, [toast])

  const handleDecryptEncryption = useCallback((encryption: EncryptionDisplay) => {
    setSelectedBid(null)
    setSelectedEncryption(encryption)
    setShowDecrypt(true)
  }, [])

  const handleDecryptResult = useCallback((result: { success: boolean; encryptionToken: string }) => {
    if (result.success) {
      setFailedDecryptTokens((prev) => {
        const next = new Set(prev)
        next.delete(result.encryptionToken)
        return next
      })
      triggerRefresh()
    } else {
      setFailedDecryptTokens((prev) => new Set(prev).add(result.encryptionToken))
    }
  }, [triggerRefresh])

  const handleCreateListing = useCallback(async (
    formData: CreateListingFormData,
    onProgress?: (step: ListingCreationStep) => void,
  ) => {
    if (!wallet) {
      throw new Error('Wallet not connected')
    }

    // Show stub warning if applicable
    const stubWarning = getTransactionStubWarning()
    if (stubWarning) {
      console.warn(stubWarning)
    }

    const result = await createListing(wallet, formData, onProgress)

    if (!result.success) {
      throw new Error(result.error || 'Failed to create listing')
    }

    // Save content to local library so the creator's own files appear in Library tab
    if (result.tokenName) {
      try {
        const category = formData.category;
        const contentBytes = category === 'text'
          ? new TextEncoder().encode(formData.secretMessage)
          : new Uint8Array(await formData.file!.arrayBuffer());

        await saveDecryptedContent(result.tokenName, category, contentBytes);
        await saveContentMetadata({
          tokenName: result.tokenName,
          description: formData.description,
          suggestedPrice: formData.suggestedPrice ? parseFloat(formData.suggestedPrice) : undefined,
          storageLayer: category === 'text' ? 'on-chain' : 'iagon',
          imageLink: formData.imageLink || undefined,
          category,
          seller: address,
          decryptedAt: new Date().toISOString(),
          fileSize: contentBytes.length,
        });
      } catch (err) {
        console.warn('Failed to save listing content to library:', err);
      }
    }

    // Show success message
    if (result.isStub) {
      toast.warning(
        'Listing Created (Stub Mode)',
        `Listing created in stub mode. No real transaction submitted. Token: ${result.tokenName?.slice(0, 12)}...`,
        8000
      )
    } else if (result.txHash) {
      toast.transactionSuccess('Listing Created!', result.txHash, { type: 'create-listing' })
    } else {
      toast.success('Listing Created!', 'Transaction submitted successfully')
    }

    // Record in history (include draftId for file listings so retry is possible)
    if (result.txHash) {
      recordTransaction({
        txHash: result.txHash,
        type: 'create-listing',
        tokenName: result.tokenName,
        timestamp: Date.now(),
        status: result.isStub ? 'confirmed' : 'pending',
        description: formData.description,
        draftId: result.draftId,
      })
    }

    // Refresh and switch to History tab to show pending tx
    triggerTransactionRefresh()
    setActiveTab('history')
  }, [wallet, address, toast, recordTransaction, setActiveTab, triggerTransactionRefresh])

  // Fetch user stats
  useEffect(() => {
    if (!userPkh) return

    const fetchStats = async () => {
      try {
        const encryptions = await encryptionsApi.getAll()
        const bids = await bidsApi.getAll()

        // Count listings owned by this wallet (PKH from datum)
        const userListings = encryptions.filter(
          e => e.sellerPkh === userPkh && e.status === 'active'
        )
        setMyListingsCount(userListings.length)

        // Count pending bids placed by this wallet (PKH from datum)
        const userBids = bids.filter(
          b => b.bidderPkh === userPkh && b.status === 'pending'
        )
        setMyBidsCount(userBids.length)

        // Count accepted bids where user can decrypt
        const accepted = bids.filter(
          b => b.bidderPkh === userPkh && b.status === 'accepted'
        )
        setAcceptedBidCount(accepted.length)

        // Best-effort cleanup of stale secrets after confirmed ownership changes
        cleanupStaleSecrets(userPkh, encryptions).catch((err) => console.warn('Stale secret cleanup failed:', err))
      } catch (error) {
        console.error('Failed to fetch stats:', error)
        setMyListingsCount(0)
        setMyBidsCount(0)
        setAcceptedBidCount(0)
      }

      // Fetch library count (Tauri command, independent of API)
      try {
        const items = await listLibraryItems()
        setLibraryCount(items.length)
      } catch {
        setLibraryCount(0)
      }
    }

    fetchStats()
  }, [userPkh, refreshSignal])

  const handleOpenCreateListing = useCallback(() => setShowCreateListing(true), [])

  const tabPanelClass = (tabId: TabId) =>
    activeTab !== tabId ? 'hidden' : undefined

  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <nav className="h-16 border-b border-[var(--border-subtle)] px-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold">Veiled</h1>
          <span className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)]"></span>
            Preprod
          </span>
          {/* Node Sync Indicator */}
          {nodeStage === 'synced' ? (
            <span className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--success)] bg-[var(--success-muted)] border border-[var(--success)]/30 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
              Node Ready
            </span>
          ) : nodeStage === 'syncing' ? (
            <button
              onClick={() => navigate('/node-sync')}
              className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--warning)] bg-[var(--warning)]/10 border border-[var(--warning)]/30 rounded-full hover:bg-[var(--warning)]/20 transition-all cursor-pointer"
              title="Click to view sync progress"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)] animate-pulse"></span>
              Syncing {Math.round(Math.min(nodeSyncProgress, kupoSyncProgress))}%
            </button>
          ) : nodeStage === 'error' ? (
            <button
              onClick={() => navigate('/node-sync')}
              className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--error)] bg-[var(--error)]/10 border border-[var(--error)]/30 rounded-full hover:bg-[var(--error)]/20 transition-all cursor-pointer"
              title="Node error - click for details"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--error)]"></span>
              Node Error
            </button>
          ) : nodeStage === 'starting' || nodeStage === 'bootstrapping' ? (
            <button
              onClick={() => navigate('/node-sync')}
              className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--accent)] bg-[var(--accent-muted)] border border-[var(--accent)]/30 rounded-full hover:bg-[var(--accent)]/20 transition-all cursor-pointer"
              title="Click to view node progress"
            >
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              {nodeStage === 'bootstrapping' ? 'Bootstrapping' : 'Starting'}
            </button>
          ) : (
            <button
              onClick={() => navigate('/node-sync')}
              className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-full hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all cursor-pointer"
              title="Node offline - click to start"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)]"></span>
              Node Offline
            </button>
          )}
          {/* WASM Prover Indicator */}
          {wasmReady ? (
            <span className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--success)] bg-[var(--success-muted)] border border-[var(--success)]/30 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
              Prover Ready
            </span>
          ) : wasmLoading ? (
            <button
              onClick={() => navigate('/loading')}
              className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--accent)] bg-[var(--accent-muted)] border border-[var(--accent)]/30 rounded-full hover:bg-[var(--accent)]/20 transition-all cursor-pointer"
              title="Click to view loading progress"
            >
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Prover {Math.round(wasmProgress)}%
            </button>
          ) : null}
          {/* Iagon Connection Indicator */}
          {iagonConnected ? (
            <span className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--success)] bg-[var(--success-muted)] border border-[var(--success)]/30 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
              Iagon Ready
            </span>
          ) : (
            <button
              onClick={() => navigate('/settings')}
              className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-full hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all cursor-pointer"
              title="Iagon not connected - click to configure"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)]"></span>
              Iagon Offline
            </button>
          )}
          {/* Collateral Indicator */}
          {nodeStage === 'synced' && !walletHealth.isChecking && (
            walletHealth.hasCollateral ? (
              <span className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--success)] bg-[var(--success-muted)] border border-[var(--success)]/30 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
                Collateral Set
              </span>
            ) : (
              <button
                onClick={() => navigate('/settings', { state: { section: 'wallet' } })}
                className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--warning)] bg-[var(--warning)]/10 border border-[var(--warning)]/30 rounded-full hover:bg-[var(--warning)]/20 transition-all cursor-pointer"
                title="No collateral UTxO found — click to set up in Settings"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)] animate-pulse"></span>
                No Collateral
              </button>
            )
          )}
        </div>
        <div className="flex items-center gap-4">
          {/* Create Listing Button */}
          <button
            onClick={() => setShowCreateListing(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Listing
          </button>

          {/* ADA Balance */}
          {lovelace ? (
            <div className="px-3 py-1.5 text-sm font-medium text-[var(--accent)] bg-[var(--accent-muted)] rounded-[var(--radius-md)]">
              {formatAdaDisplay(lovelace)} ADA
            </div>
          ) : (
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--text-tertiary)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)]"
              title="Waiting for Kupo to start. Your funds are safe."
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Balance unavailable
            </div>
          )}

          {/* Address with copy button */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] font-mono bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] btn-base btn-tertiary"
            title={address || 'Loading...'}
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
            title="Settings"
            aria-label="Settings"
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
            Disconnect
          </button>
        </div>
      </nav>

      {/* Draft Recovery Banner — sticky below nav, persists across scrolling/tab switches */}
      {recoverableDraft && (
        <div className="sticky top-16 z-40 animate-[slideDown_300ms_ease-out]">
          <div className="max-w-7xl mx-auto px-6 pt-3">
            <div className="p-4 bg-[var(--warning)]/10 border border-[var(--warning)]/30 rounded-[var(--radius-lg)] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-[var(--text-primary)]">
                  Unfinished Listing Found
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  A file listing for "{recoverableDraft.originalFilename}" was uploaded but the transaction was not completed.
                  The file is still on Iagon — you can resume without re-uploading.
                </p>
              </div>
              <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                <button
                  onClick={() => handleDraftRecovery('discard')}
                  className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] btn-base btn-tertiary"
                >
                  Discard
                </button>
                <button
                  onClick={() => handleDraftRecovery('resume')}
                  className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] btn-base btn-primary"
                >
                  Resume Listing
                </button>
                <button
                  onClick={() => setRecoverableDraft(null)}
                  className="p-1 btn-base btn-icon"
                  title="Dismiss"
                  aria-label="Dismiss draft recovery banner"
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
            className={`bg-[var(--bg-card)] border rounded-[var(--radius-lg)] p-6 text-left transition-all duration-[var(--transition-fast)] cursor-pointer ${
              activeTab === 'my-sales'
                ? 'border-[var(--accent)] shadow-[var(--shadow-glow)]'
                : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)]'
            }`}
          >
            <h2 className="text-lg font-medium mb-2">My Listings</h2>
            <p className="text-2xl font-semibold text-[var(--accent)]">
              {myListingsCount === null ? '...' : `${myListingsCount} active`}
            </p>
            {bidNotifications.unseenBidCount > 0 && (
              <p className="text-sm text-[var(--success)] mt-1" aria-live="polite">
                {bidNotifications.unseenBidCount} new {bidNotifications.unseenBidCount === 1 ? 'bid' : 'bids'}
              </p>
            )}
          </button>
          <button
            onClick={() => setActiveTab('my-purchases')}
            className={`bg-[var(--bg-card)] border rounded-[var(--radius-lg)] p-6 text-left transition-all duration-[var(--transition-fast)] cursor-pointer ${
              activeTab === 'my-purchases'
                ? 'border-[var(--accent)] shadow-[var(--shadow-glow)]'
                : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)]'
            }`}
          >
            <h2 className="text-lg font-medium mb-2">My Bids</h2>
            <p className="text-2xl font-semibold text-[var(--accent)]">
              {myBidsCount === null ? '...' : `${myBidsCount} pending`}
            </p>
          </button>
          <button
            onClick={() => setActiveTab('library')}
            className={`bg-[var(--bg-card)] border rounded-[var(--radius-lg)] p-6 text-left transition-all duration-[var(--transition-fast)] cursor-pointer ${
              activeTab === 'library'
                ? 'border-[var(--accent)] shadow-[var(--shadow-glow)]'
                : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)]'
            }`}
          >
            <h2 className="text-lg font-medium mb-2">Library</h2>
            <p className="text-2xl font-semibold text-[var(--accent)]">
              {libraryCount === null ? '...' : `${libraryCount} ${libraryCount === 1 ? 'item' : 'items'}`}
            </p>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`bg-[var(--bg-card)] border rounded-[var(--radius-lg)] p-6 text-left transition-all duration-[var(--transition-fast)] cursor-pointer ${
              activeTab === 'history'
                ? 'border-[var(--accent)] shadow-[var(--shadow-glow)]'
                : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)]'
            }`}
          >
            <h2 className="text-lg font-medium mb-2">Transactions</h2>
            <p className="text-2xl font-semibold text-[var(--accent)]">
              {pendingTxCount > 0 ? `${pendingTxCount} pending` : 'None pending'}
            </p>
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-[var(--border-subtle)] mb-6">
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
                title={`${tab.label} (Ctrl+${index + 1})`}
                className={`pb-3 transition-all duration-[var(--transition-fast)] cursor-pointer flex items-center gap-2 ${
                  activeTab === tab.id
                    ? 'text-[var(--text-primary)] border-b-2 border-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {tab.label}
                {tab.id === 'my-sales' && bidNotifications.unseenBidCount > 0 && (
                  <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-medium bg-[var(--accent)] text-white rounded-full animate-pulse" aria-label={`${bidNotifications.unseenBidCount} new bids`}>
                    {bidNotifications.unseenBidCount}
                  </span>
                )}
                {tab.id === 'my-purchases' && acceptedBidCount > 0 && (
                  <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-medium bg-[var(--success)] text-white rounded-full" aria-label={`${acceptedBidCount} accepted bids ready to decrypt`}>
                    {acceptedBidCount}
                  </span>
                )}
                {tab.id === 'history' && pendingTxCount > 0 && (
                  <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-medium bg-[var(--warning)] text-white rounded-full" aria-label={`${pendingTxCount} pending transactions`}>
                    {pendingTxCount}
                  </span>
                )}
              </button>
            ))}
          </div>
          {/* Refresh button + timestamp */}
          <div className="flex items-center gap-3 pb-3">
            <span className="text-xs text-[var(--text-muted)]">
              Updated {relativeTime}
            </span>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="Refresh data (Ctrl+R)"
              aria-label="Refresh data"
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
        </div>

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
                onPlaceBid={handlePlaceBid}
                onCreateListing={handleOpenCreateListing}
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
                onRemoveListing={handleRemoveListing}
                onAcceptBid={handleAcceptBid}
                onCancelPending={handleCancelPending}
                onCompleteSale={handleCompleteSale}
                onCreateListing={handleOpenCreateListing}
                onBidsViewed={bidNotifications.markListingSeen}
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
                onCancelBid={handleCancelBid}
                onDecrypt={handleDecrypt}
                onDecryptEncryption={handleDecryptEncryption}
                onSwitchTab={setActiveTab}
                filters={myPurchasesFilters}
                dispatch={myPurchasesDispatch}
                failedDecryptTokens={failedDecryptTokens}
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
                transactions={txHistory}
                onClearHistory={triggerHistoryRefresh}
                onHistoryUpdated={setTxHistory}
                onRetryListing={handleRetryListing}
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
                filters={libraryFilters}
                dispatch={libraryDispatch}
                onBulkDeleteResult={(message, hadErrors) =>
                  hadErrors ? toast.warning('Bulk Delete', message) : toast.success('Bulk Delete', message)
                }
              />
            </Suspense>
          </div>
        )}
      </main>

      {/* Scroll to Top Button */}
      <ScrollToTop />

      {/* Create Listing Modal */}
      <CreateListingModal
        isOpen={showCreateListing}
        onClose={() => setShowCreateListing(false)}
        onSubmit={handleCreateListing}
        isIagonConnected={iagonConnected}
      />

      {/* Place Bid Modal */}
      <PlaceBidModal
        isOpen={showPlaceBid}
        onClose={() => {
          setShowPlaceBid(false)
          setSelectedEncryption(null)
          setSelectedBidCount(0)
        }}
        onSubmit={handlePlaceBidSubmit}
        encryption={selectedEncryption}
        bidCount={selectedBidCount}
        balanceLovelace={lovelace ?? undefined}
      />

      {/* Decrypt Modal */}
      <DecryptModal
        isOpen={showDecrypt}
        onClose={() => {
          setShowDecrypt(false)
          setSelectedBid(null)
          setSelectedEncryption(null)
        }}
        bid={selectedBid}
        encryption={selectedEncryption}
        isIagonConnected={iagonConnected}
        onDecryptResult={handleDecryptResult}
        onSaveWarning={(msg) => toast.warning('Save failed', msg)}
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
        confirmLabel={confirmAction?.confirmLabel ?? 'Confirm'}
        confirmVariant="danger"
        loading={confirmLoading}
      />

      {/* SNARK Proving Modal (Accept Bid Step 1) */}
      <Suspense fallback={null}>
        <SnarkProvingModal
          isOpen={showSnarkModal}
          onClose={() => {
            setShowSnarkModal(false)
            setSnarkInputs(null)
            setAcceptBidEncryption(null)
            setAcceptBidBid(null)
            setAcceptBidA0(null)
            setAcceptBidR0(null)
            setAcceptBidHk(null)
          }}
          onProofGenerated={handleProofGenerated}
          inputs={snarkInputs}
        />
      </Suspense>

      {/* Toast Notifications */}
      <KeyboardShortcutsOverlay isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} queuedCount={toast.queuedCount} onDismissAll={toast.dismissAll} />
    </div>
  )
}
