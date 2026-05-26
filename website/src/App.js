// 📁 website/src/App.js - VERSIÓN CORREGIDA

import React, { useEffect, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import ReactGA from 'react-ga4'

// Rutas
import {
  publicRoutes,
  publicDynamicRoutes,
  protectedRoutes,
  privateRoutes,
  fallbackRoute,
} from './Route/routesConfig'

// Componentes
import { RouteRenderer } from './Components/RouteWrappers'
import PublicLayout from './Components/publicLayout'
import PrivateLayout from './Components/privateLayout'
import SpinnerCentered from './Components/SpinnerCentered/SpinnerCentered'
import ThemePreview from './Pages/ThemePreview'
import { useAuth } from '@hooks/useAuth'

import './App.css'

const App = () => {
  const { isLoading: authLoading } = useAuth()
  const location = useLocation()
  const isThemePreviewRoute = location.pathname === '/theme-preview'

  useEffect(() => {
    ReactGA.send({
      hitType: 'pageview',
      page: location.pathname + location.search,
      title: document.title,
    })
  }, [location])

  if (authLoading && !isThemePreviewRoute) {
    return <SpinnerCentered />
  }

  // ✅ SIN Providers duplicados - ya están en index.js
  return (
    <Suspense fallback={<SpinnerCentered />}>
      <Routes>
        <Route path="/theme-preview" element={<ThemePreview />} />

        {/* --- RUTAS PÚBLICAS --- */}
        <Route path="/" element={<PublicLayout />}>
          {RouteRenderer({ routes: publicRoutes, isPublic: true })}
          {RouteRenderer({ routes: publicDynamicRoutes })}
        </Route>

        {/* --- RUTAS PRIVADAS --- */}
        <Route element={<PrivateLayout />}>
          {RouteRenderer({ routes: protectedRoutes, isPublic: false })}
          {RouteRenderer({ routes: privateRoutes, isPrivate: true })}
        </Route>

        {/* --- FALLBACKS --- */}
        {RouteRenderer({ routes: [fallbackRoute] })}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default App
