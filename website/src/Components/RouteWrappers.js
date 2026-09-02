// 📁 src/Components/RouteWrappers.js

import React, { Suspense } from 'react'
import PropTypes from 'prop-types'
import { Route } from 'react-router-dom'

import SpinnerCentered from '@components/SpinnerCentered/SpinnerCentered'
import PrivateRoute from '@components/PrivateRoute'
import PublicRoute from '@components/PublicRoute'

const isDev = process.env.NODE_ENV !== 'production'

const InvalidRouteComponent = ({ path = 'ruta desconocida' }) => (
  <div
    style={{
      minHeight: '60vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      textAlign: 'center',
      color: '#991b1b',
      fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}
  >
    <strong>Error cargando la vista</strong>

    {isDev && (
      <small style={{ marginTop: 8, maxWidth: 720 }}>
        La ruta "{path}" tiene un componente inválido o undefined. Revisá el export/import de esa
        página dentro del archivo de rutas.
      </small>
    )}
  </div>
)

InvalidRouteComponent.propTypes = {
  path: PropTypes.string,
}

const isValidComponent = Component => {
  if (!Component) return false
  if (typeof Component === 'function') return true
  if (typeof Component === 'string') return true

  if (typeof Component === 'object' && Component !== null && Component.$$typeof) {
    return true
  }

  return false
}

export const LazyLoad = ({ Component = null, path = 'ruta desconocida' }) => {
  if (!isValidComponent(Component)) {
    if (isDev) {
      console.error('[RouteWrappers] Componente inválido detectado:', {
        path,
        Component,
      })
    }

    return <InvalidRouteComponent path={path} />
  }

  return (
    <Suspense fallback={<SpinnerCentered />}>
      <Component />
    </Suspense>
  )
}

LazyLoad.propTypes = {
  Component: PropTypes.elementType,
  path: PropTypes.string,
}

export const RouteRenderer = ({ routes, isPrivate = false, isPublic = false }) => {
  return routes.map(route => {
    const { path, Component, allowedRoles = [] } = route
    const lazyElement = <LazyLoad Component={Component} path={path} />

    if (isPrivate) {
      return (
        <Route
          key={path}
          path={path}
          element={<PrivateRoute allowedRoles={allowedRoles}>{lazyElement}</PrivateRoute>}
        />
      )
    }

    if (isPublic) {
      return <Route key={path} path={path} element={<PublicRoute>{lazyElement}</PublicRoute>} />
    }

    return <Route key={path} path={path} element={lazyElement} />
  })
}

RouteRenderer.propTypes = {
  routes: PropTypes.arrayOf(
    PropTypes.shape({
      path: PropTypes.string.isRequired,
      Component: PropTypes.elementType,
      allowedRoles: PropTypes.arrayOf(PropTypes.string),
    }),
  ).isRequired,
  isPrivate: PropTypes.bool,
  isPublic: PropTypes.bool,
}
