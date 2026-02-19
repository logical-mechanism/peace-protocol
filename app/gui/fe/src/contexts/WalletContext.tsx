import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react'
import { invoke } from '@tauri-apps/api/core'
import { MeshWallet, EmbeddedWallet } from '@meshsdk/core'
import type { IWallet } from '@meshsdk/core'
import { setPaymentKeyHex } from '../services/crypto/zkKeyDerivation'
import { getKupoAdapter, getOgmiosProvider } from '../services/providers'

export type WalletLifecycle = 'loading' | 'no_wallet' | 'locked' | 'unlocked'

export interface WalletContextValue {
  walletState: WalletLifecycle
  wallet: IWallet | null
  address: string | null
  lovelace: string | null
  paymentKeyHex: string | null
  connected: boolean
  createWallet: (mnemonic: string[], password: string) => Promise<void>
  unlockWallet: (password: string) => Promise<void>
  lock: () => Promise<void>
  deleteWallet: () => Promise<void>
  disconnect: () => void
  refreshBalance: () => Promise<void>
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function WalletProvider({ children }: { children: ReactNode }) {
  const [walletState, setWalletState] = useState<WalletLifecycle>('loading')
  const [meshWallet, setMeshWallet] = useState<MeshWallet | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [lovelace, setLovelace] = useState<string | null>(null)
  const [pkh, setPkh] = useState<string | null>(null)

  // Check wallet existence on mount
  useEffect(() => {
    invoke<boolean>('wallet_exists')
      .then((exists) => setWalletState(exists ? 'locked' : 'no_wallet'))
      .catch(() => setWalletState('no_wallet'))
  }, [])

  // Initialize MeshWallet + extract paymentKeyHex from mnemonic words
  const initializeWallet = useCallback(async (words: string[]) => {
    const wallet = new MeshWallet({
      networkId: 0,
      fetcher: getKupoAdapter(),
      submitter: getOgmiosProvider(),
      key: { type: 'mnemonic', words },
    })

    // Extract paymentKeyHex via EmbeddedWallet
    const embedded = new EmbeddedWallet({
      networkId: 0,
      key: { type: 'mnemonic', words },
    })
    const account = embedded.getAccount()
    const paymentKey = account.paymentKeyHex

    // Get bech32 address
    const addrs = wallet.getAddresses()
    const addr = addrs.baseAddressBech32 ?? addrs.enterpriseAddressBech32 ?? null

    setMeshWallet(wallet)
    setAddress(addr)
    setPkh(paymentKey)
    setPaymentKeyHex(paymentKey)
    setLovelace(null) // Updated by refreshBalance() once Kupo is running
    setWalletState('unlocked')
  }, [])

  const createWalletFn = useCallback(
    async (mnemonic: string[], password: string) => {
      const mnemonicStr = mnemonic.join(' ')
      await invoke('create_wallet', { mnemonic: mnemonicStr, password })
      await initializeWallet(mnemonic)
    },
    [initializeWallet]
  )

  const unlockWalletFn = useCallback(
    async (password: string) => {
      const words = await invoke<string[]>('unlock_wallet', { password })
      await initializeWallet(words)
    },
    [initializeWallet]
  )

  const lockFn = useCallback(async () => {
    await invoke('lock_wallet')
    setMeshWallet(null)
    setAddress(null)
    setLovelace(null)
    setPkh(null)
    setPaymentKeyHex(null)
    setWalletState('locked')
  }, [])

  const deleteWalletFn = useCallback(async () => {
    await invoke('delete_wallet')
    setMeshWallet(null)
    setAddress(null)
    setLovelace(null)
    setPkh(null)
    setPaymentKeyHex(null)
    setWalletState('no_wallet')
  }, [])

  const refreshBalanceFn = useCallback(async () => {
    if (!meshWallet) return
    try {
      const lv = await meshWallet.getLovelace()
      setLovelace(lv)
    } catch {
      // Kupo may not be ready yet
    }
  }, [meshWallet])

  const disconnectFn = useCallback(() => {
    lockFn()
  }, [lockFn])

  const value: WalletContextValue = {
    walletState,
    wallet: meshWallet,
    address,
    lovelace,
    paymentKeyHex: pkh,
    connected: walletState === 'unlocked',
    createWallet: createWalletFn,
    unlockWallet: unlockWalletFn,
    lock: lockFn,
    deleteWallet: deleteWalletFn,
    disconnect: disconnectFn,
    refreshBalance: refreshBalanceFn,
  }

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWalletContext(): WalletContextValue {
  const context = useContext(WalletContext)
  if (!context) {
    throw new Error('useWalletContext must be used within WalletProvider')
  }
  return context
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAddress(): string | undefined {
  const { address } = useWalletContext()
  return address ?? undefined
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLovelace(): string | undefined {
  const { lovelace } = useWalletContext()
  return lovelace ?? undefined
}
