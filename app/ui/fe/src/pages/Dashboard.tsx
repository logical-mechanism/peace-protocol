import { useWallet, useAddress } from '@meshsdk/react'

export default function Dashboard() {
  const { disconnect } = useWallet()
  const address = useAddress()

  const truncateAddress = (addr: string) => {
    if (!addr) return ''
    return `${addr.slice(0, 12)}...${addr.slice(-8)}`
  }

  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <nav className="h-16 border-b border-[var(--border-subtle)] px-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Peace Protocol</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-[var(--text-secondary)] font-mono">
            {address ? truncateAddress(address) : '...'}
          </span>
          <button
            onClick={disconnect}
            className="px-4 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition-all duration-150"
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
            <button className="pb-3 text-[var(--text-primary)] border-b-2 border-[var(--accent)]">
              Marketplace
            </button>
            <button className="pb-3 text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
              My Sales
            </button>
            <button className="pb-3 text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
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
