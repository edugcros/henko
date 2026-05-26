// 📁 website/src/index.js - VERSIÓN CORREGIDA

import React, { StrictMode, useEffect, useState } from 'react'
import ReactGA from 'react-ga4'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary from '@components/ErrorBoundary/ErrorBoundary.js'
import './App.css'
import { store } from '@app/store'
import { initCsrf, setApiStore } from '@utils/axiosConfig'
import SpinnerCentered from '@components/SpinnerCentered/SpinnerCentered.jsx'
import { TenantProvider } from './contexts/TenantContext'
import { StoreThemeProvider } from './contexts/StoreThemeContext'

const AppInitializer = () => {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const initializeApp = async () => {
      ReactGA.initialize('G-XXXXXXXXXX')
      setApiStore(store)

      const isThemePreviewRoute = window.location.pathname === '/theme-preview'

      if (!isThemePreviewRoute) {
        await initCsrf()
      }

      setReady(true)
    }
    initializeApp()
  }, [])

  if (!ready) return <SpinnerCentered />

  return (
    <Provider store={store}>
      <BrowserRouter>
        <TenantProvider>
          <StoreThemeProvider>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </StoreThemeProvider>
        </TenantProvider>
      </BrowserRouter>
    </Provider>
  )
}

const container = document.getElementById('root')
const root = createRoot(container)
root.render(
  <StrictMode>
    <AppInitializer />
  </StrictMode>,
)
