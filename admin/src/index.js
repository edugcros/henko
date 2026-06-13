// website/src/index.js
import React, { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary from '@components/ErrorBoundary/ErrorBoundary.js'
import './App.css'
import { store } from '@app/store'
import { initCsrf, setApiStore } from '@utils/axiosConfig'
import SpinnerCentered from '@components/SpinnerCentered.jsx'
// -----------------------------
// Wrapper para inicialización
// -----------------------------
const AppInitializer = () => {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const initializeApp = async () => {
      // Inyectar store en axiosConfig (para posibles futuros usos)
      setApiStore(store)
      // Inicializar CSRF
      await initCsrf()
      setReady(true)
    }
    initializeApp()
  }, [])

  if (!ready) return <SpinnerCentered /> // loading mientras CSRF se inicializa

  return (
    <Provider store={store}>
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </Provider>
  )
}

// -----------------------------
// Montaje del root
// -----------------------------
const container = document.getElementById('root')
const root = createRoot(container)
root.render(
  <StrictMode>
    <AppInitializer />
  </StrictMode>,
)
