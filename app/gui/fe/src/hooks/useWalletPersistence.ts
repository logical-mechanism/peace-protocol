// Shim for Phase 0 - Dashboard.tsx imports this hook
// Will be replaced by useWalletLock in Phase 1
import { useCallback } from 'react'

export function useWalletPersistence() {
  const clearWalletSession = useCallback(() => {
    // No-op in Tauri desktop app
  }, [])

  return { clearWalletSession }
}
