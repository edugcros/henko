// 📄 src/routes/RouteRenderer.js — VERSIÓN FUNCIONAL CORREGIDA
import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import PrivateRoute from '@components/PrivateRoute'
import MainLayout from '@components/MainLayout'
import {
  publicRoutes,
  publicDynamicRoutes,
  protectedRoutes,
  privateRoutes,
  fallbackRoute,
} from './routesConfig'

// 🔁 Rutas públicas y protegidas
const renderPublicRoutes = () =>
  [...publicRoutes, ...publicDynamicRoutes, ...protectedRoutes]
    .map(({ path, Component: _Component }) => {
      // Validación de seguridad
      if (!_Component) {
        console.error(`🚨 ERROR: Ruta "${path}" tiene Component undefined`)
        return null
      }
      return <Route key={path} path={path} element={<_Component />} />
    })
    .filter(Boolean)

// 🔐 Rutas privadas del panel admin (solo para admin)
const renderAdminRoutes = () =>
  privateRoutes
    .map(({ path, Component: _Component }) => {
      if (!_Component) {
        console.error(
          `🚨 ERROR: Ruta admin "${path}" tiene Component undefined`,
        )
        return null
      }

      const relativePath = path.replace('/admin/', '')
      return (
        <Route
          key={path}
          path={relativePath === '' ? undefined : relativePath}
          index={relativePath === ''}
          element={<_Component />}
        />
      )
    })
    .filter(Boolean)

const RouteRenderer = ({ isLoggedIn }) => {
  // Validación del fallback
  const fallbackPath = fallbackRoute?.path || '*'
  const FallbackComponent =
    fallbackRoute?.Component || (() => <div>404 - Página no encontrada</div>)

  return (
    <Routes>
      <Route
        path="/"
        element={<Navigate to={isLoggedIn ? '/admin' : '/login'} replace />}
      />

      {renderPublicRoutes()}

      <Route path="/admin" element={<PrivateRoute allowedRoles={['admin']} />}>
        <Route element={<MainLayout />}>{renderAdminRoutes()}</Route>
      </Route>

      <Route path={fallbackPath} element={<FallbackComponent />} />
    </Routes>
  )
}

export default RouteRenderer
