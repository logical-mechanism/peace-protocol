import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
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
import { playSound } from '../../services/notificationSound'
import { saveDecryptedContent, saveContentMetadata } from '../../services/contentStorage'
import { getRecoverableDrafts, updateListingDraft, type ListingDraft } from '../../services/listingDraftStorage'
import { markFirstListingCompleted } from '../../services/onboardingStorage'
import type { DashboardActions } from './dashboardTypes'
import type { EncryptionDisplay, BidDisplay } from '../../services/api'
import type { CreateListingFormData } from '../../components/CreateListingModal'
import { buildCategoryPath } from '../../config/categories'
import { readLibraryContent, type LibraryItem } from '../../services/libraryService'
import { invoke } from '@tauri-apps/api/core'

interface UseSellerActionsParams {
  actions: DashboardActions
  iagonConnected: boolean
}

export function useSellerActions({ actions, iagonConnected: _iagonConnected }: UseSellerActionsParams) {
  const { t } = useTranslation('notifications')
  const { wallet, userPkh, toast, recordTransaction, triggerTransactionRefresh, setConfirmAction, setActiveTab } = actions
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
      toast.error(t('toast.walletRequiredTitle'), t('toast.walletRequiredResumeBody'))
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
        playSound('tx_failed')
        toast.error(t('toast.retryFailedTitle'), result.error || t('toast.retryFailedBody'))
        return
      }

      if (result.txHash) {
        toast.transactionSuccess(t('toast.listingResumedTitle'), result.txHash, { type: 'create-listing' }, { label: t('toast.actionViewHistory'), onClick: () => setActiveTab('history') })
      }
      setRecoverableDraft(null)
      triggerTransactionRefresh()
    } catch (error) {
      toast.error(
        t('toast.retryFailedTitle'),
        error instanceof Error ? error.message : t('toast.unknownError')
      )
    }
  }, [recoverableDraft, wallet, toast, t, recordTransaction, setActiveTab, triggerTransactionRefresh])

  const handleRetryListing = useCallback(async (draftId: string) => {
    if (!wallet) {
      toast.error(t('toast.walletRequiredTitle'), t('toast.walletRequiredRetryBody'))
      return
    }

    try {
      const { getListingDraft } = await import('../../services/listingDraftStorage')
      const draft = await getListingDraft(draftId)
      if (!draft) {
        toast.error(t('toast.draftNotFoundTitle'), t('toast.draftNotFoundBody'))
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
        playSound('tx_failed')
        toast.error(t('toast.retryFailedTitle'), result.error || t('toast.retryFailedBody'))
        return
      }

      if (result.txHash) {
        toast.transactionSuccess(t('toast.listingRetriedTitle'), result.txHash, { type: 'create-listing' })
      }
      triggerTransactionRefresh()
    } catch (error) {
      toast.error(
        t('toast.retryFailedTitle'),
        error instanceof Error ? error.message : t('toast.unknownError')
      )
    }
  }, [wallet, toast, t, recordTransaction, triggerTransactionRefresh])

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
      playSound('tx_failed')
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
          sellerPkh: userPkh ?? undefined,
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
        t('toast.listingCreatedStubTitle'),
        t('toast.listingCreatedStubBody', { token: result.tokenName?.slice(0, 12) }),
        8000
      )
    } else if (result.txHash) {
      toast.transactionSuccess(t('toast.listingCreatedTitle'), result.txHash, { type: 'create-listing' }, { label: t('toast.actionViewHistory'), onClick: () => setActiveTab('history') })
    } else {
      toast.success(t('toast.listingCreatedTitle'), t('toast.listingCreatedBody'))
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
    if (result.txHash && result.tokenName && userPkh) {
      optimisticStore.addEncryption(result.tokenName, result.txHash, {
        tokenName: result.tokenName,
        sellerPkh: userPkh,
        status: 'active',
        description: formData.description,
        suggestedPrice: formData.suggestedPrice ? Math.round(parseFloat(formData.suggestedPrice) * 1_000_000) : undefined,
        storageLayer: formData.category === 'text' ? 'on-chain' : 'iagon',
        imageLink: formData.imageLink || undefined,
        category: buildCategoryPath(formData.category, formData.subcategory),
        nsfw: formData.nsfw || undefined,
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

    // Mark first-listing tutorial as completed on successful listing
    markFirstListingCompleted()

    triggerTransactionRefresh()
  }, [wallet, toast, t, recordTransaction, setActiveTab, triggerTransactionRefresh, userPkh])

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
      toast.error(t('toast.relistFailedTitle'), err instanceof Error ? err.message : t('toast.relistFailedBody'))
    }
  }, [toast, t])

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
      playSound('tx_failed')
      throw new Error(result.error || 'Failed to create listing from import')
    }

    if (result.isStub) {
      toast.warning(t('toast.listingCreatedStubTitle'), t('toast.importListingStubBody'), 8000)
    } else if (result.txHash) {
      toast.transactionSuccess(t('toast.listingCreatedTitle'), result.txHash, { type: 'create-listing' }, { label: t('toast.actionViewHistory'), onClick: () => setActiveTab('history') })
    } else {
      toast.success(t('toast.listingCreatedTitle'), t('toast.listingCreatedBody'))
    }

    // Optimistic update
    if (result.txHash && result.tokenName && userPkh) {
      optimisticStore.addEncryption(result.tokenName, result.txHash, {
        tokenName: result.tokenName,
        sellerPkh: userPkh,
        status: 'active',
        description: data.description,
        suggestedPrice: data.suggestedPrice ? Math.round(parseFloat(data.suggestedPrice) * 1_000_000) : undefined,
        storageLayer: 'iagon',
        imageLink: data.imageLink || undefined,
        category: buildCategoryPath(data.category, data.subcategory),
        nsfw: data.nsfw || undefined,
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
  }, [wallet, toast, t, recordTransaction, setActiveTab, triggerTransactionRefresh, userPkh])

  const handleRemoveListing = useCallback((encryption: EncryptionDisplay) => {
    if (!wallet) {
      toast.error(t('toast.errorTitle'), t('toast.walletNotConnected'))
      return
    }

    const label = encryption.tokenName.slice(0, 16) + '...'
    setConfirmAction({
      title: t('toast.removeListingConfirmTitle'),
      message: t('toast.removeListingConfirmBody', { label }),
      description: encryption.description,
      confirmLabel: t('toast.removeListingConfirmLabel'),
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
            playSound('tx_failed')
            throw new Error(result.error || 'Failed to remove listing')
          }

          if (result.isStub) {
            toast.warning(
              t('toast.listingRemovedStubTitle'),
              t('toast.listingRemovedStubBody'),
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
            toast.transactionSuccess(t('toast.listingRemovedTitle'), result.txHash, { type: 'remove-listing' }, { label: t('toast.actionViewHistory'), onClick: () => setActiveTab('history') })
          } else {
            toast.success(t('toast.listingRemovedTitle'), t('toast.listingRemovedBody'))
          }

          // Optimistic update — listing disappears immediately
          if (result.txHash) {
            optimisticStore.removeEncryption(encryption.tokenName, result.txHash)
          }

          triggerTransactionRefresh()
        } catch (error) {
          console.error('Failed to remove listing:', error)
          toast.error(
            t('toast.failedToRemoveTitle'),
            error instanceof Error ? error.message : t('toast.unknownErrorOccurred'),
            0,
            { label: t('toast.actionRetry'), onClick: () => handleRemoveListing(encryption) }
          )
        }
      },
    })
  }, [wallet, toast, t, recordTransaction, setActiveTab, triggerTransactionRefresh, setConfirmAction])

  const handleAcceptBid = useCallback((encryption: EncryptionDisplay, bid: BidDisplay) => {
    // Check if WASM prover is ready
    if (!wasmReady) {
      toast.warning(
        t('toast.proverNotReadyTitle'),
        t('toast.proverNotReadyBody'),
        8000
      )
      if (!wasmLoading) {
        navigate('/loading')
      }
      return
    }

    if (!wallet) {
      toast.error(t('toast.errorTitle'), t('toast.walletNotConnected'))
      return
    }

    const label = encryption.description
      ? encryption.description.slice(0, 30)
      : encryption.tokenName.slice(0, 16) + '...'
    const bidAda = (bid.amount / 1_000_000).toFixed(1)
    setConfirmAction({
      title: t('toast.acceptBidConfirmTitle'),
      message: t('toast.acceptBidConfirmBody', { amount: bidAda, label }),
      description: encryption.description,
      confirmLabel: t('toast.acceptBidConfirmLabel'),
      onConfirm: async () => {
        const id = queue.enqueue(encryption, bid, true)
        if (id) {
          toast.info(t('toast.bidQueuedTitle'), t('toast.bidQueuedBody', { label }))
        } else {
          toast.warning(t('toast.alreadyQueuedTitle'), t('toast.alreadyQueuedBody', { label }))
        }
      },
    })
  }, [toast, t, wasmReady, wasmLoading, navigate, wallet, setConfirmAction, queue])

  const handleCancelPending = useCallback((encryption: EncryptionDisplay) => {
    if (!wallet) {
      toast.error(t('toast.errorTitle'), t('toast.walletNotConnected'))
      return
    }

    const label = encryption.description || encryption.tokenName.slice(0, 16) + '...'
    setConfirmAction({
      title: t('toast.cancelPendingConfirmTitle'),
      message: t('toast.cancelPendingConfirmBody', { label }),
      confirmLabel: t('toast.cancelPendingConfirmLabel'),
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
            playSound('tx_failed')
            throw new Error(result.error || 'Failed to cancel pending listing')
          }

          if (result.isStub) {
            toast.warning(
              t('toast.pendingCancelledStubTitle'),
              t('toast.pendingCancelledStubBody'),
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
            toast.transactionSuccess(t('toast.pendingCancelledTitle'), result.txHash, { type: 'cancel-pending' }, { label: t('toast.actionViewHistory'), onClick: () => setActiveTab('history') })
          }

          triggerTransactionRefresh()
        } catch (error) {
          console.error('Failed to cancel pending listing:', error)
          toast.error(
            t('toast.failedToCancelPendingTitle'),
            error instanceof Error ? error.message : t('toast.unknownErrorOccurred'),
            0,
            { label: t('toast.actionRetry'), onClick: () => handleCancelPending(encryption) }
          )
        }
      },
    })
  }, [wallet, toast, t, recordTransaction, setActiveTab, triggerTransactionRefresh, setConfirmAction])

  const handleCompleteSale = useCallback(async (encryption: EncryptionDisplay) => {
    if (!wallet) {
      toast.error(t('toast.errorTitle'), t('toast.walletNotConnected'))
      return
    }

    try {
      // Check if accept-bid secrets exist (indicates 12e was done from this browser)
      const secrets = await getAcceptBidSecrets(encryption.tokenName)
      if (!secrets) {
        toast.error(
          t('toast.cannotCompleteSaleTitle'),
          t('toast.cannotCompleteSaleBody')
        )
        return
      }

      // Find the bid that was accepted (using stored bid token name)
      const allBids = await bidsApi.getAll()
      const acceptedBid = allBids.find(b => b.tokenName === secrets.bidTokenName)
      if (!acceptedBid) {
        toast.error(
          t('toast.bidNotFoundTitle'),
          t('toast.bidNotFoundBody')
        )
        return
      }

      console.log('[handleCompleteSale] acceptedBid:', JSON.stringify({ tokenName: acceptedBid.tokenName, futurePrice: acceptedBid.futurePrice, amount: acceptedBid.amount }))

      toast.info(t('toast.submittingTitle'), t('toast.submittingReEncryption'))
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
        playSound('tx_failed')
        throw new Error(result.error || 'Failed to complete re-encryption')
      }

      if (result.isStub) {
        toast.warning(
          t('toast.saleCompletedStubTitle'),
          t('toast.saleCompletedStubBody'),
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
        toast.transactionSuccess(t('toast.saleCompletedTitle'), result.txHash, { type: 'complete-sale', amountLovelace: acceptedBid.amount }, { label: t('toast.actionViewHistory'), onClick: () => setActiveTab('history') })
      }

      triggerTransactionRefresh()
    } catch (error) {
      console.error('Failed to complete sale:', error)
      toast.error(
        t('toast.failedToCompleteSaleTitle'),
        error instanceof Error ? error.message : t('toast.unknownErrorOccurred'),
        0,
        { label: t('toast.actionRetry'), onClick: () => handleCompleteSale(encryption) }
      )
    }
  }, [wallet, toast, t, recordTransaction, setActiveTab, triggerTransactionRefresh])

  // ── Update Price ──────────────────────────────────────────────────

  const handleOpenUpdatePrice = useCallback((encryption: EncryptionDisplay) => {
    if (!wallet) {
      toast.error(t('toast.errorTitle'), t('toast.walletNotConnected'))
      return
    }
    setUpdatePriceEncryption(encryption)
    setShowUpdatePriceModal(true)
  }, [wallet, toast, t])

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
      playSound('tx_failed')
      throw new Error(result.error || 'Failed to update price')
    }

    if (result.isStub) {
      toast.warning(t('toast.priceUpdatedStubTitle'), t('toast.priceUpdatedStubBody'), 8000)
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
      toast.transactionSuccess(t('toast.priceUpdatedTitle'), result.txHash, { type: 'update-price' }, { label: t('toast.actionViewHistory'), onClick: () => setActiveTab('history') })
    }

    triggerTransactionRefresh()
    setShowUpdatePriceModal(false)
    setUpdatePriceEncryption(null)
  }, [wallet, toast, t, recordTransaction, triggerTransactionRefresh, setActiveTab])

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
