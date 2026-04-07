import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWasm } from '../../contexts/WasmContext'
import { useAcceptBidQueue } from '../../contexts/AcceptBidQueueContext'
import {
  createListing, createListingFromImport, retryListingFromDraft, removeListing,
  cancelPendingListing, updateListingPrice,
  completeReEncryption,
  getTransactionStubWarning,
  type ListingCreationStep,
  type ImportListingData,
} from '../../services/transactionBuilder'
import { getAcceptBidSecrets } from '../../services/acceptBidStorage'
import { bidsApi } from '../../services/api'
import { optimisticStore } from '../../services/optimisticStore'
import { saveDecryptedContent, saveContentMetadata } from '../../services/contentStorage'
import { getRecoverableDrafts, updateListingDraft, type ListingDraft } from '../../services/listingDraftStorage'
import type { DashboardActions } from './dashboardTypes'
import type { EncryptionDisplay, BidDisplay } from '../../services/api'
import type { CreateListingFormData } from '../../components/CreateListingModal'
import { readLibraryContent, type LibraryItem } from '../../services/libraryService'
import { invoke } from '@tauri-apps/api/core'

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

  // Relist from library state
  const [relistPrefill, setRelistPrefill] = useState<Partial<CreateListingFormData> | null>(null)

  // Import from Iagon modal state
  const [showImportListing, setShowImportListing] = useState(false)

  // Draft recovery state
  const [recoverableDraft, setRecoverableDraft] = useState<ListingDraft | null>(null)

  // Accept-bid queue integration
  const queue = useAcceptBidQueue()

  // Update price modal state
  const [showUpdatePriceModal, setShowUpdatePriceModal] = useState(false)
  const [updatePriceEncryption, setUpdatePriceEncryption] = useState<EncryptionDisplay | null>(null)

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
        toast.transactionSuccess('Listing Resumed!', result.txHash, { type: 'create-listing' }, { label: 'View History', onClick: () => setActiveTab('history') })
      }
      setRecoverableDraft(null)
      triggerTransactionRefresh()
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
      toast.transactionSuccess('Listing Created!', result.txHash, { type: 'create-listing' }, { label: 'View History', onClick: () => setActiveTab('history') })
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
        suggestedPrice: formData.suggestedPrice ? Math.round(parseFloat(formData.suggestedPrice) * 1_000_000) : undefined,
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
          new_price: formData.suggestedPrice ? Math.round(parseFloat(formData.suggestedPrice) * 1_000_000) : 0,
        },
        _optimistic: true,
      })
    }

    triggerTransactionRefresh()
  }, [wallet, address, toast, recordTransaction, setActiveTab, triggerTransactionRefresh, userPkh])

  const handleRelistFromLibrary = useCallback(async (item: LibraryItem) => {
    try {
      const contentPath = await invoke<string>('get_library_content_path', {
        tokenName: item.tokenName,
        category: item.category,
      })

      const fileName = contentPath.split('/').pop() || contentPath.split('\\').pop() || item.tokenName
      const prefill: Partial<CreateListingFormData> = {
        category: (item.category || 'other') as CreateListingFormData['category'],
        description: item.description || '',
        suggestedPrice: item.suggestedPrice != null ? String(item.suggestedPrice) : '',
        imageLink: item.imageLink || '',
        filePath: contentPath,
        fileName,
        fileSize: item.fileSize ?? null,
      }

      // For text listings, read the content and pre-fill secretMessage
      if (item.category === 'text') {
        try {
          const bytes = await readLibraryContent(item.tokenName, item.category)
          prefill.secretMessage = new TextDecoder().decode(bytes)
        } catch {
          // Non-fatal — user can still type the message manually
        }
      }

      setRelistPrefill(prefill)
      setShowCreateListing(true)
    } catch (err) {
      toast.error('Relist Failed', err instanceof Error ? err.message : 'Could not find library content file')
    }
  }, [toast])

  const handleImportListing = useCallback(async (
    data: ImportListingData,
    onProgress?: (step: ListingCreationStep) => void,
  ) => {
    if (!wallet) {
      throw new Error('Wallet not connected')
    }

    const stubWarning = getTransactionStubWarning()
    if (stubWarning) console.warn(stubWarning)

    const result = await createListingFromImport(wallet, data, onProgress, (txHash, tokenName) => {
      recordTransaction({
        txHash,
        type: 'create-listing',
        tokenName,
        timestamp: Date.now(),
        status: 'pending',
        description: data.description,
      })
    })

    if (!result.success) {
      throw new Error(result.error || 'Failed to create listing from import')
    }

    if (result.isStub) {
      toast.warning('Listing Created (Stub Mode)', `Import listing created in stub mode.`, 8000)
    } else if (result.txHash) {
      toast.transactionSuccess('Listing Created!', result.txHash, { type: 'create-listing' }, { label: 'View History', onClick: () => setActiveTab('history') })
    } else {
      toast.success('Listing Created!', 'Transaction submitted successfully')
    }

    // Optimistic update
    if (result.txHash && result.tokenName && userPkh && address) {
      optimisticStore.addEncryption(result.tokenName, result.txHash, {
        tokenName: result.tokenName,
        seller: address,
        sellerPkh: userPkh,
        status: 'active',
        description: data.description,
        suggestedPrice: data.suggestedPrice ? Math.round(parseFloat(data.suggestedPrice) * 1_000_000) : undefined,
        storageLayer: 'iagon',
        imageLink: data.imageLink || undefined,
        category: data.category,
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
          new_price: data.suggestedPrice ? Math.round(parseFloat(data.suggestedPrice) * 1_000_000) : 0,
        },
        _optimistic: true,
      })
    }

    triggerTransactionRefresh()
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
              description: encryption.description || `Remove ${encryption.tokenName}`,
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
                description: encryption.description || `Remove ${encryption.tokenName}`,
              })
            }
          } else if (result.txHash) {
            toast.transactionSuccess('Listing Removed!', result.txHash, { type: 'remove-listing' }, { label: 'View History', onClick: () => setActiveTab('history') })
          } else {
            toast.success('Listing Removed!', 'Transaction submitted successfully')
          }

          // Optimistic update — listing disappears immediately
          if (result.txHash) {
            optimisticStore.removeEncryption(encryption.tokenName, result.txHash)
          }

          triggerTransactionRefresh()
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

    const label = encryption.description
      ? encryption.description.slice(0, 30)
      : encryption.tokenName.slice(0, 16) + '...'
    const bidAda = (bid.amount / 1_000_000).toFixed(1)
    setConfirmAction({
      title: 'Accept Bid?',
      message: `Accept bid of ${bidAda} ADA on "${label}"? The buyer will receive the decryption key and your listing will close. This cannot be undone.`,
      description: encryption.description,
      confirmLabel: 'Accept Bid',
      onConfirm: async () => {
        const id = queue.enqueue(encryption, bid, true)
        if (id) {
          toast.info('Bid Queued', `"${label}" queued for processing. SNARK proof will generate in the background.`)
        } else {
          toast.warning('Already Queued', `"${label}" is already in the processing queue.`)
        }
      },
    })
  }, [toast, wasmReady, wasmLoading, navigate, wallet, setConfirmAction, queue])

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
              description: `Cancel pending sale for ${encryption.tokenName}`,
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
                description: `Cancel pending sale for ${encryption.tokenName}`,
              })
            }
          } else if (result.txHash) {
            toast.transactionSuccess('Pending Listing Cancelled!', result.txHash, { type: 'cancel-pending' }, { label: 'View History', onClick: () => setActiveTab('history') })
          }

          triggerTransactionRefresh()
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
          description: `Complete sale of ${encryption.tokenName} (re-encryption)`,
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
            description: `Complete sale of ${encryption.tokenName} (re-encryption)`,
            amountLovelace: acceptedBid.amount,
            counterparty: acceptedBid.bidderPkh,
          })
        }
      } else if (result.txHash) {
        toast.transactionSuccess('Sale Completed!', result.txHash, { type: 'complete-sale', amountLovelace: acceptedBid.amount }, { label: 'View History', onClick: () => setActiveTab('history') })
      }

      triggerTransactionRefresh()
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

  // ── Update Price ──────────────────────────────────────────────────

  const handleOpenUpdatePrice = useCallback((encryption: EncryptionDisplay) => {
    if (!wallet) {
      toast.error('Error', 'Wallet not connected')
      return
    }
    setUpdatePriceEncryption(encryption)
    setShowUpdatePriceModal(true)
  }, [wallet, toast])

  const handleSubmitUpdatePrice = useCallback(async (encryption: EncryptionDisplay, newPriceLovelace: number) => {
    if (!wallet) throw new Error('Wallet not connected')

    const result = await updateListingPrice(wallet, encryption, newPriceLovelace, (txHash) => {
      recordTransaction({
        txHash,
        type: 'update-price',
        tokenName: encryption.tokenName,
        timestamp: Date.now(),
        status: 'pending',
        description: `Update price for ${encryption.tokenName}`,
      })
    })

    if (!result.success) {
      throw new Error(result.error || 'Failed to update price')
    }

    if (result.isStub) {
      toast.warning('Price Updated (Stub Mode)', 'Price updated in stub mode.', 8000)
      if (result.txHash) {
        recordTransaction({
          txHash: result.txHash,
          type: 'update-price',
          tokenName: encryption.tokenName,
          timestamp: Date.now(),
          status: 'confirmed',
          description: `Update price for ${encryption.tokenName}`,
        })
      }
    } else if (result.txHash) {
      toast.transactionSuccess('Price Updated!', result.txHash, { type: 'update-price' }, { label: 'View History', onClick: () => setActiveTab('history') })
    }

    triggerTransactionRefresh()
    setShowUpdatePriceModal(false)
    setUpdatePriceEncryption(null)
  }, [wallet, toast, recordTransaction, triggerTransactionRefresh, setActiveTab])

  return {
    // Create listing
    showCreateListing,
    setShowCreateListing,
    handleCreateListing,
    // Relist from library
    relistPrefill,
    setRelistPrefill,
    handleRelistFromLibrary,
    // Import from Iagon
    showImportListing,
    setShowImportListing,
    handleImportListing,
    // Draft recovery
    recoverableDraft,
    setRecoverableDraft,
    handleDraftRecovery,
    handleRetryListing,
    // Sales management
    handleRemoveListing,
    handleAcceptBid,
    handleCompleteSale,
    handleCancelPending,
    // Update price
    handleOpenUpdatePrice,
    handleSubmitUpdatePrice,
    showUpdatePriceModal,
    setShowUpdatePriceModal,
    updatePriceEncryption,
  }
}
