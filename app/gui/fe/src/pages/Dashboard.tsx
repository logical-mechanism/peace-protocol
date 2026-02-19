import { useWalletContext, useAddress, useLovelace } from '../contexts/WalletContext'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWasm } from '../contexts/WasmContext'
import { useNode } from '../contexts/NodeContext'
import { copyToClipboard } from '../utils/clipboard'
import MarketplaceTab from '../components/MarketplaceTab'
import MySalesTab from '../components/MySalesTab'
import MyPurchasesTab from '../components/MyPurchasesTab'
import HistoryTab from '../components/HistoryTab'
import ScrollToTop from '../components/ScrollToTop'
import CreateListingModal from '../components/CreateListingModal'
import PlaceBidModal from '../components/PlaceBidModal'
import DecryptModal from '../components/DecryptModal'
import SnarkProvingModal from '../components/SnarkProvingModal'
import ConfirmModal from '../components/ConfirmModal'
import { useToast, ToastContainer } from '../components/Toast'
import { encryptionsApi, bidsApi } from '../services/api'
import { cleanupStaleSecrets } from '../services/secretCleanup'
import {
  createListing, removeListing, placeBid, cancelBid,
  cancelPendingListing, acceptBidSnark, prepareSnarkInputs, completeReEncryption,
  getTransactionStubWarning, extractPaymentKeyHash
} from '../services/transactionBuilder'
import { getAcceptBidSecrets } from '../services/acceptBidStorage'
import { getTransactions, addTransaction } from '../services/transactionHistory'
import type { TransactionRecord } from '../services/transactionHistory'
import type { EncryptionDisplay, BidDisplay } from '../services/api'
import type { SnarkProofInputs, SnarkProof } from '../services/snark'
import type { CreateListingFormData } from '../components/CreateListingModal'

type TabId = 'marketplace' | 'my-sales' | 'my-purchases' | 'history';

interface Tab {
  id: TabId;
  label: string;
}

const TABS: Tab[] = [
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'my-sales', label: 'My Sales' },
  { id: 'my-purchases', label: 'My Purchases' },
  { id: 'history', label: 'History' },
];

