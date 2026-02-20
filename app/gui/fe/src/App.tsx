import { useEffect, useRef } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useWalletContext } from './contexts/WalletContext'
import { useNode } from './contexts/NodeContext'
import Dashboard from './pages/Dashboard'
import WalletSetup from './pages/WalletSetup'
import WalletUnlock from './pages/WalletUnlock'
import NodeSync from './pages/NodeSync'
import Settings from './pages/Settings'

function App() {
  const { walletState, refreshBalance } = useWalletContext()
  const { stage: nodeStage, tipSlot } = useNode()
  const prevTipRef = useRef<number | null>(null)

  // Refresh wallet balance when chain tip advances (new block every ~20s)
  useEffect(() => {
    if (tipSlot !== null && tipSlot !== prevTipRef.current) {
      prevTipRef.current = tipSlot
      refreshBalance()
    }
  }, [tipSlot, refreshBalance])

  if (walletState === 'loading') {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--bg-primary)' }}
      >
        <div style={{ color: 'var(--text-muted)' }}>Loading...</div>
      </div>
    )
  }

  return (
    <Routes>
      <Route
        path="/wallet-setup"
        element={
          walletState === 'no_wallet' ? (
            <WalletSetup />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/wallet-unlock"
        element={
          walletState === 'locked' ? (
            <WalletUnlock />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/node-sync"
        element={
          walletState === 'unlocked' ? (
            <NodeSync />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/dashboard"
        element={
          walletState === 'unlocked' ? (
            <Dashboard />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/settings"
        element={
          walletState === 'unlocked' ? (
            <Settings />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      {/* Root redirect based on wallet state, then node state */}
      <Route
        path="/"
        element={
          walletState === 'no_wallet' ? (
            <Navigate to="/wallet-setup" replace />
          ) : walletState === 'locked' ? (
            <Navigate to="/wallet-unlock" replace />
          ) : nodeStage === 'stopped' || nodeStage === 'bootstrapping' ? (
            <Navigate to="/node-sync" replace />
          ) : (
            <Navigate to="/dashboard" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
