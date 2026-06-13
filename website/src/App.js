// 📁 website/src/App.js

import React, { useEffect, Suspense } from 'react'
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

import AiChatWidget from '@components/AiChatWidget'
import AiCartActionBridge from '@components/AiCartActionBridge'

import { RouteRenderer } from '@components/RouteWrappers'
import PublicLayout from '@components/publicLayout'
import PrivateLayout from '@components/privateLayout'
import SpinnerCentered from '@components/SpinnerCentered/SpinnerCentered.jsx'
import ThemePreview from '@pages/ThemePreview'
import { useAuth } from '@hooks/useAuth'
import { useUserMetrics } from '@hooks/useUserMetrics'

import './App.css'

const App = () => {
  const { isLoading: authLoading } = useAuth()
  const location = useLocation()
  const isThemePreviewRoute = location.pathname === '/theme-preview'

  useUserMetrics()

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

      <AiChatWidget />
      <AiCartActionBridge />
    </Suspense>
  )
}

export default App
