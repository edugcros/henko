// 📄 src/routes/RouteRenderer.js — VERSIÓN FUNCIONAL CORREGIDA
import React, { Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import PrivateRoute from '@components/PrivateRoute'
import PublicRoute from '@components/PublicRoute'
import MainLayout from '@components/MainLayout'
import SpinnerCentered from '@components/SpinnerCentered'
import {
  publicRoutes,
  publicDynamicRoutes,
  protectedRoutes,
  privateRoutes,
  fallbackRoute,
} from './routesConfig'

// Rutas públicas donde no tiene sentido quedarse si ya hay una sesión
// válida — ver PublicRoute.js. Acotado a /login (el caso confirmado: un
// usuario ya autenticado puede aterrizar ahí por un redirect duro previo del
// interceptor de axios y quedaba trabado mirando el formulario para
// siempre, sin que nada lo mandara de vuelta). No se aplica a todo
// publicRoutes: /subscripcion, por ejemplo, tiene que seguir siendo visible
// estando logueado.
const REDIRECT_IF_AUTHENTICATED_PATHS = new Set(['/login'])

// 🔁 Rutas públicas
const renderPublicRoutes = () =>
  [...publicRoutes, ...publicDynamicRoutes]
    .map(({ path, Component: _Component }) => {
      // Validación de seguridad
      if (!_Component) {
        console.error(`🚨 ERROR: Ruta "${path}" tiene Component undefined`)
        return null
      }

      const element = REDIRECT_IF_AUTHENTICATED_PATHS.has(path) ? (
        <PublicRoute>
          <_Component />
        </PublicRoute>
      ) : (
        <_Component />
      )

      return <Route key={path} path={path} element={element} />
    })
    .filter(Boolean)

// 🔐 Rutas que solo piden sesión (sin rol específico ni layout del panel).
// Estaban entrando por renderPublicRoutes(), o sea que el array prometía
// protección y se renderizaba igual que una ruta abierta.
const renderProtectedRoutes = () =>
  protectedRoutes
    .map(({ path, Component: _Component }) => {
      if (!_Component) {
        console.error(
          `🚨 ERROR: Ruta protegida "${path}" tiene Component undefined`,
        )
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
        console.error(`🚨 ERROR: Ruta admin "${path}" tiene Component undefined`)
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
    // Todas las páginas salvo Login son React.lazy() (ver pages/index.js):
    // un solo límite de Suspense alcanza porque una sola ruta está montada
    // a la vez. El spinner es el mismo que ya se usa en otras cargas
    // asincrónicas del panel, no uno nuevo a mantener.
    <Suspense fallback={<SpinnerCentered />}>
      <Routes>
        <Route path="/" element={<Navigate to={isLoggedIn ? '/admin' : '/login'} replace />} />

        {renderPublicRoutes()}

        <Route element={<PrivateRoute />}>{renderProtectedRoutes()}</Route>

        <Route path="/admin" element={<PrivateRoute allowedRoles={['admin']} />}>
          <Route element={<MainLayout />}>{renderAdminRoutes()}</Route>
        </Route>

        <Route path={fallbackPath} element={<FallbackComponent />} />
      </Routes>
    </Suspense>
  )
}

export default RouteRenderer
