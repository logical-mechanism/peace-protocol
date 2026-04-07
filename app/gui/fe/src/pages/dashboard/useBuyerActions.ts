import { useState, useCallback } from 'react'
import {
  placeBid, cancelBid, updateBid,
  getTransactionStubWarning,
} from '../../services/transactionBuilder'
import { encryptionsApi } from '../../services/api'
import { optimisticStore } from '../../services/optimisticStore'
import type { DashboardActions } from './dashboardTypes'
import type { EncryptionDisplay, BidDisplay } from '../../services/api'

interface UseBuyerActionsParams {
  actions: DashboardActions
  lovelace: string | null | undefined
}

export function useBuyerActions({ actions }: UseBuyerActionsParams) {
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
      toast.transactionSuccess('Bid Placed!', result.txHash, { type: 'place-bid', amountLovelace: Math.round(bidAmountAda * 1_000_000) }, { label: 'View History', onClick: () => setActiveTab('history') })
    } else {
      toast.success('Bid Placed!', 'Transaction submitted successfully')
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
  }, [wallet, toast, recordTransaction, setActiveTab, triggerTransactionRefresh, selectedEncryption, userPkh, address])

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
            throw new Error(result.error || 'Failed to cancel bid')
          }

          if (result.isStub) {
            toast.warning(
              'Bid Cancelled (Stub Mode)',
              `Bid cancelled in stub mode. No real transaction submitted. Amount: ${amountAda} ADA`,
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
            toast.transactionSuccess('Bid Cancelled!', result.txHash, { type: 'cancel-bid', amountLovelace: bid.amount }, { label: 'View History', onClick: () => setActiveTab('history') })
          } else {
            toast.success('Bid Cancelled!', 'Transaction submitted successfully')
          }

          // Optimistic update — bid disappears immediately
          if (result.txHash) {
            optimisticStore.removeBid(bid.tokenName, result.txHash)
          }

          triggerTransactionRefresh()
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
  }, [wallet, toast, recordTransaction, setActiveTab, triggerTransactionRefresh, setConfirmAction])

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
      triggerRefresh()
    } else {
      setFailedDecryptTokens((prev) => new Set(prev).add(result.encryptionToken))
    }
  }, [triggerRefresh])

  // ── Update Bid ──────────────────────────────────────────────────

  const handleOpenUpdateBid = useCallback((bid: BidDisplay) => {
    if (!wallet) {
      toast.error('Error', 'Wallet not connected')
      return
    }
    setUpdateBidTarget(bid)
    setShowUpdateBid(true)
  }, [wallet, toast])

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
      throw new Error(result.error || 'Failed to update bid')
    }

    if (result.isStub) {
      toast.warning('Bid Updated (Stub Mode)', 'Bid updated in stub mode.', 8000)
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
      toast.transactionSuccess('Bid Updated!', result.txHash, { type: 'update-bid', amountLovelace: newAmountLovelace }, { label: 'View History', onClick: () => setActiveTab('history') })
    }

    triggerTransactionRefresh()
    setShowUpdateBid(false)
    setUpdateBidTarget(null)
  }, [wallet, toast, recordTransaction, triggerTransactionRefresh, setActiveTab])

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
