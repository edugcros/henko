// 📁 website/src/index.js - VERSIÓN CORREGIDA

import React, { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import PlatformLanding from './Pages/PlatformLanding'
import ErrorBoundary, { registrarReporteGlobal } from '@components/ErrorBoundary/ErrorBoundary.js'
import './App.css'
import { store } from '@app/store'
import { initCsrf, setApiStore } from '@utils/axiosConfig'
import SpinnerCentered from '@components/SpinnerCentered/SpinnerCentered.jsx'
import { TenantProvider } from './contexts/TenantContext'
import { StoreThemeProvider } from './contexts/StoreThemeContext'
import { env } from './config/env'

const AppInitializer = () => {
  const [ready, setReady] = useState(false)

  useEffect(() => {
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

      setReady(true)
    }
    initializeApp().catch(error => {
      console.error('[AppInitializer] Error inicializando app:', error)
      setReady(true)
    })
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

// Va acá, antes del primer render, y no dentro de un useEffect.
//
// Un useEffect corre después de que el componente renderizó y se montó, así
// que si el render inicial tira —el spinner de !ready, o el armado del árbol
// de providers— React nunca llega al efecto y no quedaba instalado ningún
// reporte: la app moría en blanco sin dejar rastro. Y el ErrorBoundary tampoco
// cubre ese caso, porque está anidado DENTRO de Provider, BrowserRouter y los
// dos providers de tema: sólo ve lo que pasa debajo de él.
registrarReporteGlobal()

const container = document.getElementById('root')
const root = createRoot(container)
// En el dominio raíz de la plataforma se sirve la landing comercial sin montar
// el contexto de un tenant. Los dominios de cada tienda siguen usando el flujo
// storefront existente. El dominio proviene de configuración pública de build;
// no se fija ningún hostname en el código.
const normalizeHost = value =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .replace(/:\d+$/, '')
    .replace(/^www\./i, '')

const isPlatformDomain = () => {
  if (typeof window === 'undefined') return false

  const publicDomain = normalizeHost(env.publicBaseDomain)
  return Boolean(publicDomain && normalizeHost(window.location.hostname) === publicDomain)
}

const AppRoot = () => (isPlatformDomain() ? <PlatformLanding /> : <AppInitializer />)

root.render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
)