export default function Dashboard() {
  const { disconnect, wallet, refreshBalance } = useWalletContext()
  const address = useAddress()
  const lovelace = useLovelace()
  const { isReady: wasmReady, isLoading: wasmLoading, progress: wasmProgress } = useWasm()
  const { stage: nodeStage, syncProgress: nodeSyncProgress, kupoSyncProgress } = useNode()
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('marketplace')
  const [myListingsCount, setMyListingsCount] = useState<number | null>(null)
  const [myBidsCount, setMyBidsCount] = useState<number | null>(null)
  const [showCreateListing, setShowCreateListing] = useState(false)
  const [showPlaceBid, setShowPlaceBid] = useState(false)
  const [showDecrypt, setShowDecrypt] = useState(false)
  const [selectedEncryption, setSelectedEncryption] = useState<EncryptionDisplay | null>(null)
  const [selectedBid, setSelectedBid] = useState<BidDisplay | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [txHistory, setTxHistory] = useState<TransactionRecord[]>([])
  const [historyKey, setHistoryKey] = useState(0)
  // Accept bid flow state
  const [showSnarkModal, setShowSnarkModal] = useState(false)
  const [snarkInputs, setSnarkInputs] = useState<SnarkProofInputs | null>(null)
  const [acceptBidEncryption, setAcceptBidEncryption] = useState<EncryptionDisplay | null>(null)
  const [acceptBidBid, setAcceptBidBid] = useState<BidDisplay | null>(null)
  const [acceptBidA0, setAcceptBidA0] = useState<bigint | null>(null)
  const [acceptBidR0, setAcceptBidR0] = useState<bigint | null>(null)
  const [acceptBidHk, setAcceptBidHk] = useState<bigint | null>(null)
  const toast = useToast()

  // Confirmation modal state for destructive actions
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    message: string
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

  // Load transaction history when PKH changes
  useEffect(() => {
    if (userPkh) {
      setTxHistory(getTransactions(userPkh))
    } else {
      setTxHistory([])
    }
  }, [userPkh, historyKey])

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

  // Record a transaction and schedule auto-refresh with escalating retries.
  // Txs can sit in the mempool for over a minute, so a single 20s check isn't enough.
  const recordTransaction = useCallback((record: TransactionRecord) => {
    if (!userPkh) return
    addTransaction(userPkh, record)
    setTxHistory(getTransactions(userPkh))
    // Retry at 20s, 45s, 90s, and 180s to handle mempool delays
    for (const delay of [20_000, 45_000, 90_000, 180_000]) {
      setTimeout(() => {
        setRefreshKey(prev => prev + 1)
        setHistoryKey(prev => prev + 1)
      }, delay)
    }
  }, [userPkh])

  const pendingTxCount = useMemo(
    () => txHistory.filter(tx => tx.status === 'pending').length,
    [txHistory]
  )

  const truncateAddress = (addr: string) => {
    if (!addr) return ''
    return `${addr.slice(0, 12)}...${addr.slice(-8)}`
  }

  const formatAda = (lovelaceAmount: string | undefined) => {
    if (!lovelaceAmount) return '...'
    const ada = parseInt(lovelaceAmount) / 1_000_000
    return ada.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const handleCopy = useCallback(async () => {
    if (!address) return
    const success = await copyToClipboard(address)
    if (success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [address])

  const handleDisconnect = useCallback(() => {
    disconnect()
  }, [disconnect])

  const handlePlaceBid = useCallback((encryption: EncryptionDisplay) => {
    setSelectedEncryption(encryption)
    setShowPlaceBid(true)
  }, [])

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
      toast.transactionSuccess('Bid Placed!', result.txHash)
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
      })
    }

    // Refresh and switch to History tab to show pending tx
    setRefreshKey(prev => prev + 1)
    setActiveTab('history')
  }, [wallet, toast, recordTransaction])

  const handleRemoveListing = useCallback((encryption: EncryptionDisplay) => {
    if (!wallet) {
      toast.error('Error', 'Wallet not connected')
      return
    }

    const label = encryption.description || encryption.tokenName.slice(0, 16) + '...'
    setConfirmAction({
      title: 'Remove Listing?',
      message: `This will permanently remove "${label}" from the marketplace and burn the encryption token. This action submits an on-chain transaction and cannot be undone.`,
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
            toast.transactionSuccess('Listing Removed!', result.txHash)
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

          setRefreshKey(prev => prev + 1)
          setActiveTab('history')
        } catch (error) {
          console.error('Failed to remove listing:', error)
          toast.error(
            'Failed to Remove Listing',
            error instanceof Error ? error.message : 'Unknown error occurred'
          )
        }
      },
    })
  }, [wallet, toast, recordTransaction])

  const handleAcceptBid = useCallback(async (encryption: EncryptionDisplay, bid: BidDisplay) => {
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
        error instanceof Error ? error.message : 'Unknown error occurred'
      )
    }
  }, [toast, wasmReady, wasmLoading, navigate, wallet])

  // Called when the SNARK proof is generated (from SnarkProvingModal)
  const handleProofGenerated = useCallback(async (proof: SnarkProof) => {
    if (!wallet || !acceptBidEncryption || !acceptBidBid) {
      toast.error('Error', 'Missing accept-bid state')
      return
    }

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
        toast.transactionSuccess('SNARK Proof Submitted!', result.txHash)
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
        })
      }

      // Refresh and switch to history
      setRefreshKey(prev => prev + 1)
      setActiveTab('history')

      toast.info(
        'Next Step',
        'Once the SNARK transaction confirms on-chain, return to My Sales to complete the re-encryption step.',
        10000
      )
    } catch (error) {
      console.error('Failed to submit SNARK transaction:', error)
      toast.error(
        'Failed to Accept Bid',
        error instanceof Error ? error.message : 'Unknown error occurred'
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
  }, [wallet, acceptBidEncryption, acceptBidBid, acceptBidA0, acceptBidR0, acceptBidHk, toast, recordTransaction])

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
            toast.transactionSuccess('Pending Listing Cancelled!', result.txHash)
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

          setRefreshKey(prev => prev + 1)
          setActiveTab('history')
        } catch (error) {
          console.error('Failed to cancel pending listing:', error)
          toast.error(
            'Failed to Cancel Pending',
            error instanceof Error ? error.message : 'Unknown error occurred'
          )
        }
      },
    })
  }, [wallet, toast, recordTransaction])

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
        toast.transactionSuccess('Sale Completed!', result.txHash)
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
        })
      }

      setRefreshKey(prev => prev + 1)
      setActiveTab('history')
    } catch (error) {
      console.error('Failed to complete sale:', error)
      toast.error(
        'Failed to Complete Sale',
        error instanceof Error ? error.message : 'Unknown error occurred'
      )
    }
  }, [wallet, toast, recordTransaction])

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
            toast.transactionSuccess('Bid Cancelled!', result.txHash)
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
            })
          }

          setRefreshKey(prev => prev + 1)
          setActiveTab('history')
        } catch (error) {
          console.error('Failed to cancel bid:', error)
          toast.error(
            'Failed to Cancel Bid',
            error instanceof Error ? error.message : 'Unknown error occurred'
          )
        }
      },
    })
  }, [wallet, toast, recordTransaction])

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

  const handleCreateListing = useCallback(async (formData: CreateListingFormData) => {
    if (!wallet) {
      throw new Error('Wallet not connected')
    }

    // Show stub warning if applicable
    const stubWarning = getTransactionStubWarning()
    if (stubWarning) {
      console.warn(stubWarning)
    }

    const result = await createListing(wallet, formData)

    if (!result.success) {
      throw new Error(result.error || 'Failed to create listing')
    }

    // Show success message
    if (result.isStub) {
      toast.warning(
        'Listing Created (Stub Mode)',
        `Listing created in stub mode. No real transaction submitted. Token: ${result.tokenName?.slice(0, 12)}...`,
        8000
      )
    } else if (result.txHash) {
      toast.transactionSuccess('Listing Created!', result.txHash)
    } else {
      toast.success('Listing Created!', 'Transaction submitted successfully')
    }

    // Record in history
    if (result.txHash) {
      recordTransaction({
        txHash: result.txHash,
        type: 'create-listing',
        tokenName: result.tokenName,
        timestamp: Date.now(),
        status: result.isStub ? 'confirmed' : 'pending',
        description: formData.description,
      })
    }

    // Refresh and switch to History tab to show pending tx
    setRefreshKey(prev => prev + 1)
    setActiveTab('history')
  }, [wallet, toast, recordTransaction])

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

        // Best-effort cleanup of stale secrets after confirmed ownership changes
        cleanupStaleSecrets(userPkh, encryptions).catch(() => {})
      } catch (error) {
        console.error('Failed to fetch stats:', error)
        setMyListingsCount(0)
        setMyBidsCount(0)
      }
    }

    fetchStats()
  }, [userPkh, refreshKey])

  const renderTabContent = () => {
    switch (activeTab) {
      case 'marketplace':
        return (
          <MarketplaceTab
            key={refreshKey}
            userPkh={userPkh}
            onPlaceBid={handlePlaceBid}
          />
        )
      case 'my-sales':
        return (
          <MySalesTab
            key={refreshKey}
            userPkh={userPkh}
            onRemoveListing={handleRemoveListing}
            onAcceptBid={handleAcceptBid}
            onCancelPending={handleCancelPending}
            onCompleteSale={handleCompleteSale}
            onCreateListing={() => setShowCreateListing(true)}
          />
        )
      case 'my-purchases':
        return (
          <MyPurchasesTab
            key={refreshKey}
            userPkh={userPkh}
            onCancelBid={handleCancelBid}
            onDecrypt={handleDecrypt}
            onDecryptEncryption={handleDecryptEncryption}
          />
        )
      case 'history':
        return (
          <HistoryTab
            key={historyKey}
            userPkh={userPkh}
            transactions={txHistory}
            onClearHistory={() => setHistoryKey(prev => prev + 1)}
            onHistoryUpdated={setTxHistory}
          />
        )
      default:
        return null
    }
  }

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
              Node Synced
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
        </div>
        <div className="flex items-center gap-4">
          {/* Create Listing Button */}
          <button
            onClick={() => setShowCreateListing(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent)]/90 transition-all duration-150 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Listing
          </button>

          {/* ADA Balance */}
          <div className="px-3 py-1.5 text-sm font-medium text-[var(--accent)] bg-[var(--accent-muted)] rounded-[var(--radius-md)]">
            {formatAda(lovelace)} ADA
          </div>

          {/* Address with copy button */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] font-mono bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition-all duration-150 cursor-pointer"
            title={address || 'Loading...'}
          >
            <span>{address ? truncateAddress(address) : '...'}</span>
            <svg
              className="w-4 h-4"
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
            className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] rounded-[var(--radius-md)] transition-all duration-150 cursor-pointer"
            title="Settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {/* Disconnect button */}
          <button
            onClick={handleDisconnect}
            className="px-4 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition-all duration-150 cursor-pointer"
          >
            Disconnect
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 gap-6 mb-8">
          <button
            onClick={() => setActiveTab('my-sales')}
            className={`bg-[var(--bg-card)] border rounded-[var(--radius-lg)] p-6 text-left transition-all duration-150 cursor-pointer ${
              activeTab === 'my-sales'
                ? 'border-[var(--accent)] shadow-[var(--shadow-glow)]'
                : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)]'
            }`}
          >
            <h2 className="text-lg font-medium mb-2">My Listings</h2>
            <p className="text-2xl font-semibold text-[var(--accent)]">
              {myListingsCount === null ? '...' : `${myListingsCount} active`}
            </p>
          </button>
          <button
            onClick={() => setActiveTab('my-purchases')}
            className={`bg-[var(--bg-card)] border rounded-[var(--radius-lg)] p-6 text-left transition-all duration-150 cursor-pointer ${
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
        </div>

        {/* Tabs */}
        <div className="border-b border-[var(--border-subtle)] mb-6">
          <div className="flex gap-6">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`pb-3 transition-all duration-150 cursor-pointer flex items-center gap-2 ${
                  activeTab === tab.id
                    ? 'text-[var(--text-primary)] border-b-2 border-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {tab.label}
                {tab.id === 'history' && pendingTxCount > 0 && (
                  <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-medium bg-[var(--warning)] text-white rounded-full">
                    {pendingTxCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        {renderTabContent()}
      </main>

      {/* Scroll to Top Button */}
      <ScrollToTop />

      {/* Create Listing Modal */}
      <CreateListingModal
        isOpen={showCreateListing}
        onClose={() => setShowCreateListing(false)}
        onSubmit={handleCreateListing}
      />

      {/* Place Bid Modal */}
      <PlaceBidModal
        isOpen={showPlaceBid}
        onClose={() => {
          setShowPlaceBid(false)
          setSelectedEncryption(null)
        }}
        onSubmit={handlePlaceBidSubmit}
        encryption={selectedEncryption}
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
        confirmLabel={confirmAction?.confirmLabel ?? 'Confirm'}
        confirmVariant="danger"
        loading={confirmLoading}
      />

      {/* SNARK Proving Modal (Accept Bid Step 1) */}
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

      {/* Toast Notifications */}
      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} />
    </div>
  )
}
