import { Routes, Route, Navigate } from 'react-router-dom'
import { useWallet } from '@meshsdk/react'
import Dashboard from './pages/Dashboard'

function App() {
  const { connected } = useWallet()

  // Phase 0: Simplified routing - Dashboard is always accessible
  // Phase 1 will add wallet guards (WalletSetup/WalletUnlock)
  // Phase 2 will add node sync guards (NodeSync)
  return (
    <Routes>
      <Route
        path="/"
        element={connected ? <Navigate to="/dashboard" replace /> : <Dashboard />}
      />
      <Route
        path="/dashboard"
        element={<Dashboard />}
      />
    </Routes>
  )
}

export default App
