import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MeshProvider } from '@meshsdk/react'
import './index.css'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <MeshProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </MeshProvider>
    </ErrorBoundary>
  </StrictMode>,
)
