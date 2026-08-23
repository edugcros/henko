// 📁 website/src/App.js

import React, { useEffect, lazy, Suspense } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import ReactGA from 'react-ga4'

import {
  publicRoutes,
  publicDynamicRoutes,
  authRoutes,
  protectedRoutes,
  privateRoutes,
  fallbackRoute,
} from './Route/routesConfig'

// El asistente se carga aparte del bundle principal y solo si el comercio lo
// activó. Importado de forma estática, sus ~1200 líneas y su docena de íconos
// de MUI viajaban en la primera carga de toda tienda, incluidas las que nunca
// encendieron el asistente. El bridge del carrito solo existe para atender
// las acciones del widget, así que sigue su misma suerte.
const AiChatWidget = lazy(() => import('@components/AiChatWidget'))
const AiCartActionBridge = lazy(() => import('@components/AiCartActionBridge'))

import { RouteRenderer } from '@components/RouteWrappers'
import PublicLayout from '@components/publicLayout'
import PrivateLayout from '@components/privateLayout'
import SpinnerCentered from '@components/SpinnerCentered/SpinnerCentered.jsx'
import ThemePreview from '@pages/ThemePreview'
import { useAuth } from '@hooks/useAuth'
import { useUserMetrics } from '@hooks/useUserMetrics'
import { useTenant } from './contexts/TenantContext'
import { trackMetaEvent } from '@utils/metaPixel'

import './App.css'

const App = () => {
  const { isLoading: authLoading } = useAuth()
  const { aiAssistantEnabled } = useTenant()
  const location = useLocation()
  const isThemePreviewRoute = location.pathname === '/theme-preview'

  if (!isThemePreviewRoute) {
    useUserMetrics()
  }

  useEffect(() => {
    ReactGA.send({
      hitType: 'pageview',
      page: location.pathname + location.search,
      title: document.title,
    })
    trackMetaEvent('PageView')
  }, [location])

  if (authLoading && !isThemePreviewRoute) {
    return <SpinnerCentered />
  }

  return (
    <Suspense fallback={<SpinnerCentered />}>
      <Routes>
        <Route path="/theme-preview" element={<ThemePreview />} />

        {/* RUTAS PÚBLICAS UNIVERSALES */}
        <Route element={<PublicLayout />}>
          {RouteRenderer({ routes: publicRoutes })}
          {RouteRenderer({ routes: publicDynamicRoutes })}

          {/* SOLO NO LOGUEADOS: login, signup, forgot, reset */}
          {RouteRenderer({ routes: authRoutes, isPublic: true })}
        </Route>

        {/* RUTAS PRIVADAS */}
        <Route element={<PrivateLayout />}>
          {protectedRoutes.length > 0 &&
            RouteRenderer({
              routes: protectedRoutes,
              isPrivate: true,
            })}

          {RouteRenderer({
            routes: privateRoutes,
            isPrivate: true,
          })}
        </Route>

        {/* FALLBACK ÚNICO */}
        {RouteRenderer({ routes: [fallbackRoute] })}
      </Routes>

      {aiAssistantEnabled && !isThemePreviewRoute && (
        <>
          <AiChatWidget />
          <AiCartActionBridge />
        </>
      )}
    </Suspense>
  )
}

export default App
