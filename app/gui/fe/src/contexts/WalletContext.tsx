import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'
import { invoke } from '@tauri-apps/api/core'
import { MeshWallet, EmbeddedWallet } from '@meshsdk/core'
import type { IWallet } from '@meshsdk/core'
import { setPaymentKeyHex } from '../services/crypto/zkKeyDerivation'
import { getChainingAdapter, getOgmiosProvider, getPendingTxPool } from '../services/providers'
import { getAutolockMinutes, AUTOLOCK_CHECK_INTERVAL } from '../services/autolock'

export type WalletLifecycle = 'loading' | 'no_wallet' | 'locked' | 'unlocked'

export interface WalletContextValue {
  walletState: WalletLifecycle
  wallet: IWallet | null
  address: string | null
  lovelace: string | null
  connected: boolean
  createWallet: (mnemonic: string[], password: string) => Promise<void>
  unlockWallet: (password: string) => Promise<void>
  lock: () => Promise<void>
  deleteWallet: () => Promise<void>
  disconnect: () => void
  refreshBalance: () => Promise<void>
  sessionWarningSeconds: number | null
  extendSession: () => void
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function WalletProvider({ children }: { children: ReactNode }) {
  const [walletState, setWalletState] = useState<WalletLifecycle>('loading')
  const [meshWallet, setMeshWallet] = useState<MeshWallet | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [lovelace, setLovelace] = useState<string | null>(null)

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
      fetcher: getChainingAdapter(),
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
    setPaymentKeyHex(paymentKey)
    setLovelace(null) // Updated by refreshBalance() once Kupo is running
    setWalletState('unlocked')

    // Best-effort mnemonic cleanup: overwrite array slots to reduce the window
    // where raw mnemonic words sit in JS heap memory. Note that JS strings are
    // immutable and GC timing is non-deterministic, so this is not a guarantee
    // — but it eliminates the most obvious reference.
    for (let i = 0; i < words.length; i++) {
      words[i] = ''
    }
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

  const [sessionWarningSeconds, setSessionWarningSeconds] = useState<number | null>(null)
  const warningIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const lockFn = useCallback(async () => {
    await invoke('lock_wallet')
    getPendingTxPool().clear()
    setMeshWallet(null)
    setAddress(null)
    setLovelace(null)
    setPaymentKeyHex(null)
    setSessionWarningSeconds(null)
    setWalletState('locked')
  }, [])

  const deleteWalletFn = useCallback(async () => {
    await invoke('delete_wallet')
    setMeshWallet(null)
    setAddress(null)
    setLovelace(null)
    setPaymentKeyHex(null)
    setWalletState('no_wallet')
  }, [])

  // --- Auto-lock on inactivity with warning countdown ---
  const lastActivityRef = useRef(0)

  const clearWarningInterval = useCallback(() => {
    if (warningIntervalRef.current) {
      clearInterval(warningIntervalRef.current)
      warningIntervalRef.current = null
    }
  }, [])

  const extendSession = useCallback(() => {
    lastActivityRef.current = Date.now()
    setSessionWarningSeconds(null)
    clearWarningInterval()
  }, [clearWarningInterval])

  useEffect(() => {
    if (walletState !== 'unlocked') return

    lastActivityRef.current = Date.now()

    const resetActivity = () => {
      lastActivityRef.current = Date.now()
      // Clear warning on any user interaction
      if (warningIntervalRef.current) {
        clearWarningInterval()
        setSessionWarningSeconds(null)
      }
    }

    // Shared 1-second throttle for all activity listeners.
    // During an active warning, the throttle is bypassed so any
    // interaction (including mouse movement) dismisses immediately.
    let lastReset = 0
    const throttledReset = () => {
      const now = Date.now()
      if (warningIntervalRef.current || now - lastReset >= 1000) {
        lastReset = now
        resetActivity()
      }
    }

    const startWarningCountdown = (remainingMs: number) => {
      if (warningIntervalRef.current) return // Already running
      setSessionWarningSeconds(Math.ceil(remainingMs / 1000))

      warningIntervalRef.current = setInterval(() => {
        const minutes = getAutolockMinutes()
        if (minutes === 0) {
          // User disabled auto-lock while warning was active
          clearWarningInterval()
          setSessionWarningSeconds(null)
          return
        }
        const elapsed = Date.now() - lastActivityRef.current
        const remaining = minutes * 60_000 - elapsed
        if (remaining <= 0) {
          clearWarningInterval()
          setSessionWarningSeconds(null)
          lockFn()
        } else {
          setSessionWarningSeconds(Math.ceil(remaining / 1000))
        }
      }, 1000)
    }

    document.addEventListener('mousedown', throttledReset)
    document.addEventListener('keydown', throttledReset)
    document.addEventListener('mousemove', throttledReset)

    // Coarse check every 30s — activates fine-grained countdown when close to timeout
    const interval = setInterval(() => {
      const minutes = getAutolockMinutes()
      if (minutes === 0) return // 0 = never auto-lock
      const elapsed = Date.now() - lastActivityRef.current
      const remaining = minutes * 60_000 - elapsed
      if (remaining <= 0) {
        lockFn()
      } else if (remaining <= 90_000 && !warningIntervalRef.current) {
        startWarningCountdown(remaining)
      }
    }, AUTOLOCK_CHECK_INTERVAL)

    return () => {
      document.removeEventListener('mousedown', throttledReset)
      document.removeEventListener('keydown', throttledReset)
      document.removeEventListener('mousemove', throttledReset)
      clearInterval(interval)
      clearWarningInterval()
      setSessionWarningSeconds(null)
    }
  }, [walletState, lockFn, clearWarningInterval])

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
    connected: walletState === 'unlocked',
    createWallet: createWalletFn,
    unlockWallet: unlockWalletFn,
    lock: lockFn,
    deleteWallet: deleteWalletFn,
    disconnect: disconnectFn,
    refreshBalance: refreshBalanceFn,
    sessionWarningSeconds,
    extendSession,
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
