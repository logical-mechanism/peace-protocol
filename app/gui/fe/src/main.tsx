import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { WalletProvider } from './contexts/WalletContext'
import { NodeProvider } from './contexts/NodeContext'
import { WasmProvider } from './contexts/WasmContext'
import { AcceptBidQueueProvider } from './contexts/AcceptBidQueueContext'
import { UpdateProvider } from './contexts/UpdateContext'
import { ModalProvider } from './contexts/ModalContext'
import './index.css'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import ShutdownOverlay from './components/ShutdownOverlay'
import { initializeTheme } from './services/themeStorage'
import i18n from './i18n'
import { initializeLanguage } from './services/languageStorage'

// Apply stored theme before first paint to prevent flash of wrong theme
initializeTheme()

// Seed the language preference from the OS locale on first launch.
// i18next was initialized synchronously from localStorage by the import above;
// if the OS-detected code differs, switch after the async probe resolves.
void initializeLanguage().then((code) => {
  if (i18n.language !== code) void i18n.changeLanguage(code)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ShutdownOverlay />
      <WalletProvider>
        <NodeProvider>
          <WasmProvider>
            <AcceptBidQueueProvider>
              <UpdateProvider autoCheck>
                <BrowserRouter>
                  <ModalProvider>
                    <App />
                  </ModalProvider>
                </BrowserRouter>
              </UpdateProvider>
            </AcceptBidQueueProvider>
          </WasmProvider>
        </NodeProvider>
      </WalletProvider>
    </ErrorBoundary>
  </StrictMode>,
)
