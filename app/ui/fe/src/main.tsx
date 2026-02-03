import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MeshProvider } from '@meshsdk/react'
import './index.css'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { WasmProvider } from './contexts/WasmContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <MeshProvider>
        <WasmProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </WasmProvider>
      </MeshProvider>
    </ErrorBoundary>
  </StrictMode>,
)
