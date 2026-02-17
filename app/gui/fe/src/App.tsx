import { Routes, Route, Navigate } from 'react-router-dom'
import { useWalletContext } from './contexts/WalletContext'
import Dashboard from './pages/Dashboard'
import WalletSetup from './pages/WalletSetup'
import WalletUnlock from './pages/WalletUnlock'

function App() {
  const { walletState } = useWalletContext()

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
        path="/dashboard"
        element={
          walletState === 'unlocked' ? (
            <Dashboard />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      {/* Root redirect based on wallet state */}
      <Route
        path="/"
        element={
          walletState === 'no_wallet' ? (
            <Navigate to="/wallet-setup" replace />
          ) : walletState === 'locked' ? (
            <Navigate to="/wallet-unlock" replace />
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
