import { useWallet } from '@meshsdk/react'
import { useEffect, useCallback } from 'react'

const WALLET_KEY = 'peace_protocol_wallet'

export function useWalletPersistence() {
  const { connected, connect, name } = useWallet()

  // Save connected wallet name when connection changes
  useEffect(() => {
    if (connected && name) {
      localStorage.setItem(WALLET_KEY, name)
    }
  }, [connected, name])

  // Attempt reconnect on mount
  useEffect(() => {
    const savedWallet = localStorage.getItem(WALLET_KEY)
    if (savedWallet && !connected) {
      // Small delay to allow wallet extensions to initialize
      const timer = setTimeout(() => {
        connect(savedWallet).catch(() => {
          // Wallet may not be available anymore, clear saved preference
          localStorage.removeItem(WALLET_KEY)
        })
      }, 100)
      return () => clearTimeout(timer)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear wallet session (call on manual disconnect)
  const clearWalletSession = useCallback(() => {
    localStorage.removeItem(WALLET_KEY)
  }, [])

  return { clearWalletSession }
}
