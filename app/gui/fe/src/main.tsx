import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { WalletProvider } from './contexts/WalletContext'
import { NodeProvider } from './contexts/NodeContext'
import { WasmProvider } from './contexts/WasmContext'
import { ModalProvider } from './contexts/ModalContext'
import './index.css'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <WalletProvider>
        <NodeProvider>
          <WasmProvider>
            <BrowserRouter>
              <ModalProvider>
                <App />
              </ModalProvider>
            </BrowserRouter>
          </WasmProvider>
        </NodeProvider>
      </WalletProvider>
    </ErrorBoundary>
  </StrictMode>,
)
