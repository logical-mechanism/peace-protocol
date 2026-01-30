import { useWallet, useAddress, useLovelace } from '@meshsdk/react'
import { useState, useCallback } from 'react'
import { useWalletPersistence } from '../hooks/useWalletPersistence'
import { copyToClipboard } from '../utils/clipboard'

export default function Dashboard() {
  const { disconnect } = useWallet()
  const address = useAddress()
  const lovelace = useLovelace()
  const { clearWalletSession } = useWalletPersistence()
  const [copied, setCopied] = useState(false)

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

  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <nav className="h-16 border-b border-[var(--border-subtle)] px-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Peace Protocol</h1>
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
        <div className="grid grid-cols-2 gap-6 mb-8">
          <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
            <h2 className="text-lg font-medium mb-2">My Listings</h2>
            <p className="text-2xl font-semibold text-[var(--accent)]">0 active</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
            <h2 className="text-lg font-medium mb-2">My Bids</h2>
            <p className="text-2xl font-semibold text-[var(--accent)]">0 pending</p>
          </div>
        </div>

        {/* Tabs placeholder */}
        <div className="border-b border-[var(--border-subtle)] mb-6">
          <div className="flex gap-6">
            <button className="pb-3 text-[var(--text-primary)] border-b-2 border-[var(--accent)] cursor-pointer">
              Marketplace
            </button>
            <button className="pb-3 text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer">
              My Sales
            </button>
            <button className="pb-3 text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer">
              My Purchases
            </button>
          </div>
        </div>

        {/* Empty state */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-12 text-center">
          <p className="text-[var(--text-muted)]">No listings available</p>
          <p className="text-sm text-[var(--text-muted)] mt-2">
            Listings will appear here once the contracts are deployed to preprod.
          </p>
        </div>
      </main>
    </div>
  )
}
