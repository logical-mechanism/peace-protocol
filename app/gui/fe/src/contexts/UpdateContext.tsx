import { createContext, useContext, type ReactNode } from 'react'
import { useUpdateCheck, type UpdateState, type UpdateInfo } from '../hooks/useUpdateCheck'

interface UpdateContextValue {
  state: UpdateState
  checkForUpdate: () => Promise<UpdateInfo | null>
  downloadUpdate: (downloadUrl: string, expectedSize?: number | null) => Promise<string | null>
  cancelDownload: () => Promise<void>
  dismiss: () => void
  reset: () => void
}

const UpdateContext = createContext<UpdateContextValue | null>(null)

interface UpdateProviderProps {
  children: ReactNode
  autoCheck?: boolean
}

// A singleton wrapper around `useUpdateCheck` so a download started from the
// Dashboard toast remains visible when the user navigates to Settings →
// Updates. Without this, each consumer of `useUpdateCheck()` had its own
// state, and the toast's Download click vanished into a hook instance the
// Settings page never saw.
export function UpdateProvider({ children, autoCheck = false }: UpdateProviderProps) {
  const value = useUpdateCheck(autoCheck)
  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUpdate(): UpdateContextValue {
  const ctx = useContext(UpdateContext)
  if (!ctx) {
    throw new Error('useUpdate must be used within an UpdateProvider')
  }
  return ctx
}
