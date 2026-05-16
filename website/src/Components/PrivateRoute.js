import React from 'react'
import { useLocation, Navigate } from 'react-router-dom'
import { useAuth } from '@hooks/useAuth'
import PropTypes from 'prop-types'
import SpinnerCentered from '@components/SpinnerCentered/SpinnerCentered'
import { privateRoutes, publicRoutesSet } from '@routes/routesConfig'

const PrivateRoute = ({ children }) => {
  const location = useLocation()

  const { isAuthenticated, isBlocked, isLoading, user } = useAuth() // 🔄 Mientras se verifica el estado del usuario

  if (isLoading) return <SpinnerCentered />

  if (!user) {
    console.warn('[PrivateRoute] Usuario no definido aún')

    return <Navigate to="/login" replace />
  }

  const currentPath = location.pathname // ✅ Permitir rutas públicas sin login

  if (publicRoutesSet.has(currentPath)) {
    return children
  } // ❌ Si no hay token o usuario → redirige a login

  if (!isAuthenticated) {
    console.warn('[PrivateRoute] Redirigiendo a login desde:', currentPath)

    return <Navigate to="/login" replace />
  } // ❌ Si el usuario está bloqueado

  if (isBlocked) {
    console.warn('[PrivateRoute] Cuenta bloqueada')

    return <Navigate to="/unauthorized" replace />
  } // 🔐 Verificar si la ruta actual es privada

  const routeConfig = privateRoutes.find(route => route.path === currentPath)

  const allowedRoles = routeConfig?.allowedRoles || [] // ❌ Si el usuario no tiene el rol correcto

  if (allowedRoles.length && !allowedRoles.includes(user?.role)) {
    console.warn(`[PrivateRoute] Usuario sin permiso para ${currentPath}`)

    return <Navigate to="/unauthorized" replace />
  } // ✅ Permitir acceso a ruta privada

  return children
}

PrivateRoute.propTypes = {
  children: PropTypes.node.isRequired,
}

export default PrivateRoute
