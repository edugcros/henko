// 📁 src/components/AppContent.jsx
import React, { Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import DynamicThemeProvider from './DynamicThemeProvider'
import PublicLayout from './publicLayout'
import PrivateLayout from './privateLayout'
import SpinnerCentered from './SpinnerCentered/SpinnerCentered'
import {
  publicRoutes,
  publicDynamicRoutes,
  protectedRoutes,
  privateRoutes,
  fallbackRoute,
} from '../Route/routesConfig'
import { RouteRenderer } from './RouteWrappers'

const AppContent = () => {
  return (
    <DynamicThemeProvider>
      <Suspense fallback={<SpinnerCentered />}>
        <Routes>
          <Route path="/" element={<PublicLayout />}>
            {RouteRenderer({ routes: publicRoutes, isPublic: true })}
            {RouteRenderer({ routes: publicDynamicRoutes })}
          </Route>

          <Route element={<PrivateLayout />}>
            {RouteRenderer({ routes: protectedRoutes, isPublic: false })}
            {RouteRenderer({ routes: privateRoutes, isPrivate: true })}
          </Route>

          {RouteRenderer({ routes: [fallbackRoute] })}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </DynamicThemeProvider>
  )
}

export default AppContent
