// 📁 website/src/index.js
import React, { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary, { registrarReporteGlobal } from '@components/ErrorBoundary/ErrorBoundary.js'
import PlatformLanding, { shouldRenderPlatformLanding } from '@pages/PlatformLanding'
import { env } from './config/env'
import './App.css'
import { store } from '@app/store'
import { initCsrf, setApiStore } from '@utils/axiosConfig'
import SpinnerCentered from '@components/SpinnerCentered/SpinnerCentered.jsx'
import { TenantProvider } from './contexts/TenantContext'
import { StoreThemeProvider } from './contexts/StoreThemeContext'

// La landing comercial sólo se monta en el dominio raíz de Henkart, y no en todas sus
// rutas: /theme-preview es la vista previa del diseñador de tienda y la atiende la
// app del storefront. Los subdominios de tiendas entran por TenantProvider y el panel
// admin vive en su propio dominio. La regla está en PlatformLanding, donde se prueba.
const isPlatformMarketingHost = () =>
  typeof window !== 'undefined' &&
  shouldRenderPlatformLanding({
    hostname: window.location.hostname,
    pathname: window.location.pathname,
    platformDomain: env.publicBaseDomain,
  })

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
