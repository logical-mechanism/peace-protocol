import { Routes, Route, Navigate } from 'react-router-dom'
import { useWallet } from '@meshsdk/react'
import { useWalletPersistence } from './hooks/useWalletPersistence'
import Landing from './pages/Landing'
import Dashboard from './pages/Dashboard'

function App() {
  const { connected } = useWallet()

  // Initialize wallet persistence (attempts reconnect on mount)
  useWalletPersistence()

  return (
    <Routes>
      <Route
        path="/"
        element={connected ? <Navigate to="/dashboard" replace /> : <Landing />}
      />
      <Route
        path="/dashboard"
        element={connected ? <Dashboard /> : <Navigate to="/" replace />}
      />
    </Routes>
  )
}

export default App
