import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useBidNotifications } from '../../hooks/useBidNotifications'
import { playNotificationSound, playSound } from '../../services/notificationSound'
import { sendDesktopNotification } from '../../services/desktopNotifications'
import { cleanupStaleSecrets } from '../../services/secretCleanup'
import { encryptionsApi, bidsApi } from '../../services/api'
import { listLibraryItems } from '../../services/libraryService'
import { hasValidApiKey, connectIagon, onIagonAuthFailure } from '../../services/iagonAuth'
import { getTransactions, addTransaction } from '../../services/transactionHistory'
import { getPersistedFilters, persistFilters } from '../../services/filterStorage'
import type { TransactionRecord } from '../../services/transactionHistory'
import type { IWallet } from '@meshsdk/core'
import type { useToast } from '../../components/Toast'
import type { MarketplaceFilters, MarketplaceAction } from '../../hooks/useTabFilterState'
import type { NodeStage } from '../../contexts/NodeContext'

interface UseDashboardEffectsParams {
  userPkh: string | undefined
  tipSlot: number | null
  tipHeight: number | null
  nodeStage: NodeStage
  expressReady: boolean
  refreshSignal: number
  historySignal: number
  triggerSoftRefresh: () => void
  refreshBalance: () => void
  toast: ReturnType<typeof useToast>
  wallet: IWallet | null
  address: string | undefined
  marketplaceFilters: MarketplaceFilters
  marketplaceDispatch: React.Dispatch<MarketplaceAction>
}

