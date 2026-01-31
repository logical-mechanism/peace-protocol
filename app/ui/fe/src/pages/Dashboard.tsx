import { useWallet, useAddress, useLovelace } from '@meshsdk/react'
import { useState, useCallback, useEffect } from 'react'
import { useWalletPersistence } from '../hooks/useWalletPersistence'
import { copyToClipboard } from '../utils/clipboard'
import MarketplaceTab from '../components/MarketplaceTab'
import MySalesTab from '../components/MySalesTab'
import EmptyState, { InboxIcon } from '../components/EmptyState'
import ScrollToTop from '../components/ScrollToTop'
import { encryptionsApi, bidsApi } from '../services/api'
import type { EncryptionDisplay, BidDisplay } from '../services/api'

type TabId = 'marketplace' | 'my-sales' | 'my-purchases';

interface Tab {
  id: TabId;
  label: string;
}

const TABS: Tab[] = [
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'my-sales', label: 'My Sales' },
  { id: 'my-purchases', label: 'My Purchases' },
];

export default function Dashboard() {
  const { disconnect } = useWallet()
  const address = useAddress()
  const lovelace = useLovelace()
  const { clearWalletSession } = useWalletPersistence()
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('marketplace')
  const [myListingsCount, setMyListingsCount] = useState<number | null>(null)
  const [myBidsCount, setMyBidsCount] = useState<number | null>(null)

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
    // TODO: Phase 10 - Implement bid placement modal
    console.log('Place bid on:', encryption.tokenName)
    alert(`Bid placement coming in Phase 10!\n\nEncryption: ${encryption.tokenName.slice(0, 16)}...`)
  }, [])

  const handleRemoveListing = useCallback((encryption: EncryptionDisplay) => {
    // TODO: Phase 9 - Implement remove listing transaction
    console.log('Remove listing:', encryption.tokenName)
    alert(`Remove listing coming in Phase 9!\n\nThis requires a transaction to remove the encryption from the contract.\n\nToken: ${encryption.tokenName.slice(0, 16)}...`)
  }, [])

  const handleAcceptBid = useCallback((encryption: EncryptionDisplay, bid: BidDisplay) => {
    // TODO: Phase 12 - Implement SNARK proof + re-encryption flow
    console.log('Accept bid:', bid.tokenName, 'for:', encryption.tokenName)
    alert(`Accept bid coming in Phase 12!\n\nThis will trigger SNARK proof generation followed by re-encryption transaction.\n\nBid: ${(bid.amount / 1_000_000).toLocaleString()} ADA\nBidder: ${bid.bidder.slice(0, 16)}...`)
  }, [])

  const handleCancelPending = useCallback((encryption: EncryptionDisplay) => {
    // TODO: Phase 9 - Implement cancel pending transaction
    console.log('Cancel pending:', encryption.tokenName)
    alert(`Cancel pending coming in Phase 9!\n\nThis will cancel the pending sale and return the encryption to active status.\n\nToken: ${encryption.tokenName.slice(0, 16)}...`)
  }, [])

  // Fetch user stats
  useEffect(() => {
    if (!address) return

    // For now, we'll just show stub data counts filtered by the connected address
    // In production, this would use a proper PKH-based query
    const fetchStats = async () => {
      try {
        const encryptions = await encryptionsApi.getAll()
        const bids = await bidsApi.getAll()

        // Count listings that match the connected address
        const userListings = encryptions.filter(
          e => e.seller.toLowerCase() === address.toLowerCase() && e.status === 'active'
        )
        setMyListingsCount(userListings.length)

        // Count pending bids (in real usage, would filter by user PKH)
        const userBids = bids.filter(b => b.status === 'pending')
        setMyBidsCount(userBids.length)
      } catch (error) {
        console.error('Failed to fetch stats:', error)
        setMyListingsCount(0)
        setMyBidsCount(0)
      }
    }

    fetchStats()
  }, [address])

  const renderTabContent = () => {
    switch (activeTab) {
      case 'marketplace':
        return (
          <MarketplaceTab
            userAddress={address}
            onPlaceBid={handlePlaceBid}
          />
        )
      case 'my-sales':
        return (
          <MySalesTab
            userAddress={address}
            onRemoveListing={handleRemoveListing}
            onAcceptBid={handleAcceptBid}
            onCancelPending={handleCancelPending}
          />
        )
      case 'my-purchases':
        return (
          <EmptyState
            icon={<InboxIcon />}
            title="My Purchases - Coming Soon"
            description="View your bids and purchased encryptions here. This feature will be available in Phase 8."
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
        </div>
        <div className="flex items-center gap-4">
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
                className={`pb-3 transition-all duration-150 cursor-pointer ${
                  activeTab === tab.id
                    ? 'text-[var(--text-primary)] border-b-2 border-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        {renderTabContent()}
      </main>

      {/* Scroll to Top Button */}
      <ScrollToTop />
    </div>
  )
}
