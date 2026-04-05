import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { WalletProvider } from './contexts/WalletContext'
import { NodeProvider } from './contexts/NodeContext'
import { WasmProvider } from './contexts/WasmContext'
import { AcceptBidQueueProvider } from './contexts/AcceptBidQueueContext'
import { ModalProvider } from './contexts/ModalContext'
import './index.css'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import ShutdownOverlay from './components/ShutdownOverlay'
import { initializeTheme } from './services/themeStorage'

// Apply stored theme before first paint to prevent flash of wrong theme
initializeTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ShutdownOverlay />
      <WalletProvider>
        <NodeProvider>
          <WasmProvider>
            <AcceptBidQueueProvider>
              <BrowserRouter>
                <ModalProvider>
                <App />
                </ModalProvider>
              </BrowserRouter>
            </AcceptBidQueueProvider>
          </WasmProvider>
        </NodeProvider>
      </WalletProvider>
    </ErrorBoundary>
  </StrictMode>,
)
