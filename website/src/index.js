// 📁 website/src/index.js
import React, { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary, { registrarReporteGlobal } from '@components/ErrorBoundary/ErrorBoundary.js'
import PlatformLanding from '@pages/PlatformLanding'
import { env } from './config/env'
import './App.css'
import { store } from '@app/store'
import { initCsrf, setApiStore } from '@utils/axiosConfig'
import SpinnerCentered from '@components/SpinnerCentered/SpinnerCentered.jsx'
import { TenantProvider } from './contexts/TenantContext'
import { StoreThemeProvider } from './contexts/StoreThemeContext'

const normalizeHostname = value =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .replace(/:\d+$/, '')
    .replace(/^www\./, '')

// La landing comercial sólo se monta en el dominio raíz de Henkart.
// Los subdominios de tiendas deben continuar entrando por TenantProvider y la
// app de storefront; el panel admin vive en su propio dominio.
const isPlatformMarketingHost = () => {
  if (typeof window === 'undefined') return false

  const hostname = normalizeHostname(window.location.hostname)
  const platformHostname = normalizeHostname(env.publicBaseDomain)

  return Boolean(hostname && platformHostname && hostname === platformHostname)
}

const AppInitializer = () => {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true

    const initializeApp = async () => {
      setApiStore(store)

      const isThemePreviewRoute = window.location.pathname === '/theme-preview'

      if (!isThemePreviewRoute) {
        try {
          await initCsrf()
        } catch (error) {
          console.warn('[AppInitializer] CSRF inicial no disponible:', {
            message: error?.message,
          })
        }
      }

      if (active) setReady(true)
    }

    initializeApp().catch(error => {
      console.error('[AppInitializer] Error inicializando app:', error)
      if (active) setReady(true)
    })

    return () => {
      active = false
    }
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

// Se registra antes del primer render para capturar errores tempranos del árbol.
registrarReporteGlobal()

const container = document.getElementById('root')

if (!container) {
  throw new Error('No se encontró el elemento #root para montar Henkart.')
}

const root = createRoot(container)
root.render(
  <StrictMode>
    {isPlatformMarketingHost() ? (
      <ErrorBoundary>
        <PlatformLanding />
      </ErrorBoundary>
    ) : (
      <AppInitializer />
    )}
  </StrictMode>,
)
