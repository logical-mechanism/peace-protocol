import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MeshProvider } from '@meshsdk/react'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MeshProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MeshProvider>
  </StrictMode>,
)