export function useDashboardEffects({
  userPkh, tipSlot, tipHeight, nodeStage, expressReady,
  refreshSignal, historySignal, triggerSoftRefresh, refreshBalance,
  toast, wallet, address,
  marketplaceFilters, marketplaceDispatch,
}: UseDashboardEffectsParams) {
  const { t } = useTranslation('notifications')
  // Stats state
  const [myListingsCount, setMyListingsCount] = useState<number | null>(null)
  const [myBidsCount, setMyBidsCount] = useState<number | null>(null)
  const [acceptedBidCount, setAcceptedBidCount] = useState(0)
  const [libraryCount, setLibraryCount] = useState<number | null>(null)

  // Transaction history state
  const [txHistory, setTxHistory] = useState<TransactionRecord[]>([])

  // Iagon connection state
  const [iagonConnected, setIagonConnected] = useState(false)

  const pendingTxCount = useMemo(
    () => txHistory.filter(tx => tx.status === 'pending').length,
    [txHistory]
  )

  // Bid notification system
  const bidNotifications = useBidNotifications(userPkh, tipSlot, nodeStage, triggerSoftRefresh)

  // Fire toast when new bids arrive mid-session (not on initial load).
  const isInitialBidCheck = useRef(true)
  const lastNotifiedCountRef = useRef(0)
  const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
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

      toast.info(
        t('toast.newBidsReceivedTitle'),
        t('toast.newBidsReceivedBody', { count: delta }),
        8000
      )
      playNotificationSound()
      sendDesktopNotification(t('toast.newBidsReceivedTitle'), t('toast.newBidsReceivedBody', { count: delta }))
    }, 5000)

    return () => {
      if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidNotifications.unseenBidCount, bidNotifications.isReady])

  // Fire notification when a bid the user placed is accepted by a seller
  const isInitialAcceptedCheck = useRef(true)
  const lastAcceptedCountRef = useRef(0)
  useEffect(() => {
    if (isInitialAcceptedCheck.current) {
      isInitialAcceptedCheck.current = false
      lastAcceptedCountRef.current = acceptedBidCount
      return
    }
    if (acceptedBidCount > lastAcceptedCountRef.current) {
      const delta = acceptedBidCount - lastAcceptedCountRef.current
      toast.success(t('toast.bidAcceptedTitle'), t('toast.bidAcceptedBody', { count: delta }))
      playSound('bid_accepted')
      sendDesktopNotification(t('toast.desktopBidAcceptedTitle'), t('toast.desktopBidAcceptedBody', { count: delta }))
    }
    lastAcceptedCountRef.current = acceptedBidCount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptedBidCount])

  // Bid notifications are marked seen per-listing as the user views each listing's bids
  // (MySalesTab calls onBidsViewed={markListingSeen} when the bids modal opens).
  // Previously this effect called markAllSeen() on tab activation, which cleared the
  // badge even if the user scrolled past new listings without opening them — that
  // hid notifications they hadn't actually seen. Now the badge only decrements as
  // individual listings are inspected, matching the seen-per-listing storage model.

  // Load transaction history when PKH changes
  useEffect(() => {
    if (userPkh) {
      setTxHistory(getTransactions(userPkh))
    } else {
      setTxHistory([])
    }
  }, [userPkh, historySignal])

  // Eagerly refresh balance when Dashboard mounts and node is synced.
  const initialBalanceFetched = useRef(false)
  useEffect(() => {
    if (nodeStage === 'synced' && !initialBalanceFetched.current) {
      initialBalanceFetched.current = true
      refreshBalance()
    }
  }, [nodeStage, refreshBalance])

  // Hydrate marketplace filters from localStorage once PKH is known
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (!userPkh || hydratedRef.current) return
    hydratedRef.current = true
    const saved = getPersistedFilters(userPkh)
    if (saved) {
      marketplaceDispatch({ type: 'HYDRATE', payload: saved })
    }
  }, [userPkh, marketplaceDispatch])

  // Debounced persistence of marketplace filters to localStorage
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (!userPkh || !hydratedRef.current) return
    clearTimeout(persistTimeoutRef.current)
    persistTimeoutRef.current = setTimeout(() => {
      persistFilters(userPkh, marketplaceFilters)
    }, 300)
    return () => clearTimeout(persistTimeoutRef.current)
  }, [userPkh, marketplaceFilters])

  // Check Iagon connection status; silently auto-connect if not yet connected.
  // Uses `hasValidApiKey()` so an expired-but-stored key is cleaned up and the
  // indicator flips to offline — a bare file-existence check (isIagonConnected)
  // would leave the UI showing "ready" until the next upload failed.
  useEffect(() => {
    let cancelled = false
    hasValidApiKey()
      .then(valid => {
        if (cancelled) return
        if (valid) {
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

  // Any API call that rejects with AUTH_FAILED fires the auth-failure event.
  // Flip the indicator to offline immediately and warn the user so they know
  // why uploads/downloads stop working. Ref lets the closure use the latest
  // toast/t functions without subscribing on every render.
  const authFailureNotifiedRef = useRef(false)
  useEffect(() => {
    const unsubscribe = onIagonAuthFailure(() => {
      setIagonConnected(false)
      if (authFailureNotifiedRef.current) return
      authFailureNotifiedRef.current = true
      toast.warning(
        t('toast.iagonKeyExpiredTitle'),
        t('toast.iagonKeyExpiredBody'),
        0,
      )
      // Reset the de-dupe guard after a minute so a repeat disconnect later
      // in the session (e.g. user reconnects and the new key also expires)
      // will surface.
      setTimeout(() => {
        authFailureNotifiedRef.current = false
      }, 60_000)
    })
    return unsubscribe
  }, [toast, t])

  // Fetch user stats (waits for Express backend to be ready)
  useEffect(() => {
    if (!userPkh || !expressReady) return

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
        cleanupStaleSecrets(userPkh, encryptions, tipHeight ?? undefined).catch((err) => console.warn('Stale secret cleanup failed:', err))
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
  }, [userPkh, refreshSignal, expressReady, tipHeight])

  // Record a transaction in local history
  const recordTransaction = (record: TransactionRecord) => {
    if (!userPkh) return
    addTransaction(userPkh, record)
    setTxHistory(getTransactions(userPkh))
  }

  return {
    bidNotifications,
    txHistory,
    setTxHistory,
    pendingTxCount,
    myListingsCount,
    myBidsCount,
    acceptedBidCount,
    libraryCount,
    iagonConnected,
    setIagonConnected,
    recordTransaction,
  }
}
