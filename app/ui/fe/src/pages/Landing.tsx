import { useWallet } from '@meshsdk/react'
import { useState } from 'react'

interface WalletInfo {
  name: string
  icon: string
}

export default function Landing() {
  const { connect, connecting, error } = useWallet()
  const [wallets, setWallets] = useState<WalletInfo[]>([])
  const [showWallets, setShowWallets] = useState(false)

  const detectWallets = async () => {
    const cardano = (window as Window & { cardano?: Record<string, { name?: string; icon?: string }> }).cardano
    if (cardano) {
      const detected: WalletInfo[] = []
      for (const key of Object.keys(cardano)) {
        const wallet = cardano[key]
        if (typeof wallet === 'object' && wallet !== null && 'icon' in wallet) {
          detected.push({
            name: key,
            icon: wallet.icon || ''
          })
        }
      }
      setWallets(detected)
      setShowWallets(true)
    } else {
      setWallets([])
      setShowWallets(true)
    }
  }

  const handleConnect = async (walletName: string) => {
    try {
      await connect(walletName)
    } catch (err) {
      console.error('Failed to connect wallet:', err)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-md w-full text-center space-y-8">
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold text-[var(--text-primary)]">
            Encrypted Data Marketplace
          </h1>
        </div>

        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6 space-y-4">
          {!showWallets ? (
            <button
              onClick={detectWallets}
              disabled={connecting}
              className="w-full px-4 py-3 bg-[var(--accent)] text-white font-medium rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-all duration-150 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              {connecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
          ) : wallets.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-[var(--text-secondary)] mb-3">Select a wallet:</p>
              {wallets.map((wallet) => (
                <button
                  key={wallet.name}
                  onClick={() => handleConnect(wallet.name)}
                  disabled={connecting}
                  className="w-full px-4 py-3 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-medium rounded-[var(--radius-md)] hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all duration-150 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-3"
                >
                  {wallet.icon && (
                    <img
                      src={wallet.icon}
                      alt={`${wallet.name} icon`}
                      className="w-6 h-6 rounded"
                    />
                  )}
                  <span className="capitalize">{wallet.name}</span>
                </button>
              ))}
              <button
                onClick={() => setShowWallets(false)}
                className="w-full px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-all duration-150 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[var(--text-secondary)]">No wallets detected</p>
              <p className="text-sm text-[var(--text-muted)]">
                Please install a Cardano wallet extension like Eternl
              </p>
              <button
                onClick={() => setShowWallets(false)}
                className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-all duration-150 cursor-pointer"
              >
                Try again
              </button>
            </div>
          )}

        </div>

        <p className="text-sm text-[var(--text-secondary)] max-w-sm mx-auto">
          Buy and sell encrypted data securely using Cardano smart contracts
          and zero-knowledge proofs.
        </p>
      </div>
    </div>
  )
}
