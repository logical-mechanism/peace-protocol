import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  placeBid, cancelBid, updateBid,
  getTransactionStubWarning,
} from '../../services/transactionBuilder'
import { encryptionsApi } from '../../services/api'
import { optimisticStore } from '../../services/optimisticStore'
import { playSound } from '../../services/notificationSound'
import { markFirstBidCompleted, markFirstDecryptCompleted } from '../../services/onboardingStorage'
import type { DashboardActions } from './dashboardTypes'
import type { EncryptionDisplay, BidDisplay } from '../../services/api'

interface UseBuyerActionsParams {
  actions: DashboardActions
  lovelace: string | null | undefined
}

export function useBuyerActions({ actions }: UseBuyerActionsParams) {
  const { t } = useTranslation('notifications')
  const { wallet, address, userPkh, toast, recordTransaction, triggerTransactionRefresh, triggerRefresh, setConfirmAction, setActiveTab } = actions

  // Place bid modal state
  const [showPlaceBid, setShowPlaceBid] = useState(false)
  const [selectedEncryption, setSelectedEncryption] = useState<EncryptionDisplay | null>(null)
  const [selectedBidCount, setSelectedBidCount] = useState(0)

  // Decrypt modal state
  const [showDecrypt, setShowDecrypt] = useState(false)
  const [selectedBid, setSelectedBid] = useState<BidDisplay | null>(null)
  const [decryptOwnerPkh, setDecryptOwnerPkh] = useState<string | undefined>(undefined)
  const [failedDecryptTokens, setFailedDecryptTokens] = useState<Set<string>>(new Set())

  // Update bid modal state
  const [showUpdateBid, setShowUpdateBid] = useState(false)
  const [updateBidTarget, setUpdateBidTarget] = useState<BidDisplay | null>(null)

  const handlePlaceBid = useCallback((encryption: EncryptionDisplay, bidCount: number) => {
    if (!navigator.onLine) {
      toast.warning(t('toast.offlineTitle'), t('toast.offlineBidBody'))
      return
    }
    setSelectedEncryption(encryption)
    setSelectedBidCount(bidCount)
    setShowPlaceBid(true)
  }, [toast, t])

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
    }, (txHash, tokenName) => {
      recordTransaction({
        txHash,
        type: 'place-bid',
        tokenName,
        timestamp: Date.now(),
        status: 'pending',
        description: `Bid ${bidAmountAda} ADA on ${encryptionTokenName.slice(0, 12)}...`,
        amountLovelace: Math.round(bidAmountAda * 1_000_000),
        counterparty: selectedEncryption?.sellerPkh,
      })
    })

    if (!result.success) {
      playSound('tx_failed')
      throw new Error(result.error || 'Failed to place bid')
    }

    // Show success message
    if (result.isStub) {
      toast.warning(
        t('toast.bidPlacedStubTitle'),
        t('toast.bidPlacedStubBody', { amount: bidAmountAda }),
        8000
      )
    } else if (result.txHash) {
      toast.transactionSuccess(t('toast.bidPlacedTitle'), result.txHash, { type: 'place-bid', amountLovelace: Math.round(bidAmountAda * 1_000_000) }, { label: t('toast.actionViewHistory'), onClick: () => setActiveTab('history') })
    } else {
      toast.success(t('toast.bidPlacedTitle'), t('toast.bidPlacedBody'))
    }

    // Record stub in history (real txs are recorded via onSubmitted callback)
    if (result.txHash && result.isStub) {
      recordTransaction({
        txHash: result.txHash,
        type: 'place-bid',
        tokenName: result.tokenName,
        timestamp: Date.now(),
        status: 'confirmed',
        description: `Bid ${bidAmountAda} ADA on ${encryptionTokenName.slice(0, 12)}...`,
        amountLovelace: Math.round(bidAmountAda * 1_000_000),
        counterparty: selectedEncryption?.sellerPkh,
      })
    }

    // Mark first-bid tutorial as completed on successful bid
    markFirstBidCompleted()

    // Optimistic update — bid appears immediately in tabs
    if (result.txHash && result.tokenName && userPkh && address) {
      optimisticStore.addBid(result.tokenName, result.txHash, {
        tokenName: result.tokenName,
        bidder: address,
        bidderPkh: userPkh,
        encryptionToken: encryptionTokenName,
        amount: Math.round(bidAmountAda * 1_000_000),
        futurePrice: futurePrice,
        status: 'pending',
        createdAt: new Date().toISOString(),
        lockedUntil: 0,
        utxo: { txHash: result.txHash, outputIndex: 0 },
        datum: { owner_vkh: userPkh, owner_g1: { generator: '', public_value: '' }, pointer: result.tokenName, token: encryptionTokenName, locked_until: 0, new_price: 0 },
        _optimistic: true,
      })
    }

    triggerTransactionRefresh()
  }, [wallet, toast, t, recordTransaction, setActiveTab, triggerTransactionRefresh, selectedEncryption, userPkh, address])

  const handleCancelBid = useCallback((bid: BidDisplay) => {
    if (!wallet) {
      toast.error(t('toast.errorTitle'), t('toast.walletNotConnected'))
      return
    }

    const amountAda = (bid.amount / 1_000_000).toLocaleString()
    setConfirmAction({
      title: t('toast.cancelBidConfirmTitle'),
      message: t('toast.cancelBidConfirmBody', { amount: amountAda }),
      confirmLabel: t('toast.cancelBidConfirmLabel'),
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
          }, (txHash) => {
            recordTransaction({
              txHash,
              type: 'cancel-bid',
              tokenName: bid.tokenName,
              timestamp: Date.now(),
              status: 'pending',
              description: `Cancel bid of ${amountAda} ADA`,
              amountLovelace: bid.amount,
            })
          })

          if (!result.success) {
            playSound('tx_failed')
            throw new Error(result.error || 'Failed to cancel bid')
          }

          if (result.isStub) {
            toast.warning(
              t('toast.bidCancelledStubTitle'),
              t('toast.bidCancelledStubBody', { amount: amountAda }),
              8000
            )
            if (result.txHash) {
              recordTransaction({
                txHash: result.txHash,
                type: 'cancel-bid',
                tokenName: bid.tokenName,
                timestamp: Date.now(),
                status: 'confirmed',
                description: `Cancel bid of ${amountAda} ADA`,
                amountLovelace: bid.amount,
              })
            }
          } else if (result.txHash) {
            toast.transactionSuccess(t('toast.bidCancelledTitle'), result.txHash, { type: 'cancel-bid', amountLovelace: bid.amount }, { label: t('toast.actionViewHistory'), onClick: () => setActiveTab('history') })
          } else {
            toast.success(t('toast.bidCancelledTitle'), t('toast.bidCancelledBody'))
          }

          // Optimistic update — bid disappears immediately
          if (result.txHash) {
            optimisticStore.removeBid(bid.tokenName, result.txHash)
          }

          triggerTransactionRefresh()
        } catch (error) {
          console.error('Failed to cancel bid:', error)
          toast.error(
            t('toast.failedToCancelBidTitle'),
            error instanceof Error ? error.message : t('toast.unknownErrorOccurred'),
            0,
            { label: t('toast.actionRetry'), onClick: () => handleCancelBid(bid) }
          )
        }
      },
    })
  }, [wallet, toast, t, recordTransaction, setActiveTab, triggerTransactionRefresh, setConfirmAction])

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
      toast.error(t('toast.errorTitle'), t('toast.loadEncryptionFailedBody'))
    }
  }, [toast, t])

  const handleDecryptEncryption = useCallback((encryption: EncryptionDisplay, ownerPkh?: string) => {
    setSelectedBid(null)
    setSelectedEncryption(encryption)
    setDecryptOwnerPkh(ownerPkh)
    setShowDecrypt(true)
  }, [])

  const handleDecryptResult = useCallback((result: { success: boolean; encryptionToken: string }) => {
    if (result.success) {
      setFailedDecryptTokens((prev) => {
        const next = new Set(prev)
        next.delete(result.encryptionToken)
        return next
      })
      // Mark the first-decrypt tutorial completed on any successful library save.
      markFirstDecryptCompleted()
      triggerRefresh()
    } else {
      setFailedDecryptTokens((prev) => new Set(prev).add(result.encryptionToken))
    }
  }, [triggerRefresh])

  // ── Update Bid ──────────────────────────────────────────────────

  const handleOpenUpdateBid = useCallback((bid: BidDisplay) => {
    if (!wallet) {
      toast.error(t('toast.errorTitle'), t('toast.walletNotConnected'))
      return
    }
    setUpdateBidTarget(bid)
    setShowUpdateBid(true)
  }, [wallet, toast, t])

  const handleSubmitUpdateBid = useCallback(async (bid: BidDisplay, newAmountLovelace: number, newFuturePriceLovelace: number) => {
    if (!wallet) throw new Error('Wallet not connected')

    const amountAda = (newAmountLovelace / 1_000_000).toLocaleString()
    const result = await updateBid(wallet, bid, newAmountLovelace, newFuturePriceLovelace, (txHash) => {
      recordTransaction({
        txHash,
        type: 'update-bid',
        tokenName: bid.tokenName,
        timestamp: Date.now(),
        status: 'pending',
        description: `Update bid to ${amountAda} ADA on ${bid.encryptionToken.slice(0, 12)}...`,
        amountLovelace: newAmountLovelace,
      })
    })

    if (!result.success) {
      playSound('tx_failed')
      throw new Error(result.error || 'Failed to update bid')
    }

    if (result.isStub) {
      toast.warning(t('toast.bidUpdatedStubTitle'), t('toast.bidUpdatedStubBody'), 8000)
      if (result.txHash) {
        recordTransaction({
          txHash: result.txHash,
          type: 'update-bid',
          tokenName: bid.tokenName,
          timestamp: Date.now(),
          status: 'confirmed',
          description: `Update bid to ${amountAda} ADA on ${bid.encryptionToken.slice(0, 12)}...`,
          amountLovelace: newAmountLovelace,
        })
      }
    } else if (result.txHash) {
      toast.transactionSuccess(t('toast.bidUpdatedTitle'), result.txHash, { type: 'update-bid', amountLovelace: newAmountLovelace }, { label: t('toast.actionViewHistory'), onClick: () => setActiveTab('history') })
    }

    triggerTransactionRefresh()
    setShowUpdateBid(false)
    setUpdateBidTarget(null)
  }, [wallet, toast, t, recordTransaction, triggerTransactionRefresh, setActiveTab])

  const closePlaceBidModal = useCallback(() => {
    setShowPlaceBid(false)
    setSelectedEncryption(null)
    setSelectedBidCount(0)
  }, [])

  const closeDecryptModal = useCallback(() => {
    setShowDecrypt(false)
    setSelectedBid(null)
    setSelectedEncryption(null)
    setDecryptOwnerPkh(undefined)
  }, [])

  return {
    // Place bid
    showPlaceBid,
    selectedEncryption,
    selectedBidCount,
    handlePlaceBid,
    handlePlaceBidSubmit,
    closePlaceBidModal,
    // Cancel bid
    handleCancelBid,
    // Update bid
    showUpdateBid,
    updateBidTarget,
    handleOpenUpdateBid,
    handleSubmitUpdateBid,
    closeUpdateBidModal: useCallback(() => { setShowUpdateBid(false); setUpdateBidTarget(null); }, []),
    // Decrypt
    showDecrypt,
    selectedBid,
    decryptOwnerPkh,
    failedDecryptTokens,
    handleDecrypt,
    handleDecryptEncryption,
    handleDecryptResult,
    closeDecryptModal,
  }
}
