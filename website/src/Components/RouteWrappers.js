// 📁 src/Components/RouteWrappers.js
import React, { Suspense } from 'react'
import PropTypes from 'prop-types'
import { Route } from 'react-router-dom'

import SpinnerCentered from '@components/SpinnerCentered/SpinnerCentered'
import PrivateRoute from '@components/PrivateRoute'
import PublicRoute from '@components/PublicRoute'

/**
 * 💡 LazyLoad: Componente reutilizable para cargar páginas con fallback elegante
 */
export const LazyLoad = ({ Component: _Component }) => (
  <Suspense fallback={<SpinnerCentered />}>
    <_Component />
  </Suspense>
)

LazyLoad.propTypes = {
  Component: PropTypes.elementType.isRequired,
}
/**
 * 🔁 RouteRenderer: Renderiza rutas privadas, públicas o normales
 * @param {Array} routes - Lista de rutas con path y componente
 * @param {Boolean} isPrivate - Indica si la ruta es privada (requiere login)
 * @param {Boolean} isPublic - Indica si es ruta pública (login/signup/etc)
 */
export const RouteRenderer = ({ routes, isPrivate = false, isPublic = false }) => {
  return routes.map(({ path, Component, allowedRoles }) => {
    const lazyElement = <LazyLoad Component={Component} />

    // ✅ Rutas privadas
    if (isPrivate) {
      return (
        <Route
          key={path}
          path={path}
          element={<PrivateRoute allowedRoles={allowedRoles}>{lazyElement}</PrivateRoute>}
        />
      )
    }

    // ✅ Rutas públicas
    if (isPublic || !allowedRoles || allowedRoles.length === 0) {
      return <Route key={path} path={path} element={lazyElement} />
    }

    return <Route key={path} path={path} element={lazyElement} />
  })
}

RouteRenderer.propTypes = {
  routes: PropTypes.arrayOf(
    PropTypes.shape({
      path: PropTypes.string.isRequired,
      Component: PropTypes.elementType.isRequired,
      allowedRoles: PropTypes.arrayOf(PropTypes.string),
    }),
  ).isRequired,
  isPrivate: PropTypes.bool,
  isPublic: PropTypes.bool,
}
