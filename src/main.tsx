import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './hooks/useAuth.tsx'

// Signal to Telegram that the Mini App is ready
try {
  window.Telegram?.WebApp.ready();
  window.Telegram?.WebApp.expand();
} catch {
  // Not in Telegram context — ignore
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
