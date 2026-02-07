import { useWallet, useAddress, useLovelace } from '@meshsdk/react'
import { useState, useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWalletPersistence } from '../hooks/useWalletPersistence'
import { useWasm } from '../contexts/WasmContext'
import { copyToClipboard } from '../utils/clipboard'
import MarketplaceTab from '../components/MarketplaceTab'
import MySalesTab from '../components/MySalesTab'
import MyPurchasesTab from '../components/MyPurchasesTab'
import HistoryTab from '../components/HistoryTab'
import ScrollToTop from '../components/ScrollToTop'
import CreateListingModal from '../components/CreateListingModal'
import PlaceBidModal from '../components/PlaceBidModal'
import DecryptModal from '../components/DecryptModal'
import { useToast } from '../components/Toast'
import { encryptionsApi, bidsApi } from '../services/api'
import { createListing, removeListing, placeBid, cancelBid, getTransactionStubWarning, extractPaymentKeyHash } from '../services/transactionBuilder'
import { getTransactions, addTransaction, getPendingCount } from '../services/transactionHistory'
import type { TransactionRecord } from '../services/transactionHistory'
import type { EncryptionDisplay, BidDisplay } from '../services/api'
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
  const { disconnect, wallet } = useWallet()
  const address = useAddress()
  const lovelace = useLovelace()
  const { clearWalletSession } = useWalletPersistence()
  const { isReady: wasmReady, isLoading: wasmLoading, progress: wasmProgress } = useWasm()
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
  const toast = useToast()

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

  // Record a transaction and schedule auto-refresh after 20s
  const recordTransaction = useCallback((record: TransactionRecord) => {
    if (!userPkh) return
    addTransaction(userPkh, record)
    setTxHistory(getTransactions(userPkh))
    // Auto-refresh data after ~20s to pick up confirmed tx
    setTimeout(() => {
      setRefreshKey(prev => prev + 1)
      setHistoryKey(prev => prev + 1)
    }, 20000)
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
    clearWalletSession()
    disconnect()
  }, [clearWalletSession, disconnect])

  const handlePlaceBid = useCallback((encryption: EncryptionDisplay) => {
    setSelectedEncryption(encryption)
    setShowPlaceBid(true)
  }, [])

  const handlePlaceBidSubmit = useCallback(async (encryptionTokenName: string, bidAmountAda: number) => {
    if (!wallet) {
      throw new Error('Wallet not connected')
    }

    // Show stub warning if applicable
    const stubWarning = getTransactionStubWarning()
    if (stubWarning) {
      console.warn(stubWarning)
    }

    const result = await placeBid(wallet, encryptionTokenName, bidAmountAda)

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

  const handleRemoveListing = useCallback(async (encryption: EncryptionDisplay) => {
    if (!wallet) {
      toast.error('Error', 'Wallet not connected')
      return
    }

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

      // Record in history
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

      // Refresh and switch to History tab to show pending tx
      setRefreshKey(prev => prev + 1)
      setActiveTab('history')
    } catch (error) {
      console.error('Failed to remove listing:', error)
      toast.error(
        'Failed to Remove Listing',
        error instanceof Error ? error.message : 'Unknown error occurred'
      )
    }
  }, [wallet, toast, recordTransaction])

  const handleAcceptBid = useCallback((encryption: EncryptionDisplay, bid: BidDisplay) => {
    // Check if WASM prover is ready
    if (!wasmReady) {
      toast.warning(
        'Prover Not Ready',
        'Accepting bids requires the zero-knowledge prover. Click the loading indicator in the header to start loading (~99 minutes).',
        8000
      )
      // Optionally navigate to loading screen
      if (!wasmLoading) {
        navigate('/loading')
      }
      return
    }

    // TODO: Phase 12 - Implement SNARK proof + re-encryption flow
    console.log('Accept bid:', bid.tokenName, 'for:', encryption.tokenName)
    toast.info(
      'Coming Soon',
      `Accept bid will be implemented in Phase 12 with SNARK proving. Bid: ${(bid.amount / 1_000_000).toLocaleString()} ADA`
    )
  }, [toast, wasmReady, wasmLoading, navigate])

  const handleCancelPending = useCallback((encryption: EncryptionDisplay) => {
    // TODO: Phase 9 - Implement cancel pending transaction
    console.log('Cancel pending:', encryption.tokenName)
    toast.warning(
      'Not Yet Available',
      'Cancel pending requires contract deployment to preprod.'
    )
  }, [toast])

  const handleCancelBid = useCallback(async (bid: BidDisplay) => {
    if (!wallet) {
      toast.error('Error', 'Wallet not connected')
      return
    }

    // Show stub warning if applicable
    const stubWarning = getTransactionStubWarning()
    if (stubWarning) {
      console.warn(stubWarning)
    }

    try {
      const result = await cancelBid(wallet, bid.tokenName)

      if (!result.success) {
        throw new Error(result.error || 'Failed to cancel bid')
      }

      // Show success message
      if (result.isStub) {
        toast.warning(
          'Bid Cancelled (Stub Mode)',
          `Bid cancelled in stub mode. No real transaction submitted. Amount: ${(bid.amount / 1_000_000).toLocaleString()} ADA`,
          8000
        )
      } else if (result.txHash) {
        toast.transactionSuccess('Bid Cancelled!', result.txHash)
      } else {
        toast.success('Bid Cancelled!', 'Transaction submitted successfully')
      }

      // Record in history
      if (result.txHash) {
        recordTransaction({
          txHash: result.txHash,
          type: 'cancel-bid',
          tokenName: bid.tokenName,
          timestamp: Date.now(),
          status: result.isStub ? 'confirmed' : 'pending',
          description: `Cancel bid of ${(bid.amount / 1_000_000).toLocaleString()} ADA`,
        })
      }

      // Refresh and switch to History tab to show pending tx
      setRefreshKey(prev => prev + 1)
      setActiveTab('history')
    } catch (error) {
      console.error('Failed to cancel bid:', error)
      toast.error(
        'Failed to Cancel Bid',
        error instanceof Error ? error.message : 'Unknown error occurred'
      )
    }
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
          {/* WASM Loading Indicator */}
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
              <svg
                className="w-3 h-3 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Prover {Math.round(wasmProgress)}%
            </button>
          ) : (
            <button
              onClick={() => navigate('/loading')}
              className="inline-flex items-center gap-2 px-2 py-1 text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-full hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all cursor-pointer"
              title="Load prover for listings, decryption & accepting bids"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Load Prover
            </button>
          )}
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

      {/* Toast Notifications */}
      <toast.ToastContainer />
    </div>
  )
}
