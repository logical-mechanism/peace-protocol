import { Routes, Route, Navigate } from 'react-router-dom'
import { useWallet } from '@meshsdk/react'
import { useWalletPersistence } from './hooks/useWalletPersistence'
import Landing from './pages/Landing'
import Dashboard from './pages/Dashboard'
import WasmLoadingScreen from './pages/WasmLoadingScreen'

function App() {
  const { connected } = useWallet()

  // Initialize wallet persistence (attempts reconnect on mount)
  useWalletPersistence()

  // WASM loading is optional - users can browse without it
  // Only "Accept Bid" requires WASM (for SNARK proof generation)
  return (
    <Routes>
      <Route
        path="/"
        element={connected ? <Navigate to="/dashboard" replace /> : <Landing />}
      />
      <Route
        path="/loading"
        element={connected ? <WasmLoadingScreen /> : <Navigate to="/" replace />}
      />
      <Route
        path="/dashboard"
        element={connected ? <Dashboard /> : <Navigate to="/" replace />}
      />
    </Routes>
  )
}

export default App
