import { useWallet } from '@meshsdk/react'
import { useState } from 'react'

interface WalletInfo {
  name: string
  icon: string
}

// Feature card data
const features = [
  {
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
    title: 'Encrypted Data',
    description: 'Your data is encrypted with BLS12-381 cryptography and stored on-chain.'
  },
  {
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
    title: 'Zero-Knowledge Proofs',
    description: 'Groth16 SNARKs verify ownership transfers without revealing secrets.'
  },
  {
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
    title: 'Trustless Trading',
    description: 'Smart contracts ensure fair exchange. No intermediaries needed.'
  }
]

export default function Landing() {
  const { connect, connecting } = useWallet()
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
    <div className="min-h-screen flex flex-col">
      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-6 md:p-8">
        <div className="max-w-3xl w-full">
          {/* Hero Section */}
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-semibold text-[var(--text-primary)] mb-3">
              Veiled
            </h1>
            <p className="text-lg md:text-xl text-[var(--text-secondary)] mb-2">
              An Encrypted Data Marketplace
            </p>
            <p className="text-sm text-[var(--text-muted)]">
              Powered By The PEACE Protocol
            </p>
          </div>

          {/* Wallet Connect Card */}
          <div className="max-w-md mx-auto mb-16">
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
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
                <div className="text-center space-y-3">
                  <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--error-muted)] flex items-center justify-center">
                    <svg className="w-6 h-6 text-[var(--error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <p className="text-[var(--text-primary)] font-medium">No wallets detected</p>
                  <p className="text-sm text-[var(--text-muted)]">
                    Install a Cardano wallet extension to continue.
                  </p>
                  <a
                    href="https://eternl.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-2 text-sm text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
                  >
                    Get Eternl Wallet →
                  </a>
                  <div className="pt-2">
                    <button
                      onClick={() => setShowWallets(false)}
                      className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-all duration-150 cursor-pointer"
                    >
                      Try again
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Feature Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            {features.map((feature, index) => (
              <div
                key={index}
                className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6 hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all duration-200 text-center"
              >
                <div className="text-[var(--accent)] mb-4 flex justify-center">
                  {feature.icon}
                </div>
                <h3 className="text-base font-medium text-[var(--text-primary)] mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Network indicator */}
      <footer className="p-4 text-center">
        <span className="inline-flex items-center gap-2 px-3 py-1 text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-full">
          <span className="w-2 h-2 rounded-full bg-[var(--warning)]"></span>
          Preprod Network
        </span>
      </footer>
    </div>
  )
}
