import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWasm } from '../../contexts/WasmContext'
import {
  createListing, retryListingFromDraft, removeListing,
  cancelPendingListing, prepareSnarkInputs,
  acceptBidAndReEncrypt, completeReEncryption,
  getTransactionStubWarning,
  type ListingCreationStep, type ChainedAcceptStep,
} from '../../services/transactionBuilder'
import { getAcceptBidSecrets } from '../../services/acceptBidStorage'
import { bidsApi } from '../../services/api'
import { optimisticStore } from '../../services/optimisticStore'
import { saveDecryptedContent, saveContentMetadata } from '../../services/contentStorage'
import { getRecoverableDrafts, updateListingDraft, type ListingDraft } from '../../services/listingDraftStorage'
import type { DashboardActions } from './dashboardTypes'
import type { EncryptionDisplay, BidDisplay } from '../../services/api'
import type { SnarkProofInputs, SnarkProof } from '../../services/snark'
import type { CreateListingFormData } from '../../components/CreateListingModal'

interface UseSellerActionsParams {
  actions: DashboardActions
  iagonConnected: boolean
}

export function useSellerActions({ actions, iagonConnected: _iagonConnected }: UseSellerActionsParams) {
  const { wallet, address, userPkh, toast, recordTransaction, triggerTransactionRefresh, setConfirmAction, setActiveTab } = actions
  const { isReady: wasmReady, isLoading: wasmLoading } = useWasm()
  const navigate = useNavigate()

  // Create listing modal state
  const [showCreateListing, setShowCreateListing] = useState(false)

  // Draft recovery state
  const [recoverableDraft, setRecoverableDraft] = useState<ListingDraft | null>(null)

  // SNARK modal / accept-bid flow state
  const [showSnarkModal, setShowSnarkModal] = useState(false)
  const [snarkInputs, setSnarkInputs] = useState<SnarkProofInputs | null>(null)
  const [acceptBidEncryption, setAcceptBidEncryption] = useState<EncryptionDisplay | null>(null)
  const [acceptBidBid, setAcceptBidBid] = useState<BidDisplay | null>(null)
  const [acceptBidA0, setAcceptBidA0] = useState<bigint | null>(null)
  const [acceptBidR0, setAcceptBidR0] = useState<bigint | null>(null)
  const [acceptBidHk, setAcceptBidHk] = useState<bigint | null>(null)

  // Draft recovery check on mount
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
      const result = await retryListingFromDraft(wallet, recoverableDraft, undefined, (txHash, tokenName) => {
        recordTransaction({
          txHash,
          type: 'create-listing',
          tokenName,
          timestamp: Date.now(),
          status: 'pending',
          description: recoverableDraft.description,
        })
      })
      if (!result.success) {
        toast.error('Retry Failed', result.error || 'Failed to retry listing')
        return
      }

      if (result.txHash) {
        toast.transactionSuccess('Listing Resumed!', result.txHash, { type: 'create-listing' })
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

  const handleRetryListing = useCallback(async (draftId: string) => {
    if (!wallet) {
      toast.error('Wallet Required', 'Connect your wallet to retry the listing.')
      return
    }

    try {
      const { getListingDraft } = await import('../../services/listingDraftStorage')
      const draft = await getListingDraft(draftId)
      if (!draft) {
        toast.error('Draft Not Found', 'The listing draft could not be found. It may have been cleaned up.')
        return
      }

      const result = await retryListingFromDraft(wallet, draft, undefined, (txHash, tokenName) => {
        recordTransaction({
          txHash,
          type: 'create-listing',
          tokenName,
          timestamp: Date.now(),
          status: 'pending',
          description: draft.description,
          draftId,
        })
      })
      if (!result.success) {
        toast.error('Retry Failed', result.error || 'Failed to retry listing')
        return
      }

      if (result.txHash) {
        toast.transactionSuccess('Listing Retried!', result.txHash, { type: 'create-listing' })
      }
      triggerTransactionRefresh()
    } catch (error) {
      toast.error(
        'Retry Failed',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  }, [wallet, toast, recordTransaction, triggerTransactionRefresh])

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

    const result = await createListing(wallet, formData, onProgress, (txHash, tokenName) => {
      recordTransaction({
        txHash,
        type: 'create-listing',
        tokenName,
        timestamp: Date.now(),
        status: 'pending',
        description: formData.description,
        draftId: undefined, // will be set by builder return
      })
    })

    if (!result.success) {
      throw new Error(result.error || 'Failed to create listing')
    }

    // Save text content to local library (file-based listings are already
    // saved in transactionBuilder.ts via copyToLibrary)
    if (result.tokenName && formData.category === 'text') {
      try {
        const contentBytes = new TextEncoder().encode(formData.secretMessage);
        await saveDecryptedContent(result.tokenName, 'text', contentBytes);
        await saveContentMetadata({
          tokenName: result.tokenName,
          description: formData.description,
          suggestedPrice: formData.suggestedPrice ? parseFloat(formData.suggestedPrice) : undefined,
          storageLayer: 'on-chain',
          imageLink: formData.imageLink || undefined,
          category: 'text',
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

    // Record stub in history (real txs are recorded via onSubmitted callback)
    if (result.txHash && result.isStub) {
      recordTransaction({
        txHash: result.txHash,
        type: 'create-listing',
        tokenName: result.tokenName,
        timestamp: Date.now(),
        status: 'confirmed',
        description: formData.description,
        draftId: result.draftId,
      })
    }

    // Optimistic update — listing appears immediately in tabs
    if (result.txHash && result.tokenName && userPkh && address) {
      optimisticStore.addEncryption(result.tokenName, result.txHash, {
        tokenName: result.tokenName,
        seller: address,
        sellerPkh: userPkh,
        status: 'active',
        description: formData.description,
        suggestedPrice: formData.suggestedPrice ? parseFloat(formData.suggestedPrice) : undefined,
        storageLayer: formData.category === 'text' ? 'on-chain' : 'iagon',
        imageLink: formData.imageLink || undefined,
        category: formData.category,
        createdAt: new Date().toISOString(),
        utxo: { txHash: result.txHash, outputIndex: 0 },
        datum: {
          owner_vkh: userPkh,
          owner_g1: { generator: '', public_value: '' },
          token: result.tokenName,
          half_level: { r1b: '', r2_g1b: '', r4b: '' },
          full_level: null,
          capsule: { nonce: '', aad: '', ct: '' },
          status: { type: 'Open' },
        },
        _optimistic: true,
      })
    }

    // Refresh and switch to History tab to show pending tx
    triggerTransactionRefresh()
    setActiveTab('history')
  }, [wallet, address, toast, recordTransaction, setActiveTab, triggerTransactionRefresh, userPkh])

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
          }, (txHash) => {
            recordTransaction({
              txHash,
              type: 'remove-listing',
              tokenName: encryption.tokenName,
              timestamp: Date.now(),
              status: 'pending',
              description: encryption.description || `Remove ${encryption.tokenName.slice(0, 12)}...`,
            })
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
            if (result.txHash) {
              recordTransaction({
                txHash: result.txHash,
                type: 'remove-listing',
                tokenName: encryption.tokenName,
                timestamp: Date.now(),
                status: 'confirmed',
                description: encryption.description || `Remove ${encryption.tokenName.slice(0, 12)}...`,
              })
            }
          } else if (result.txHash) {
            toast.transactionSuccess('Listing Removed!', result.txHash, { type: 'remove-listing' })
          } else {
            toast.success('Listing Removed!', 'Transaction submitted successfully')
          }

          // Optimistic update — listing disappears immediately
          if (result.txHash) {
            optimisticStore.removeEncryption(encryption.tokenName, result.txHash)
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
  }, [wallet, toast, recordTransaction, setActiveTab, triggerTransactionRefresh, setConfirmAction])

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
  }, [toast, wasmReady, wasmLoading, navigate, wallet, setConfirmAction])

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
      // Submit SNARK proof + chain re-encryption in one flow
      if (!acceptBidA0 || !acceptBidR0 || !acceptBidHk) {
        throw new Error('Missing fresh secrets (a0, r0, hk) for SNARK transaction')
      }

      toast.info('Submitting', 'Submitting SNARK proof and chaining re-encryption...')

      const amount = (acceptBidBid.amount / 1_000_000).toLocaleString()
      const result = await acceptBidAndReEncrypt(
        wallet, acceptBidEncryption, acceptBidBid, proof,
        acceptBidA0, acceptBidR0, acceptBidHk,
        (step: ChainedAcceptStep) => {
          if (step === 'submitting-snark') toast.info('Step 1/2', 'Submitting SNARK proof transaction...')
          else if (step === 'building-reencrypt') toast.info('Step 2/2', 'Building re-encryption transaction...')
          else if (step === 'submitting-reencrypt') toast.info('Step 2/2', 'Submitting re-encryption transaction...')
          else if (step === 'complete') toast.success('Sale Complete', 'Both transactions submitted successfully!')
          else if (step === 'fallback') toast.warning('Partial Success', 'SNARK proof submitted. Re-encryption will need to be completed manually after confirmation.')
        },
        // onSnarkSubmitted — record SNARK tx immediately after submit
        (txHash) => {
          recordTransaction({
            txHash,
            type: 'accept-bid',
            tokenName: acceptBidEncryption.tokenName,
            timestamp: Date.now(),
            status: 'pending',
            description: `Accept bid SNARK proof of ${amount} ADA (Step 1/2)`,
            amountLovelace: acceptBidBid.amount,
            counterparty: acceptBidBid.bidderPkh,
          })
        },
        // onReEncryptSubmitted — record re-encryption tx immediately after submit
        (txHash) => {
          recordTransaction({
            txHash,
            type: 'accept-bid',
            tokenName: acceptBidEncryption.tokenName,
            timestamp: Date.now(),
            status: 'pending',
            description: `Complete re-encryption of ${amount} ADA (Step 2/2)`,
            amountLovelace: acceptBidBid.amount,
            counterparty: acceptBidBid.bidderPkh,
          })
        },
      )

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
        // Determine if this was a full chain or fallback
        const isChainedSuccess = !result.error
        const txType = isChainedSuccess ? 'Sale Completed!' : 'SNARK Proof Submitted!'
        toast.transactionSuccess(txType, result.txHash, { type: 'accept-bid', amountLovelace: acceptBidBid.amount })
      }

      // Optimistic update — listing status changes to pending
      if (result.txHash || result.snarkTxHash) {
        optimisticStore.updateEncryption(acceptBidEncryption.tokenName, result.txHash || result.snarkTxHash!, { status: 'pending' })
      }

      // Refresh and switch to history
      triggerTransactionRefresh()
      setActiveTab('history')

      // If chaining failed, show guidance for manual completion
      if (result.error) {
        toast.warning(
          'Next Step',
          'Once the SNARK transaction confirms on-chain, return to My Sales to complete the re-encryption step.',
          10000
        )
      }
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
          const result = await cancelPendingListing(wallet, encryption, (txHash) => {
            recordTransaction({
              txHash,
              type: 'cancel-pending',
              tokenName: encryption.tokenName,
              timestamp: Date.now(),
              status: 'pending',
              description: `Cancel pending sale for ${encryption.tokenName.slice(0, 12)}...`,
            })
          })

          if (!result.success) {
            throw new Error(result.error || 'Failed to cancel pending listing')
          }

          if (result.isStub) {
            toast.warning(
              'Pending Cancelled (Stub Mode)',
              `Pending listing cancelled in stub mode. No real transaction submitted.`,
              8000
            )
            if (result.txHash) {
              recordTransaction({
                txHash: result.txHash,
                type: 'cancel-pending',
                tokenName: encryption.tokenName,
                timestamp: Date.now(),
                status: 'confirmed',
                description: `Cancel pending sale for ${encryption.tokenName.slice(0, 12)}...`,
              })
            }
          } else if (result.txHash) {
            toast.transactionSuccess('Pending Listing Cancelled!', result.txHash, { type: 'cancel-pending' })
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
  }, [wallet, toast, recordTransaction, setActiveTab, triggerTransactionRefresh, setConfirmAction])

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
      const result = await completeReEncryption(wallet, encryption, acceptedBid, (txHash) => {
        recordTransaction({
          txHash,
          type: 'complete-sale',
          tokenName: encryption.tokenName,
          timestamp: Date.now(),
          status: 'pending',
          description: `Complete sale of ${encryption.tokenName.slice(0, 12)}... (re-encryption)`,
          amountLovelace: acceptedBid.amount,
          counterparty: acceptedBid.bidderPkh,
        })
      })

      if (!result.success) {
        throw new Error(result.error || 'Failed to complete re-encryption')
      }

      if (result.isStub) {
        toast.warning(
          'Sale Completed (Stub Mode)',
          'Re-encryption submitted in stub mode. No real transaction submitted.',
          8000
        )
        if (result.txHash) {
          recordTransaction({
            txHash: result.txHash,
            type: 'complete-sale',
            tokenName: encryption.tokenName,
            timestamp: Date.now(),
            status: 'confirmed',
            description: `Complete sale of ${encryption.tokenName.slice(0, 12)}... (re-encryption)`,
            amountLovelace: acceptedBid.amount,
            counterparty: acceptedBid.bidderPkh,
          })
        }
      } else if (result.txHash) {
        toast.transactionSuccess('Sale Completed!', result.txHash, { type: 'complete-sale', amountLovelace: acceptedBid.amount })
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

  const closeSnarkModal = useCallback(() => {
    setShowSnarkModal(false)
    setSnarkInputs(null)
    setAcceptBidEncryption(null)
    setAcceptBidBid(null)
    setAcceptBidA0(null)
    setAcceptBidR0(null)
    setAcceptBidHk(null)
  }, [])

  return {
    // Create listing
    showCreateListing,
    setShowCreateListing,
    handleCreateListing,
    // Draft recovery
    recoverableDraft,
    setRecoverableDraft,
    handleDraftRecovery,
    handleRetryListing,
    // Sales management
    handleRemoveListing,
    handleAcceptBid,
    handleProofGenerated,
    handleCompleteSale,
    handleCancelPending,
    // SNARK modal state
    showSnarkModal,
    snarkInputs,
    closeSnarkModal,
  }
}
