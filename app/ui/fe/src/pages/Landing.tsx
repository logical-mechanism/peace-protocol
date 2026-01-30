import { CardanoWallet } from '@meshsdk/react'

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-md w-full text-center space-y-8">
        <div className="space-y-4">
          <h1 className="text-4xl font-semibold text-[var(--text-primary)]">
            Peace Protocol
          </h1>
          <p className="text-lg text-[var(--text-secondary)]">
            Encrypted Data Marketplace
          </p>
        </div>

        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6 space-y-4">
          <CardanoWallet />
          <p className="text-sm text-[var(--text-muted)]">
            Recommended: Eternl on Chrome
          </p>
        </div>

        <p className="text-sm text-[var(--text-secondary)] max-w-sm mx-auto">
          Buy and sell encrypted data securely using Cardano smart contracts
          and zero-knowledge proofs.
        </p>
      </div>
    </div>
  )
}
